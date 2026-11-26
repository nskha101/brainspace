import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, RefreshCw } from 'lucide-react'
import {
  authorizeConnectionFn,
  connectionToolsFn,
  connectionsFn,
  removeConnectionFn,
  testConnectionFn,
  updateConnectionFn,
} from '../lib/api'
import { PRESETS, type ConnectionPreset } from '../lib/presets'
import { AddConnection, ConnLogo, rememberConnectReturn } from '../components/AddConnection'
import { ConfirmDialog } from '../components/FileDialogs'
import { PeoplePicker } from '../components/PeoplePicker'
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui'
import { errMessage, timeAgo } from '../lib/utils'

type S = { connected?: string; error?: string }

export const Route = createFileRoute('/app/connections')({
  validateSearch: (s: Record<string, unknown>): S => ({
    connected: typeof s.connected === 'string' ? s.connected : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
  loader: () => connectionsFn(),
  component: ConnectionsPage,
})

type Data = Awaited<ReturnType<typeof connectionsFn>>
type Conn = Data['connections'][number]

function StatusBadge({ c }: { c: Conn }) {
  if (c.status === 'active') return <Badge tone="ok">active</Badge>
  if (c.status === 'needs_auth') return <Badge tone="danger">needs sign-in</Badge>
  return <Badge tone="danger">error</Badge>
}

function ConnectionsPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [adding, setAdding] = useState<ConnectionPreset | null>(null)
  const [picker, setPicker] = useState(false)
  const [selected, setSelected] = useState<Conn | null>(null)
  const canAdd = data.role !== 'viewer'

  useEffect(() => {
    if (search.connected) toast.success(`${search.connected} is connected`)
    if (search.error) toast.error(search.error)
    if (search.connected || search.error) navigate({ search: {}, replace: true })
  }, [search.connected, search.error])

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Connections"
        description="Services connected once for the whole team. Agents reach their tools through Brainspace as <name>__<tool>, scoped by role, without ever seeing the credentials."
        actions={
          canAdd && (
            <Button variant="primary" onClick={() => setPicker(true)}>
              <Plus className="size-4" /> Add connection
            </Button>
          )
        }
      />

      {data.connections.length === 0 ? (
        <Empty
          title="Nothing connected yet"
          action={canAdd && <Button onClick={() => setPicker(true)}>Add your first connection</Button>}
        >
          Connect Slack, HubSpot, PostHog, Context.dev, Linear, any MCP server or a REST API.
        </Empty>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.connections.map((c) => (
            <li key={c.id}>
              <button onClick={() => setSelected(c)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-paper">
                <ConnLogo presetId={c.presetId} url={c.url} iconUrl={c.iconUrl} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="font-mono text-[12px] text-ink-3">{c.slug}__*</span>
                  </div>
                  <div className="truncate text-[13px] text-ink-2">
                    {c.type === 'http' ? 'HTTP API' : c.type === 'slack' ? 'Slack app' : c.type === 'gdrive' ? 'Drive API' : 'MCP'} · {c.toolCount} tools
                    {c.effectiveToolMode === 'search' ? ' · found by search' : ''}
                    {c.credentialMode === 'per_user' ? ' · each person signs in' : ''}
                    {c.accessMode === 'restricted' ? ' · restricted' : ''}
                    {c.minRole !== 'viewer' ? ` · ${c.minRole}s and up` : ''}
                  </div>
                </div>
                {!c.usable && <Badge>no access</Badge>}
                <StatusBadge c={c} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={picker} onClose={() => setPicker(false)} title="Add a connection" width={640}>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPicker(false)
                setAdding(p)
              }}
              className="flex items-start gap-3 rounded-lg border border-line p-3 text-left hover:border-line-2 hover:bg-paper"
            >
              <ConnLogo presetId={p.id} size={22} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="block text-[12.5px] leading-snug text-ink-2">{p.description}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {adding && <AddConnection preset={adding} callbackUrl={data.callbackUrl} slackAppReady={data.slackAppReady} onClose={() => setAdding(null)} />}
      {selected && (
        <ConnectionDetail
          key={selected.id}
          conn={data.connections.find((c) => c.id === selected.id) ?? selected}
          data={data}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

type ToolsData = Awaited<ReturnType<typeof connectionToolsFn>>

function ConnectionDetail({ conn, data, onClose }: { conn: Conn; data: Data; onClose: () => void }) {
  const router = useRouter()
  const isAdmin = data.role === 'admin'
  const canEdit = data.role !== 'viewer'
  const [tools, setTools] = useState<ToolsData['tools'] | null>(null)
  const [allow, setAllow] = useState<Set<string> | null>(conn.toolAllowlist ? new Set(conn.toolAllowlist) : null)
  const [readOnly, setReadOnly] = useState<Set<string>>(new Set(conn.readOnlyTools ?? []))
  const [instructions, setInstructions] = useState(conn.instructions ?? '')
  const [minRole, setMinRole] = useState(conn.minRole)
  const [toolMode, setToolMode] = useState(conn.toolMode)
  const [accessMode, setAccessMode] = useState(conn.accessMode)
  const [allowedUsers, setAllowedUsers] = useState<Set<string>>(new Set(conn.allowedUserIds))
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (conn.usable) connectionToolsFn({ data: { id: conn.id } }).then((r) => setTools(r.tools)).catch(() => setTools([]))
  }, [conn.id, conn.toolsCachedAt])

  async function act(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label)
    try {
      await fn()
      if (ok) toast.success(ok)
      await router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    act(
      'save',
      () =>
        updateConnectionFn({
          data: {
            id: conn.id,
            instructions,
            toolAllowlist: allow ? [...allow] : null,
            readOnlyTools: [...readOnly],
            toolMode,
            ...(token ? { token } : {}),
            ...(isAdmin ? { minRole, accessMode, allowedUsers: [...allowedUsers] } : {}),
          },
        }),
      'Saved',
    )

  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><ConnLogo presetId={conn.presetId} url={conn.url} iconUrl={conn.iconUrl} />{conn.name}</span>} width={720}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge c={conn} />
          <span className="font-mono text-[12.5px] text-ink-2">{conn.url}</span>
          {conn.toolsCachedAt && <span className="text-ink-3">tools refreshed {timeAgo(conn.toolsCachedAt)}</span>}
        </div>
        {conn.statusMessage && conn.status !== 'active' && <p className="rounded-md bg-danger-wash px-3 py-2 text-[13px] text-danger">{conn.statusMessage}</p>}

        <div className="flex flex-wrap gap-2">
          {conn.type === 'slack' && data.slackAppReady && canEdit && (
            <Button
              variant={conn.status === 'active' ? 'secondary' : 'brand'}
              size="sm"
              loading={busy === 'auth'}
              onClick={() =>
                act('auth', async () => {
                  const r = await authorizeConnectionFn({ data: { id: conn.id } })
                  rememberConnectReturn()
                  if (r.url) window.location.href = r.url
                })
              }
            >
              {conn.status === 'active' ? 'Reinstall in Slack' : 'Add to Slack'}
            </Button>
          )}
          {conn.type !== 'slack' && conn.authType === 'oauth' && (conn.status !== 'active' || conn.credentialMode === 'per_user') && (
            <Button
              variant="brand"
              size="sm"
              loading={busy === 'auth'}
              onClick={() =>
                act('auth', async () => {
                  const r = await authorizeConnectionFn({ data: { id: conn.id } })
                  rememberConnectReturn()
                  if (r.url) window.location.href = r.url
                })
              }
            >
              {conn.credentialMode === 'per_user' ? 'Connect my account' : 'Sign in'}
            </Button>
          )}
          {conn.type === 'mcp' && conn.usable && (
            <Button size="sm" loading={busy === 'test'} onClick={() => act('test', () => testConnectionFn({ data: { id: conn.id } }), 'Connection works')}>
              <RefreshCw className="size-3.5" /> Test and refresh tools
            </Button>
          )}
          {(conn.type === 'slack' || conn.type === 'gdrive') && conn.usable && (
            <Button size="sm" loading={busy === 'test'} onClick={() => act('test', () => testConnectionFn({ data: { id: conn.id } }), `${conn.name} connection works`)}>
              <RefreshCw className="size-3.5" /> Test connection
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-wash hover:text-danger" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          )}
        </div>

        {conn.type === 'slack' && (
          <p className="rounded-md bg-paper px-3 py-2.5 text-[13px] text-ink-2">
            Posts come from the app. It can post in any public channel without being added. For a private or Slack Connect channel, invite it
            first: type <span className="font-mono text-[12.5px]">/invite @Brainspace</span> in the channel. In flows, use{' '}
            <span className="font-mono text-[12.5px]">connections.call('{conn.slug}', 'post_message', ...)</span> or a destination with{' '}
            <span className="font-mono text-[12.5px]">"connection": "{conn.slug}"</span>.
          </p>
        )}

        {canEdit && (conn.authType === 'bearer' || conn.authType === 'headers') && (
          <Field label="Replace token" hint="Leave empty to keep the current one.">
            <Input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={conn.type === 'slack' ? 'New bot token (xoxb-...)' : 'New API key'}
            />
          </Field>
        )}

        <Field label="Notes for agents">
          <Textarea rows={2} value={instructions} readOnly={!canEdit} onChange={(e) => setInstructions(e.target.value)} placeholder="When and how agents should use this." />
        </Field>

        {canEdit && conn.type === 'mcp' && (
          <Field
            label="How agents see its tools"
            hint={
              toolMode === 'direct'
                ? 'Every tool is in the agent’s tool list as ' + conn.slug + '__<tool>.'
                : toolMode === 'search'
                  ? 'Tools stay out of the list. Agents find them with connection_tools, which saves context on big connections.'
                  : `Listed directly up to 30 tools, found by search above that. Right now: ${conn.effectiveToolMode === 'search' ? 'search' : 'listed directly'}.`
            }
          >
            <Select value={toolMode} onChange={(e) => setToolMode(e.target.value as typeof toolMode)} className="w-full">
              <option value="auto">Automatic</option>
              <option value="direct">List every tool</option>
              <option value="search">Find by search</option>
            </Select>
          </Field>
        )}

        {isAdmin && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who can use it">
              <Select value={minRole} onChange={(e) => setMinRole(e.target.value as never)} className="w-full">
                <option value="viewer">Everyone (read-only members get read-only tools)</option>
                <option value="member">Members and admins</option>
                <option value="admin">Admins only</option>
              </Select>
            </Field>
            <Field label="Access">
              <Select value={accessMode} onChange={(e) => setAccessMode(e.target.value as never)} className="w-full">
                <option value="all">Everyone with that role</option>
                <option value="restricted">Only people I pick</option>
              </Select>
            </Field>
            {accessMode === 'restricted' && (
              <div className="sm:col-span-2">
                <div className="mb-1.5 text-[13px] font-medium text-ink-2">People with access (admins always have it)</div>
                <PeoplePicker people={data.members} picked={allowedUsers} onChange={setAllowedUsers} empty="Nobody picked yet, so only admins can use it." />
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Tools {tools ? `(${tools.length})` : ''}</span>
            {canEdit && tools && tools.length > 0 && (
              <button className="text-[12.5px] text-brand-ink hover:underline" onClick={() => setAllow(allow ? null : new Set(tools.map((t) => t.name)))}>
                {allow ? 'Allow all tools' : 'Pick which tools to allow'}
              </button>
            )}
          </div>
          {!conn.usable ? (
            <p className="text-sm text-ink-3">You don't have access to this connection.</p>
          ) : !tools ? (
            <p className="text-sm text-ink-3">Loading tools…</p>
          ) : tools.length === 0 ? (
            <p className="text-sm text-ink-3">{conn.status === 'active' ? 'No tools reported.' : 'Sign in to load tools.'}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {tools.map((t) => (
                <li key={t.name} className="flex items-start gap-3 px-3 py-2">
                  {allow && canEdit && (
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--color-brand)]"
                      checked={allow.has(t.name)}
                      onChange={(e) => {
                        const next = new Set(allow)
                        if (e.target.checked) next.add(t.name)
                        else next.delete(t.name)
                        setAllow(next)
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12.5px]">{t.proxiedName ?? t.name}</div>
                    {t.description && <div className="line-clamp-2 text-[12.5px] text-ink-2">{t.description}</div>}
                  </div>
                  {canEdit && (
                    <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-3" title="Read-only members can call this tool">
                      <input
                        type="checkbox"
                        className="accent-[var(--color-agent)]"
                        checked={readOnly.has(t.name) || t.annotations?.readOnlyHint === true}
                        disabled={t.annotations?.readOnlyHint === true}
                        onChange={(e) => {
                          const next = new Set(readOnly)
                          if (e.target.checked) next.add(t.name)
                          else next.delete(t.name)
                          setReadOnly(next)
                        }}
                      />
                      read-only
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={save} loading={busy === 'save'}>
              Save changes
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${conn.name}?`}
        confirm="Remove"
        danger
        onConfirm={async () => {
          await act('remove', () => removeConnectionFn({ data: { id: conn.id } }), `${conn.name} removed`)
          onClose()
        }}
      >
        Its stored credentials are deleted and agents lose its tools right away.
      </ConfirmDialog>
    </Modal>
  )
}
