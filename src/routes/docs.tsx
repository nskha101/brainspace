import { Link, createFileRoute } from '@tanstack/react-router'
import { authConfigFn } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { AgentSetup } from '../components/AgentSetup'

export const Route = createFileRoute('/docs')({
  loader: () => authConfigFn(),
  component: Docs,
})

const TOOL_GROUPS: [string, string[]][] = [
  ['Orientation', ['whoami', 'guide']],
  ['Reading', ['list', 'read', 'read_many', 'search', 'recent', 'activity']],
  ['Writing', ['write', 'edit', 'append', 'upload', 'describe', 'folder_notes', 'mkdir', 'move', 'copy', 'promote']],
  ['Versions', ['history', 'diff', 'restore_version']],
  ['Trash', ['delete', 'trash_list', 'trash_restore', 'trash_purge']],
  ['Skills', ['skills_list', 'skill_get']],
  ['People', ['members_list', 'member_invite', 'member_set_role', 'member_remove', 'invite_revoke', 'api_key_create', 'api_keys_list', 'api_key_revoke']],
  ['Workspaces', ['workspaces_list', 'workspace_switch', 'workspace_create', 'workspace_rename']],
  ['Connections', ['connections_list', 'connection_presets', 'connection_add', 'connection_update', 'connection_authorize', 'connection_test', 'connection_tools', 'connection_call', 'connection_remove']],
]

function Docs() {
  const { appUrl } = Route.useLoaderData()
  const base = appUrl.replace(/\/$/, '')
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link to="/">
        <Wordmark />
      </Link>
      <h1 className="mt-12 text-[34px] font-semibold tracking-[-0.03em]">Connect an agent</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
        Brainspace is a remote MCP server at <code className="font-mono text-[15px] text-ink">{base}/mcp</code>. Agents sign in
        with OAuth as you, or use an API key, and get your role in your workspace.
      </p>
      <div className="mt-8 rounded-xl border border-line bg-sheet p-5">
        <AgentSetup base={base} />
      </div>

      <h2 className="mt-14 text-xl font-semibold">Paths and versions</h2>
      <p className="mt-3 leading-relaxed text-ink-2">
        Every path starts with a space: <code className="font-mono text-[14px]">/team/…</code> is shared,{' '}
        <code className="font-mono text-[14px]">/me/…</code> is private. Every write is a new version. Reads return the
        latest version unless you ask for an older one. Promoting a private doc onto an existing team doc makes it that
        doc's next version, so everyone's agents pick up the change.
      </p>

      <h2 className="mt-14 text-xl font-semibold">Tools</h2>
      <dl className="mt-4 space-y-4">
        {TOOL_GROUPS.map(([g, tools]) => (
          <div key={g} className="grid gap-1 sm:grid-cols-[140px_1fr]">
            <dt className="text-sm font-medium">{g}</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[13px] text-ink-2">
              {tools.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-sm text-ink-2">
        Connected services add their own tools as <code className="font-mono">slug__tool</code>. The full manual is the{' '}
        <a href="/skills/brainspace/SKILL.md" className="text-brand-ink underline underline-offset-4">
          brainspace skill
        </a>
        , and agents can call <code className="font-mono">guide</code> for it.
      </p>
    </div>
  )
}
