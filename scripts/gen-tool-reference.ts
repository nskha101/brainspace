// Generates skills/brainspace/references/tools.md from the live MCP tool
// definitions, so the agent skill never drifts from the server.
// Run with: bun scripts/gen-tool-reference.ts
import { plugin } from 'bun'
import { writeFileSync } from 'node:fs'

plugin({
  name: 'workers-stubs',
  setup(build) {
    build.module('cloudflare:workers', () => ({
      exports: { env: {}, waitUntil: () => {}, DurableObject: class {}, WorkerEntrypoint: class {}, WorkflowEntrypoint: class {}, exports: {} },
      loader: 'object',
    }))
    build.module('@cloudflare/dynamic-workflows', () => ({
      exports: { wrapWorkflowBinding: () => ({}), dispatchWorkflow: async () => null, DynamicWorkflowBinding: class {} },
      loader: 'object',
    }))
    // Flow templates use import.meta.glob; the reference doesn't need them.
    build.onLoad({ filter: /flows\/templates\.ts$/ }, () => ({ exports: { TEMPLATES: [] }, loader: 'object' }))
    build.onLoad({ filter: /flows\/sandbox\/.*\.js$/ }, async (args) => ({
      exports: { default: await Bun.file(args.path).text() },
      loader: 'object',
    }))
    // guide.ts uses Vite's import.meta.glob; the reference doesn't need its content.
    build.onLoad({ filter: /mcp\/guide\.ts$/ }, () => ({
      exports: { AGENT_SKILLS: {}, GUIDE: '', INSTRUCTIONS: '', FLOW_SDK_TYPES: '', skillDescription: () => '' },
      loader: 'object',
    }))
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: new URL(args.path.replace(/\?raw$/, ''), `file://${args.importer}`).pathname,
    }))
    build.onLoad({ filter: /\.md$/ }, async (args) => ({
      exports: { default: await Bun.file(args.path).text() },
      loader: 'object',
    }))
  },
})

const { TOOLS } = await import('../src/server/mcp/tools')
const { z } = await import('zod')

const GROUPS: [string, RegExp][] = [
  ['Orientation', /^(whoami|guide)$/],
  ['Reading and search', /^(list|read|read_many|search|recent|activity)$/],
  ['Writing', /^(write|edit|append|upload|upload_link|upload_link_status|upload_link_revoke|extract_text|describe|mkdir|move|copy|promote)$/],
  ['Versions', /^(history|diff|restore_version)$/],
  ['Trash', /^(delete|trash_)/],
  ['Team skills', /^skill/],
  ['Workspaces', /^workspace(?!_ai$)/],
  ['People and access', /^(members_|member_|invite_|api_key)/],
  ['Connections', /^connection/],
  ['Flows', /^(flow|workspace_ai$|secret)/],
]

type JsonSchema = { properties?: Record<string, { type?: string | string[]; description?: string; enum?: string[]; items?: { type?: string } }>; required?: string[] }

function typeOf(p: { type?: string | string[]; enum?: string[]; items?: { type?: string } }) {
  if (p.enum) return p.enum.map((e) => `"${e}"`).join(' \\| ')
  if (p.type === 'array') return `${p.items?.type ?? 'any'}[]`
  return Array.isArray(p.type) ? p.type.join(' \\| ') : (p.type ?? 'any')
}

const roleNote = (t: (typeof TOOLS)[number]) =>
  t.minRole === 'admin' ? 'admins only' : t.minRole === 'member' ? 'members and admins' : t.readOnly ? 'everyone, read-only' : 'everyone'

let out = `# Brainspace MCP tool reference

Generated from the server's tool definitions by \`scripts/gen-tool-reference.ts\`. Don't edit by hand.

Paths always start with a space: \`/team/...\` (shared) or \`/me/...\` (private). Tools from connected services appear as \`<slug>__<tool>\` and are listed by \`connection_tools\`, not here.

`
for (const [group, re] of GROUPS) {
  const tools = TOOLS.filter((t) => re.test(t.name))
  if (!tools.length) continue
  out += `## ${group}\n\n`
  for (const t of tools) {
    const schema = z.toJSONSchema(t.schema, { io: 'input' }) as JsonSchema
    const props = Object.entries(schema.properties ?? {})
    out += `### \`${t.name}\`\n\n${t.description}\n\nWho: ${roleNote(t)}.${t.destructive ? ' Destructive.' : ''}\n\n`
    if (props.length) {
      out += '| Argument | Type | Required | Notes |\n| --- | --- | --- | --- |\n'
      for (const [name, p] of props) {
        const req = schema.required?.includes(name) ? 'yes' : ''
        out += `| \`${name}\` | ${typeOf(p)} | ${req} | ${(p.description ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`
      }
      out += '\n'
    } else {
      out += 'No arguments.\n\n'
    }
  }
}
const missing = TOOLS.filter((t) => !GROUPS.some(([, re]) => re.test(t.name)))
if (missing.length) throw new Error(`Tools missing from GROUPS: ${missing.map((t) => t.name).join(', ')}`)

writeFileSync('skills/brainspace/references/tools.md', out)

// The flow SDK types, so agents writing flows have the exact API.
const sdk = await Bun.file('src/server/flows/sdk.d.ts').text()
writeFileSync('skills/brainspace-flows/references/sdk.d.ts', `// Generated from src/server/flows/sdk.d.ts. Don't edit by hand.\n${sdk}`)
console.log(`wrote skills/brainspace/references/tools.md (${TOOLS.length} tools)`)
