import { z } from 'zod'
import type { Actor } from '../actor'
import { ROLE_LABEL, ROLE_SUMMARY, atLeast } from '../actor'
import { AppError } from '../errors'
import { appUrl, getEnv } from '../env'
import * as files from '../services/files'
import { search } from '../services/search'
import { listActivity } from '../services/activity'
import { getSkill, listSkills } from '../services/skills'
import * as ws from '../services/workspaces'
import * as conns from '../services/connections'
import * as links from '../services/upload-links'
import { isParseable, runExtraction } from '../services/extract'
import { PRESETS } from '../../lib/presets'
import { AGENT_SKILLS, FLOW_SDK_TYPES, GUIDE } from './guide'
import { FLOW_TOOLS } from './flow-tools'
import { flowStatusForPath, listFlows } from '../services/flows'

export type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

export type ToolDef = {
  name: string
  title: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
  /** Lowest role that sees the tool at all. */
  minRole?: 'viewer' | 'member' | 'admin'
  readOnly?: boolean
  destructive?: boolean
  run: (actor: Actor, args: any) => Promise<unknown>
}

const path = z.string().describe('Path starting with the drive: /team/... (shared) or /me/... (private).')
const message = z.string().max(500).optional().describe('Short commit message describing the change, like a git commit.')
const baseVersion = z
  .number()
  .int()
  .optional()
  .describe('Version you read. If the file changed since, the write is rejected so you can merge instead of overwriting.')

function json(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export function errorResult(err: unknown): ToolResult {
  if (err instanceof AppError) return { isError: true, content: [{ type: 'text', text: JSON.stringify(err.toJSON(), null, 2) }] }
  if (err instanceof z.ZodError) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: 'invalid', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }) }],
    }
  }
  console.error('[mcp] tool failed', err)
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'internal', message: String((err as Error)?.message ?? err) }) }] }
}

