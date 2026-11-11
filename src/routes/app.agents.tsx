import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { apiKeysFn, authConfigFn, createApiKeyFn, oauthAgentsFn, revokeApiKeyFn, revokeOauthAgentFn } from '../lib/api'
import { AgentSetup } from '../components/AgentSetup'
import { repoClaudeSettings } from '../lib/agent-links'
import { Badge, Button, CopyField, Empty, Input, Modal, PageHeader } from '../components/ui'
import { errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/agents')({
  loader: async () => {
    const [keys, agents, config] = await Promise.all([apiKeysFn(), oauthAgentsFn(), authConfigFn()])
    return { keys, agents, base: config.appUrl.replace(/\/$/, '') }
  },
  component: AgentsPage,
})

const AGENT_SKILLS = [
  ['brainspace', 'Core conventions: paths, versions, promoting, skills, errors.'],
  ['brainspace-setup', 'Fills in a new workspace from the company website and your answers.'],
  ['brainspace-import', 'Brings your CLAUDE.md, AGENTS.md, local skills and notes into Brainspace.'],
  ['brainspace-capture', 'Files decisions and facts from a session into the right doc.'],
  ['brainspace-review', 'Digests recent changes and rolls back bad edits.'],
  ['brainspace-skills', 'Writing and sharing team skills.'],
  ['brainspace-brand-kit', 'Building the brand kit and using it for anything visual.'],
  ['brainspace-connections', 'Connecting services and calling their tools.'],
  ['brainspace-admin', 'Members, roles, invites and API keys.'],
] as const

function AgentsPage() {
  const { keys, agents, base } = Route.useLoaderData()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Agents"
        description="Connect your AI agents to Brainspace. They act as you, in this workspace, with your role. Once connected, they can do nearly everything this app does."
      />

      <section className="rounded-xl border border-line p-5">
        <h2 className="font-semibold">Connect an agent</h2>
        <div className="mt-4">
          <AgentSetup base={base} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-sm font-semibold">Add Brainspace to a repository</h2>
        <p className="mb-3 text-[13px] text-ink-3">
          Commit this as <span className="font-mono">.claude/settings.json</span> (or merge it into the one you have). Anyone
          who opens the repo in Claude Code and trusts the folder is offered the Brainspace plugin, then signs in with their own
          account.
        </p>
        <CopyField value={repoClaudeSettings(base)} />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold">Signed-in agents</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-ink-3">No agents have signed in with your account yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {agents.map((a) => (
              <li key={a.clientId} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.name ?? a.clientId}</div>
                  <div className="text-[12.5px] text-ink-3">Connected {timeAgo(a.createdAt)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await revokeOauthAgentFn({ data: { clientId: a.clientId } })
                    toast.success(`${a.name ?? 'Agent'} disconnected`)
                    router.invalidate()
                  }}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">API keys</h2>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" /> New key
          </Button>
        </div>
        <p className="mb-3 text-[13px] text-ink-3">For scripts, CI and agents that can't do a browser sign-in. A key is tied to this workspace and acts with your role.</p>
        {keys.length === 0 ? (
          <Empty title="No API keys" />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {k.name} {!k.yours && <Badge className="ml-1">{k.userName}</Badge>}
                  </div>
                  <div className="font-mono text-[12px] text-ink-3">
                    {k.prefix}… · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await revokeApiKeyFn({ data: { id: k.id } })
                      toast.success('Key revoked')
                      router.invalidate()
                    } catch (e) {
                      toast.error(errMessage(e))
                    }
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-sm font-semibold">Agent skills</h2>
        <p className="mb-3 text-[13px] text-ink-3">
          These ship with Brainspace and teach agents how to use it. The plugin and install commands above add them. Agents without skill support see them as MCP prompts. Your team's own skills live in{' '}
          <span className="font-mono">/team/skills</span>.
        </p>
        <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {AGENT_SKILLS.map(([n, d]) => (
            <li key={n} className="text-sm">
              <a href={`/skills/${n}/SKILL.md`} target="_blank" rel="noreferrer" className="font-mono text-[13px] font-medium hover:underline">
                {n}
              </a>
              <div className="text-ink-2">{d}</div>
            </li>
          ))}
        </ul>
      </section>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setCreated(null)
          setName('')
        }}
        title={created ? 'Copy your key' : 'New API key'}
      >
        {created ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">This is the only time you'll see it.</p>
            <CopyField value={created} />
            <p className="text-sm text-ink-2">Use it as a bearer token against {base}/mcp, for example:</p>
            <CopyField value={`claude mcp add --transport http brainspace ${base}/mcp --header "Authorization: Bearer ${created}"`} />
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                const r = await createApiKeyFn({ data: { name } })
                setCreated(r.token)
                router.invalidate()
              } catch (err) {
                toast.error(errMessage(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="What uses it, e.g. Nightly report bot" />
            <Button type="submit" variant="primary" loading={busy}>
              Create key
            </Button>
          </form>
        )}
      </Modal>
    </div>
  )
}