function fmtDate(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export const TOOLS: ToolDef[] = [
  {
    name: 'whoami',
    title: 'Who am I',
    description:
      'Start here. Returns you, your workspace, your role and what it allows, the drives, available skills and connections. Call it once at the start of a session.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => {
      const [skills, connections, workspaces, stats, flowList] = await Promise.all([
        listSkills(actor),
        conns.listConnections(actor, { usableOnly: true }),
        ws.listWorkspaces(actor.userId),
        files.driveStats(actor),
        listFlows(actor).catch(() => []),
      ])
      return {
        user: { id: actor.userId, name: actor.userName, email: actor.email },
        workspace: { id: actor.workspaceId, name: actor.workspaceName, slug: actor.workspaceSlug },
        role: actor.role,
        roleMeans: ROLE_SUMMARY[actor.role],
        drives: {
          '/team': { about: 'Shared with everyone in the workspace.', ...stats.team },
          '/me': { about: 'Your private drive. Only you can see it.', ...stats.me },
        },
        skills: skills.map((s) => ({ name: s.name, description: s.description, path: s.path })),
        connections: connections.map((c) => ({
          slug: c.slug,
          name: c.name,
          status: c.status,
          tools: c.toolCount,
          mode: c.effectiveToolMode,
          instructions: c.instructions,
        })),
        connectionsNote: connections.some((c) => c.effectiveToolMode === 'search')
          ? 'Connections in "search" mode are not in your tool list. Find their tools with connection_tools.'
          : undefined,
        flows: flowList.length
          ? flowList.map((f) => ({ name: f.name, description: f.description, path: f.path, status: f.status, waitingApprovals: f.waitingApprovals || undefined }))
          : undefined,
        flowsNote: flowList.some((f) => f.waitingApprovals)
          ? 'Some flow runs are waiting for approval. Show them to the user (flow_runs with status "waiting").'
          : undefined,
        otherWorkspaces: workspaces.filter((w) => w.id !== actor.workspaceId).map((w) => ({ slug: w.slug, name: w.name, role: w.role })),
        suggestion:
          stats.team.docs <= 1 && stats.team.files === 0 && actor.role !== 'viewer'
            ? 'The team drive is nearly empty. If the user wants it set up, follow the brainspace-setup skill (or the brainspace-setup prompt).'
            : undefined,
        app: appUrl(),
      }
    },
  },
  {
    name: 'guide',
    title: 'Usage guide',
    description: 'The full guide to working with Brainspace: path rules, versioning, promotion, skills and connections. Read it if anything is unclear.',
    schema: z.object({}),
    readOnly: true,
    run: async () => GUIDE,
  },
  {
    name: 'list',
    title: 'List folder',
    description: 'List a folder. Use path "/team" or "/me" for a drive root. Set depth > 1 to see nested folders in one call.',
    schema: z.object({
      path: path.default('/team'),
      depth: z.number().int().min(1).max(10).optional().describe('How many levels to include. Default 1.'),
    }),
    readOnly: true,
    run: async (actor, a) => {
      const r = await files.list(actor, a.path, { depth: a.depth })
      return {
        folder: r.folder.path,
        truncated: r.truncated,
        entries: r.entries.map((e) => ({
          path: e.path,
          kind: e.kind,
          ...(e.kind !== 'folder' ? { version: e.version, size: e.size, updated: fmtDate(e.updatedAt) } : {}),
          ...(e.description ? { description: e.description } : {}),
        })),
      }
    },
  },
  {
    name: 'read',
    title: 'Read file',
    description:
      'Read a doc. You always get the latest version unless you pass version to check out an older one (see history). Returns content and the version number to pass as baseVersion when you write. For PDFs, Word, PowerPoint and Excel files it returns the extracted text (PDF pages are marked <!-- page N -->) plus a temporary download URL; for images, just the URL. offset/limit (1-based lines) page through long docs and long extracted text.',
    schema: z.object({
      path,
      version: z.number().int().optional(),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional(),
    }),
    readOnly: true,
    run: async (actor, a) => {
      const r = await files.read(actor, a.path, a)
      if (r.kind === 'folder') return { path: r.path, kind: 'folder', entries: (r as { entries: files.NodeInfo[] }).entries.map((e) => e.path) }
      const head = [
        `path: ${r.path}`,
        `version: ${r.version}${'currentVersion' in r && r.currentVersion !== r.version ? ` (historical, current is ${r.currentVersion})` : ''}`,
        `updated: ${fmtDate(r.updatedAt)}`,
        r.description ? `description: ${r.description}` : null,
        'range' in r && r.range ? `lines: ${r.range.offset}-${r.range.offset + r.range.limit - 1} of ${r.range.totalLines}` : null,
      ]
        .filter(Boolean)
        .join('\n')
      if ('downloadUrl' in r) {
        const file = `${head}\nmimeType: ${r.mimeType}\nsize: ${r.size} bytes\ndownloadUrl (valid 1 hour): ${r.downloadUrl}`
        const t = r.text
        if (!t) return file
        if (t.status === 'pending') return `${file}\ntext: being extracted, try again in a minute`
        if (t.status === 'failed') return `${file}\ntext: extraction failed (${t.error ?? 'unknown error'}). Retry with extract_text.`
        if (!('content' in t)) return file
        const meta = [
          `text: extracted by Context.dev, ${(t.chars ?? 0).toLocaleString()} characters${t.pages ? `, ${t.pages} pages (marked <!-- page N -->)` : ''}`,
          t.range ? `lines: ${t.range.offset}-${t.range.offset + t.range.limit - 1} of ${t.range.totalLines}` : null,
        ]
          .filter(Boolean)
          .join('\n')
        return `${file}\n${meta}\n---\n${t.content}`
      }
      return `${head}\n---\n${'content' in r ? r.content : ''}`
    },
  },
  {
    name: 'read_many',
    title: 'Read several files',
    description: 'Read up to 20 docs in one call. Use it to pull in related context (e.g. voice guide plus brand kit) without many round trips.',
    schema: z.object({ paths: z.array(z.string()).min(1).max(20) }),
    readOnly: true,
    run: async (actor, a) => {
      const out = await Promise.all(
        (a.paths as string[]).map(async (p) => {
          try {
            const r = await files.read(actor, p)
            return 'content' in r
              ? { path: r.path, version: r.version, content: r.content }
              : { path: r.path, kind: r.kind, ...('downloadUrl' in r ? { downloadUrl: r.downloadUrl } : {}) }
          } catch (err) {
            return { path: p, error: err instanceof AppError ? err.message : String(err) }
          }
        }),
      )
      return out
    },
  },
  {
    name: 'search',
    title: 'Search',
    description:
      'Search both drives by meaning and keywords (hybrid). Use it before creating a doc so you update the existing one instead of duplicating it.',
    schema: z.object({
      query: z.string().min(1),
      drive: z.enum(['all', 'team', 'me']).optional(),
      mode: z.enum(['hybrid', 'keyword', 'semantic']).optional(),
      pathPrefix: z.string().optional().describe('Only return results under this path, e.g. /team/brand'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    readOnly: true,
    run: async (actor, a) => search(actor, a.query, a),
  },
  {
    name: 'write',
    title: 'Write doc',
    description:
      'Create a doc or replace its whole content. Missing folders are created. Paths without an extension become markdown. To change part of an existing doc, prefer edit. When replacing, pass baseVersion from your last read.',
    schema: z.object({
      path,
      content: z.string(),
      message,
      baseVersion,
      description: z.string().max(300).optional().describe('One-line summary shown in listings and search.'),
      createOnly: z.boolean().optional().describe('Fail instead of overwriting if the doc already exists.'),
    }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.write(actor, a.path, a.content, a)
      return { path: r.node.path, version: r.node.version, created: r.created, changed: r.changed, flow: await flowStatusForPath(actor, r.node.path) }
    },
  },
  {
    name: 'edit',
    title: 'Edit doc',
    description:
      'Change part of a doc with exact find-and-replace edits, applied in order to the latest version. Each oldText must match exactly once unless replaceAll is true. Safer than write for concurrent changes.',
    schema: z.object({
      path,
      edits: z
        .array(z.object({ oldText: z.string(), newText: z.string(), replaceAll: z.boolean().optional() }))
        .min(1),
      message,
      baseVersion,
    }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.edit(actor, a.path, a.edits, a)
      return { path: r.node.path, version: r.node.version, changed: r.changed, flow: await flowStatusForPath(actor, r.node.path) }
    },
  },
  {
    name: 'append',
    title: 'Append to doc',
    description: 'Append text to the end of a doc, creating it if needed. Good for logs, meeting notes and running lists.',
    schema: z.object({ path, text: z.string(), message }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.append(actor, a.path, a.text, a)
      return { path: r.node.path, version: r.node.version }
    },
  },
  {
    name: 'upload',
    title: 'Upload file',
    description:
      'Store a file from a public URL (or small base64 data). Re-uploading to the same path creates a new version. For a file on your machine, or one the user has, use upload_link instead: base64 costs tokens and is capped near 3 MB.',
    schema: z.object({
      path,
      url: z.string().url().optional().describe('Fetch the file from this URL.'),
      base64: z.string().optional().describe('File bytes as base64, if you have them inline.'),
      mimeType: z.string().optional(),
      description: z.string().max(300).optional().describe('What it is and when to use it, e.g. "Primary logo, use on light backgrounds".'),
      message,
    }),
    minRole: 'member',
    run: async (actor, a) => {
      let data: ArrayBuffer
      let mime = a.mimeType as string | undefined
      if (a.url) {
        const res = await fetch(a.url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new AppError('upstream', `Fetching ${a.url} returned HTTP ${res.status}.`)
        data = await res.arrayBuffer()
        mime ??= res.headers.get('content-type')?.split(';')[0] ?? undefined
      } else if (a.base64) {
        const bin = atob(String(a.base64).replace(/^data:[^,]+,/, ''))
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        data = bytes.buffer
      } else {
        throw new AppError('invalid', 'Pass url or base64.')
      }
      const r = await files.upload(actor, a.path, data, { mimeType: mime, description: a.description, message: a.message })
      return { path: r.node.path, version: r.node.version, size: r.node.size, mimeType: r.node.mimeType }
    },
  },
  {
    name: 'upload_link',
    title: 'Create an upload link',
    description:
      'Get a short-lived link for putting files into the drive without sending them through the conversation. Give `url` to the user: it opens a page where they can drop files or folders (no sign-in needed). Or run the `forAgents` curl command yourself to upload a local file of any size up to 95 MB. Target a folder (end the path with "/") or an exact file path. Files land as you, with your role.',
    schema: z.object({
      path: z.string().describe('Folder to upload into, ending with "/" (e.g. /team/brand/assets/), or an exact file path (e.g. /me/contracts/msa.pdf).'),
      expiresInMinutes: z.number().int().min(5).max(10080).optional().describe('Default 60. Max 7 days.'),
      maxFiles: z.number().int().min(1).max(1000).optional().describe('Default 100 for folders, 5 for a single path.'),
      note: z.string().max(500).optional().describe('Shown to the person on the upload page, e.g. "The signed MSA, please".'),
      description: z.string().max(300).optional().describe('Description to set on the file (single-path links only).'),
      message: z.string().max(300).optional().describe('Commit message for the uploaded versions.'),
    }),
    minRole: 'member',
    run: async (actor, a) => links.createUploadLink(actor, a),
  },
  {
    name: 'upload_link_status',
    title: 'Upload link status',
    description: 'See which files have arrived through an upload link. Without an id, lists your active links.',
    schema: z.object({ id: z.string().optional() }),
    readOnly: true,
    minRole: 'member',
    run: async (actor, a) => (a.id ? links.uploadLinkStatus(actor, a.id) : links.listUploadLinks(actor)),
  },
  {
    name: 'upload_link_revoke',
    title: 'Turn off an upload link',
    description: 'Stop an upload link from accepting more files.',
    schema: z.object({ id: z.string() }),
    minRole: 'member',
    run: async (actor, a) => links.revokeUploadLink(actor, a.id),
  },
  {
    name: 'extract_text',
    title: 'Extract text from a file',
    description:
      'Re-run text extraction for a PDF, Word, PowerPoint or Excel file (Brainspace does this automatically on upload). Use it when read says extraction failed, or with ocr: false to skip OCR. Waits for the result.',
    schema: z.object({ path, ocr: z.boolean().optional().describe('Read scanned PDF pages with OCR. Default true.') }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.resolve(actor, a.path)
      if (!r.node || r.node.kind !== 'file') throw new AppError('invalid', `${a.path} is not an uploaded file.`)
      if (!isParseable(r.node.name)) throw new AppError('invalid', 'Text extraction supports PDF, Word, PowerPoint, Excel, RTF, OpenDocument and EPUB files.')
      const res = await runExtraction({ nodeId: r.node.id, version: r.node.version, ocr: a.ocr })
      if ('skipped' in res) {
        const again = await files.read(actor, a.path)
        return { path: a.path, status: 'text' in again && again.text ? again.text.status : 'skipped', error: 'text' in again && again.text && 'error' in again.text ? again.text.error : undefined }
      }
      return { path: a.path, status: 'done', chars: res.chars, pages: res.pages, next: 'Read the file to see the text, or search for it.' }
    },
  },
  {
    name: 'describe',
    title: 'Describe file',
    description: 'Set the one-line description of a doc or file. Descriptions show up in listings and search, so agents can pick the right asset without opening it.',
    schema: z.object({ path, description: z.string().max(300) }),
    minRole: 'member',
    run: async (actor, a) => files.describe(actor, a.path, a.description),
  },
  {
    name: 'mkdir',
    title: 'Create folder',
    description: 'Create a folder (and any missing parents).',
    schema: z.object({ path }),
    minRole: 'member',
    run: async (actor, a) => files.mkdir(actor, a.path),
  },
  {
    name: 'move',
    title: 'Move or rename',
    description:
      'Move or rename a doc or folder. End "to" with "/" to move into a folder. Moving from /me to /team shares it with the team (same as promote). Only admins can move things out of /team.',
    schema: z.object({ from: path, to: path }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.move(actor, a.from, a.to)
      return { path: r.node.path, changed: r.changed, items: 'movedCount' in r ? r.movedCount : 1 }
    },
  },
  {
    name: 'copy',
    title: 'Copy',
    description: 'Copy a doc, file or folder. Use it to take a team doc into /me to draft changes privately.',
    schema: z.object({ from: path, to: path }),
    minRole: 'member',
    run: async (actor, a) => files.copy(actor, a.from, a.to),
  },
  {
    name: 'promote',
    title: 'Promote to team',
    description:
      'Share something from your private drive with the whole team. If nothing exists at the team path, it moves there with its history. If a doc already exists there (say /team/brand/brand-kit.md), yours becomes its next version: everyone gets it by default and the previous version stays in history. Folders merge file by file. The private copy goes to your trash unless keepCopy is set. Pass baseVersion (the team version you started from) to be stopped if someone changed the team doc in the meantime.',
    schema: z.object({
      path: z.string().describe('Path in your private drive, e.g. /me/drafts/brand-kit.md'),
      to: z.string().optional().describe('Destination under /team. Defaults to the same relative path.'),
      keepCopy: z.boolean().optional(),
      baseVersion,
      message,
    }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.promote(actor, a.path, a)
      return { path: r.node?.path, version: r.node?.version, updated: r.updated, created: r.created, keptPrivateCopy: r.keptPrivateCopy }
    },
  },
  {
    name: 'delete',
    title: 'Delete (to trash)',
    description:
      'Move a doc or folder to the trash. It can be restored with trash_restore. Deleting from /team needs the admin role; you can always delete your own /me files.',
    schema: z.object({ path }),
    minRole: 'member',
    destructive: true,
    run: async (actor, a) => files.trash(actor, a.path),
  },
  {
    name: 'trash_list',
    title: 'List trash',
    description: 'List deleted items you can see, with ids for trash_restore.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => (await files.listTrash(actor)).map((t) => ({ id: t.id, path: t.path, kind: t.kind, deletedAt: fmtDate(t.deletedAt), deletedBy: t.deletedBy })),
  },
  {
    name: 'trash_restore',
    title: 'Restore from trash',
    description: 'Restore a deleted item by id (from trash_list). Pass "to" if something now exists at the original path.',
    schema: z.object({ id: z.string(), to: z.string().optional() }),
    minRole: 'member',
    run: async (actor, a) => files.restoreFromTrash(actor, a.id, a),
  },
  {
    name: 'trash_purge',
    title: 'Permanently delete',
    description: 'Permanently delete a trashed item and all its versions. This cannot be undone. Admins only for team files.',
    schema: z.object({ id: z.string() }),
    minRole: 'member',
    destructive: true,
    run: async (actor, a) => files.purge(actor, a.id),
  },
  {
    name: 'history',
    title: 'Version history',
    description: 'List the versions of a doc or file: who changed it, when, through which agent, and the commit message.',
    schema: z.object({ path, limit: z.number().int().min(1).max(200).optional() }),
    readOnly: true,
    run: async (actor, a) => {
      const r = await files.history(actor, a.path, a)
      return {
        path: r.node.path,
        currentVersion: r.node.version,
        versions: r.versions.map((v) => ({
          version: v.version,
          message: v.message,
          author: v.authorName ?? v.authorEmail,
          via: v.clientName ? `${v.via} (${v.clientName})` : v.via,
          at: fmtDate(v.createdAt),
          size: v.size,
        })),
      }
    },
  },
  {
    name: 'diff',
    title: 'Diff versions',
    description: 'Unified diff between two versions of a doc. "to" defaults to the current version.',
    schema: z.object({ path, from: z.number().int().min(1), to: z.number().int().min(1).optional() }),
    readOnly: true,
    run: async (actor, a) => (await files.diff(actor, a.path, a.from, a.to)).patch,
  },
  {
    name: 'restore_version',
    title: 'Restore version',
    description: 'Make an old version current again. This adds a new version, so nothing is lost.',
    schema: z.object({ path, version: z.number().int().min(1), message }),
    minRole: 'member',
    run: async (actor, a) => {
      const r = await files.restoreVersion(actor, a.path, a.version, a)
      return { path: r.node.path, version: r.node.version, changed: r.changed }
    },
  },
  {
    name: 'recent',
    title: 'Recently changed',
    description: 'Docs and files changed most recently, newest first.',
    schema: z.object({ drive: z.enum(['all', 'team', 'me']).optional(), limit: z.number().int().min(1).max(100).optional() }),
    readOnly: true,
    run: async (actor, a) =>
      (await files.recent(actor, a)).map((r) => ({ path: r.path, version: r.version, updated: fmtDate(r.updatedAt), by: r.updatedByName })),
  },
  {
    name: 'activity',
    title: 'Activity log',
    description: 'What happened in the workspace: edits, moves, promotions, invites, connection calls. Filter by path prefix or action.',
    schema: z.object({
      pathPrefix: z.string().optional(),
      actions: z.array(z.string()).optional().describe('e.g. ["edit","create","promote"]'),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnly: true,
    run: async (actor, a) =>
      (await listActivity(actor, a)).map((r) => ({
        at: fmtDate(r.createdAt),
        who: r.actorName ?? r.actorEmail,
        via: r.clientName ? `${r.via} (${r.clientName})` : r.via,
        action: r.action,
        path: r.fullPath,
        details: r.details,
      })),
  },

  // Skills ---------------------------------------------------------------
  {
    name: 'skills_list',
    title: 'List skills',
    description: 'Skills are team playbooks stored as /team/skills/<name>/SKILL.md (and private ones in /me/skills). Check this list when starting a task; if a skill matches, load it with skill_get and follow it.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => listSkills(actor),
  },
  {
    name: 'skill_get',
    title: 'Load skill',
    description: 'Load a skill by name: its SKILL.md instructions plus a list of supporting files you can read.',
    schema: z.object({ name: z.string() }),
    readOnly: true,
    run: async (actor, a) => {
      let s
      try {
        s = await getSkill(actor, a.name)
      } catch (err) {
        // Fall back to the skills that ship with Brainspace (brainspace-flows, brainspace-setup...).
        const key = String(a.name).trim().toLowerCase()
        const builtIn = AGENT_SKILLS[key] ?? AGENT_SKILLS[`brainspace-${key}`]
        if (!builtIn) throw err
        const name = AGENT_SKILLS[key] ? key : `brainspace-${key}`
        const extra = name === 'brainspace-flows' ? `\n\n---\n# references/sdk.d.ts\n\n\`\`\`ts\n${FLOW_SDK_TYPES}\n\`\`\`\n` : ''
        return `skill: ${name} (ships with Brainspace)\n---\n${builtIn}${extra}`
      }
      return `skill: ${s.name}\npath: ${s.path}\nsupporting files: ${s.files.join(', ') || 'none'}\n---\n${s.content}`
    },
  },

  // Workspace & people ---------------------------------------------------
  {
    name: 'workspaces_list',
    title: 'List workspaces',
    description: 'Workspaces you belong to.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => (await ws.listWorkspaces(actor.userId)).map((w) => ({ ...w, current: w.id === actor.workspaceId })),
  },
  {
    name: 'workspace_switch',
    title: 'Switch workspace',
    description: 'Make another workspace your default. Takes effect on the next tool call. (API keys are tied to one workspace and ignore this.)',
    schema: z.object({ workspace: z.string().describe('Workspace slug or id') }),
    readOnly: false,
    run: async (actor, a) => {
      const all = await ws.listWorkspaces(actor.userId)
      const w = all.find((x) => x.slug === a.workspace || x.id === a.workspace)
      if (!w) throw new AppError('not_found', `Workspace "${a.workspace}" not found.`, { hint: 'Use workspaces_list.' })
      await ws.setDefaultWorkspace(actor.userId, w.id)
      return { switchedTo: w.name, note: 'Your next tool call runs in this workspace.' }
    },
  },
  {
    name: 'workspace_create',
    title: 'Create workspace',
    description: 'Create a new workspace (with starter folders) and make it your default. You become its admin.',
    schema: z.object({ name: z.string().min(1).max(80) }),
    run: async (actor, a) => ws.createWorkspace({ id: actor.userId, name: actor.userName, email: actor.email }, a.name),
  },
  {
    name: 'workspace_rename',
    title: 'Rename workspace',
    description: 'Rename the current workspace.',
    schema: z.object({ name: z.string().min(1).max(80) }),
    minRole: 'admin',
    run: async (actor, a) => ws.renameWorkspace(actor, a.name),
  },
  {
    name: 'members_list',
    title: 'List members',
    description: 'Everyone in the workspace with their role (admin, member, viewer), plus pending invites.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => ({
      roles: Object.fromEntries(Object.entries(ROLE_SUMMARY).map(([k, v]) => [k, `${ROLE_LABEL[k as 'admin']}: ${v}`])),
      members: (await ws.listMembers(actor)).map((m) => ({ name: m.name, email: m.email, role: m.role, you: m.you })),
      pendingInvites: atLeast(actor, 'member') ? await ws.listInvites(actor) : undefined,
      autoJoin: await ws.getAutoJoin(actor),
    }),
  },
  {
    name: 'workspace_auto_join',
    title: 'Auto-join by email domain',
    description:
      "Turn on auto-join so anyone who signs in with a verified email on your company domain (the domain of your own email, e.g. @acme.com) joins this workspace automatically with the given role. Existing users on that domain are added right away. Public domains like gmail.com aren't allowed. Admins only.",
    schema: z.object({
      enabled: z.boolean(),
      role: z.enum(['admin', 'member', 'viewer']).optional().describe('Role for people who join this way. Default member.'),
    }),
    minRole: 'admin',
    run: async (actor, a) => ws.setAutoJoin(actor, a),
  },
  {
    name: 'member_invite',
    title: 'Invite member',
    description:
      'Invite someone by email with a role: admin (full control), member (everything except destructive actions) or viewer (read-only). Omit email to get a shareable join link. Returns the invite URL.',
    schema: z.object({
      email: z.string().optional(),
      role: z.enum(['admin', 'member', 'viewer']).default('member'),
      sendEmail: z.boolean().optional().describe('Email the invite. Default true when email is set.'),
    }),
    minRole: 'member',
    run: async (actor, a) => ws.invite(actor, a),
  },
  {
    name: 'invite_revoke',
    title: 'Revoke invite',
    description: 'Revoke a pending invite by id (from members_list).',
    schema: z.object({ id: z.string() }),
    minRole: 'member',
    run: async (actor, a) => ws.revokeInvite(actor, a.id),
  },
  {
    name: 'member_set_role',
    title: 'Change role',
    description: "Change a member's role. Admins only.",
    schema: z.object({ member: z.string().describe('Email or user id'), role: z.enum(['admin', 'member', 'viewer']) }),
    minRole: 'admin',
    run: async (actor, a) => ws.setRole(actor, a.member, a.role),
  },
  {
    name: 'member_remove',
    title: 'Remove member',
    description: 'Remove someone from the workspace and revoke their API keys. Admins only. Their private drive is kept in case they return.',
    schema: z.object({ member: z.string().describe('Email or user id') }),
    minRole: 'admin',
    destructive: true,
    run: async (actor, a) => ws.removeMember(actor, a.member),
  },
  {
    name: 'api_key_create',
    title: 'Create API key',
    description: 'Create an API key for an agent or script. It acts as you, in this workspace, with your role. The key is shown once.',
    schema: z.object({ name: z.string().max(80) }),
    run: async (actor, a) => ws.createApiKey(actor, a.name),
  },
  {
    name: 'api_keys_list',
    title: 'List API keys',
    description: 'Your API keys (admins see everyone\'s).',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => ws.listApiKeys(actor),
  },
  {
    name: 'api_key_revoke',
    title: 'Revoke API key',
    description: 'Revoke an API key by id.',
    schema: z.object({ id: z.string() }),
    run: async (actor, a) => ws.revokeApiKey(actor, a.id),
  },

  // Connections ----------------------------------------------------------
  {
    name: 'connections_list',
    title: 'List connections',
    description:
      'Third-party tools the team has connected (HubSpot, PostHog, Context.dev...). Their tools are exposed here as <slug>__<tool>, or call them through connection_call.',
    schema: z.object({ includeUnavailable: z.boolean().optional() }),
    readOnly: true,
    run: async (actor, a) =>
      (await conns.listConnections(actor, { usableOnly: !a.includeUnavailable })).map((c) => ({
        slug: c.slug,
        name: c.name,
        type: c.type,
        url: c.url,
        status: c.status,
        statusMessage: c.statusMessage,
        auth: c.authType,
        credentialMode: c.credentialMode,
        tools: c.toolCount,
        mode: c.effectiveToolMode,
        usable: c.usable,
        minRole: c.minRole,
        access: c.accessMode,
        instructions: c.instructions,
      })),
  },
  {
    name: 'connection_presets',
    title: 'Connection presets',
    description: 'Known services you can connect with connection_add, and what credentials each needs.',
    schema: z.object({}),
    readOnly: true,
    run: async () =>
      PRESETS.map((p) => ({ id: p.id, name: p.name, url: p.url, auth: p.authType, fields: p.fields?.map((f) => f.key), setup: p.setup, description: p.description })),
  },
  {
    name: 'connection_add',
    title: 'Add connection',
    description:
      'Connect an MCP server or HTTP API for the whole team. Use presetId for known services, or pass url. For bearer/API-key auth pass token. For OAuth services the result includes authorizeUrl: give it to the user to open in a browser.',
    schema: z.object({
      presetId: z.string().optional(),
      name: z.string().optional(),
      slug: z.string().optional().describe('Short prefix for proxied tool names, e.g. "hubspot".'),
      type: z.enum(['mcp', 'http']).optional(),
      url: z.string().optional(),
      authType: z.enum(['none', 'bearer', 'headers', 'oauth']).optional(),
      token: z.string().optional().describe('API key or token, sent as "Authorization: Bearer <token>".'),
      headers: z.record(z.string(), z.string()).optional().describe('Custom auth headers, e.g. {"X-Api-Key": "..."}'),
      oauthClientId: z.string().optional(),
      oauthClientSecret: z.string().optional(),
      credentialMode: z.enum(['shared', 'per_user']).optional().describe('shared: one login for the team. per_user: each person authorizes their own account.'),
      instructions: z.string().optional().describe('Guidance for agents on when and how to use this connection.'),
    }),
    minRole: 'member',
    run: async (actor, a) => conns.addConnection(actor, a),
  },
  {
    name: 'connection_update',
    title: 'Update connection',
    description:
      'Change a connection: rotate its token, rename it, limit which tools are exposed (toolAllowlist), mark tools read-only for viewers, set agent instructions, or (admins) restrict who can use it.',
    schema: z.object({
      connection: z.string().describe('Slug or id'),
      name: z.string().optional(),
      url: z.string().optional(),
      token: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      exposeTools: z.boolean().optional().describe('false hides its tools from the tool list; they stay reachable through connection_tools.'),
      toolMode: z
        .enum(['auto', 'direct', 'search'])
        .optional()
        .describe('direct: list every tool as <slug>__<tool>. search: agents find tools with connection_tools. auto: search once a connection has more than 30 tools.'),
      toolAllowlist: z.array(z.string()).nullable().optional().describe('Only these tools are available. null = all.'),
      readOnlyTools: z.array(z.string()).nullable().optional().describe('Tools viewers may call.'),
      instructions: z.string().optional(),
      minRole: z.enum(['admin', 'member', 'viewer']).optional(),
      accessMode: z.enum(['all', 'restricted']).optional(),
      allowedUsers: z.array(z.string()).optional().describe('Emails or user ids allowed when accessMode is restricted.'),
    }),
    minRole: 'member',
    run: async (actor, a) => conns.updateConnection(actor, a.connection, a),
  },
  {
    name: 'connection_authorize',
    title: 'Authorize connection',
    description: 'Get a fresh OAuth sign-in link for a connection that needs auth. Give the link to the user to open.',
    schema: z.object({ connection: z.string() }),
    run: async (actor, a) => {
      const url = await conns.startOAuth(actor, a.connection)
      return url ? { authorizeUrl: url, next: 'Open this link in a browser and approve access.' } : { status: 'already authorized' }
    },
  },
  {
    name: 'connection_test',
    title: 'Test connection',
    description: 'Reconnect to the upstream server and refresh its tool list.',
    schema: z.object({ connection: z.string() }),
    run: async (actor, a) => conns.testConnection(actor, a.connection),
  },
  {
    name: 'connection_remove',
    title: 'Remove connection',
    description: 'Remove a connection and its stored credentials. Admins only.',
    schema: z.object({ connection: z.string() }),
    minRole: 'admin',
    destructive: true,
    run: async (actor, a) => conns.removeConnection(actor, a.connection),
  },
  {
    name: 'connection_tools',
    title: 'Find connection tools',
    description:
      'Search the tools of every connected service by what you want to do, e.g. "find a company\'s logo" or "list open deals". Without a query, lists one connection\'s tools. Large connections are only reachable this way, so search here when connections_list shows mode "search". Returns tool names and one-line summaries; get schemas with connection_describe.',
    schema: z.object({
      query: z.string().optional().describe('What you want to do, in plain words.'),
      connection: z.string().optional().describe('Limit to one connection (slug).'),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnly: true,
    run: async (actor, a) => conns.searchTools(actor, a),
  },
  {
    name: 'connection_describe',
    title: 'Describe connection tools',
    description: 'Full description and input schema for up to 10 tools on one connection. Call it before connection_call so you pass the right arguments.',
    schema: z.object({ connection: z.string(), tools: z.array(z.string()).min(1).max(10) }),
    readOnly: true,
    run: async (actor, a) => conns.describeTools(actor, a.connection, a.tools),
  },
  {
    name: 'connection_call',
    title: 'Call connection tool',
    description:
      'Call a tool on a connected service. Results over 40,000 characters are cut, and the rest can be read with connection_result.',
    schema: z.object({
      connection: z.string(),
      tool: z.string().describe('Tool name as returned by connection_tools (the upstream name or the <slug>__ name).'),
      arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe('Object, or a JSON string of one.'),
    }),
    run: async (actor, a) => conns.callConnectionTool(actor, a.connection, a.tool, a.arguments ?? {}),
  },
  {
    name: 'connection_result',
    title: 'Read a long result',
    description: 'Page through a connection tool result that was too long to return at once. Use the id and nextOffset from the truncation note.',
    schema: z.object({ id: z.string(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1000).max(40000).optional() }),
    readOnly: true,
    run: async (actor, a) => conns.readStoredResult(actor, a.id, a),
  },
  ...FLOW_TOOLS,
]

export function visibleTools(actor: Actor) {
  return TOOLS.filter((t) => {
    if (t.minRole && !atLeast(actor, t.minRole)) return false
    if (actor.role === 'viewer' && !t.readOnly && !['api_key_create', 'api_key_revoke', 'workspace_switch', 'workspace_create', 'connection_call', 'connection_authorize', 'connection_test'].includes(t.name)) return false
    return true
  })
}

export function toolResult(value: unknown): ToolResult {
  if (value && typeof value === 'object' && 'content' in (value as object) && Array.isArray((value as ToolResult).content)) {
    return value as ToolResult
  }
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] }
  return json(value)
}

export { getEnv }
