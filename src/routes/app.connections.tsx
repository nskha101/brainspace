import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, RefreshCw } from 'lucide-react'
import {
  addConnectionFn,
  authorizeConnectionFn,
  connectionToolsFn,
  connectionsFn,
  removeConnectionFn,
  testConnectionFn,
  updateConnectionFn,
} from '../lib/api'
import { PRESETS, logoUrl, presetById, type ConnectionPreset } from '../lib/presets'
import { ConfirmDialog } from '../components/FileDialogs'
import { Badge, Button, CopyField, Empty, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui'
import { cn, errMessage, timeAgo } from '../lib/utils'

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

function ConnLogo({ presetId, size = 20 }: { presetId: string | null; size?: number }) {
  const domain = presetById(presetId)?.domain
  return domain ? (
    <img src={logoUrl(domain)} alt="" width={size} height={size} className="shrink-0 rounded" />
  ) : (
    <span className="shrink-0 rounded bg-line" style={{ width: size, height: size }} />
  )
}

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
          Connect HubSpot, PostHog, Context.dev, Linear, any MCP server or a REST API.
        </Empty>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.connections.map((c) => (
            <li key={c.id}>
              <button onClick={() => setSelected(c)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-paper">
                <ConnLogo presetId={c.presetId} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="font-mono text-[12px] text-ink-3">{c.slug}__*</span>
                  </div>
                  <div className="truncate text-[13px] text-ink-2">
                    {c.type === 'http' ? 'HTTP API' : 'MCP'} · {c.toolCount} tools
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

      {adding && <AddConnection preset={adding} callbackUrl={data.callbackUrl} onClose={() => setAdding(null)} />}
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

function AddConnection({ preset, callbackUrl, onClose }: { preset: ConnectionPreset; callbackUrl: string; onClose: () => void }) {
  const router = useRouter()
  const custom = preset.id === 'custom-mcp' || preset.id === 'custom-http'
  const [name, setName] = useState(custom ? '' : preset.name)
  const [slug, setSlug] = useState(preset.slug)
  const [url, setUrl] = useState(preset.url)
  const [authType, setAuthType] = useState(preset.authType)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [headerName, setHeaderName] = useState('Authorization')
  const [headerValue, setHeaderValue] = useState('')
  const [mode, setMode] = useState<'shared' | 'per_user'>('shared')
  const [instructions, setInstructions] = useState(preset.instructions ?? '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const r = await addConnectionFn({
        data: {
          presetId: custom ? undefined : preset.id,
          name: name || undefined,
          slug: slug || undefined,
          url,
          type: preset.type,
          authType,
          token: authType === 'bearer' ? fields.token : undefined,
          headers: authType === 'headers' && headerValue ? { [headerName]: headerValue } : undefined,
          oauthClientId: fields.clientId || undefined,
          oauthClientSecret: fields.clientSecret || undefined,
          credentialMode: mode,
          instructions: instructions || undefined,
        },
      })
      if (r.authorizeUrl) {
        window.location.href = r.authorizeUrl
        return
      }
      if (r.connection?.status === 'active') toast.success(`${r.connection.name} connected with ${r.connection.toolCount} tools`)
      else toast.error(r.connection?.statusMessage ?? 'Saved, but the first connection attempt failed')
      router.invalidate()
      onClose()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Connect ${preset.name}`}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {authType === 'oauth' ? 'Continue to sign in' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {preset.setup && <p className="rounded-md bg-paper px-3 py-2.5 text-[13px] text-ink-2">{preset.setup}</p>}
        {(custom || preset.needsOAuthClient) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme API" />
            </Field>
            <Field label="Tool prefix" hint="Tools show up as prefix__tool.">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" className="font-mono text-[13px]" />
            </Field>
          </div>
        )}
        {custom && (
          <Field label={preset.type === 'http' ? 'Base URL' : 'MCP server URL'}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={preset.type === 'http' ? 'https://api.example.com/v1' : 'https://mcp.example.com/mcp'} className="font-mono text-[13px]" />
          </Field>
        )}
        {preset.id === 'custom-mcp' && (
          <Field label="Authentication">
            <Select value={authType} onChange={(e) => setAuthType(e.target.value as never)} className="w-full">
              <option value="bearer">API key or token (Bearer)</option>
              <option value="headers">Custom header</option>
              <option value="oauth">OAuth sign-in</option>
              <option value="none">None</option>
            </Select>
          </Field>
        )}
        {authType === 'bearer' &&
          (preset.fields?.length && !preset.needsOAuthClient ? preset.fields : [{ key: 'token', label: 'Token', secret: true, placeholder: 'sk_...' }]).map((f) => (
            <Field key={f.key} label={f.label} hint={f.help}>
              <Input type="password" autoComplete="off" value={fields[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
            </Field>
          ))}
        {authType === 'headers' && (
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Field label="Header">
              <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} className="font-mono text-[13px]" />
            </Field>
            <Field label="Value">
              <Input type="password" autoComplete="off" value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} placeholder="Bearer sk_..." />
            </Field>
          </div>
        )}
        {authType === 'oauth' && (
          <>
            {preset.needsOAuthClient &&
              preset.fields?.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Input type={f.secret ? 'password' : 'text'} autoComplete="off" value={fields[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
                </Field>
              ))}
            {preset.needsOAuthClient && (
              <Field label="Redirect URL for your OAuth app">
                <CopyField value={callbackUrl} />
              </Field>
            )}
            <Field label="Who signs in" hint={mode === 'shared' ? 'You sign in once and the whole team uses that account. Good for analytics and shared data.' : 'Each person authorizes their own account, and calls run as them. Good for email, calendars and anything personal.'}>
              <Select value={mode} onChange={(e) => setMode(e.target.value as never)} className="w-full">
                <option value="shared">One shared account for the team</option>
                <option value="per_user">Each person signs in</option>
              </Select>
            </Field>
          </>
        )}
        <Field label="Notes for agents" hint="When and how agents should use it. Shown in every tool description.">
          <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Use for CRM lookups. Ask before creating or changing records." />
        </Field>
      </div>
    </Modal>
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
            ...(token ? { token } : {}),
            ...(isAdmin ? { minRole, accessMode, allowedUsers: [...allowedUsers] } : {}),
          },
        }),
      'Saved',
    )

  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><ConnLogo presetId={conn.presetId} />{conn.name}</span>} width={720}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge c={conn} />
          <span className="font-mono text-[12.5px] text-ink-2">{conn.url}</span>
          {conn.toolsCachedAt && <span className="text-ink-3">tools refreshed {timeAgo(conn.toolsCachedAt)}</span>}
        </div>
        {conn.statusMessage && conn.status !== 'active' && <p className="rounded-md bg-danger-wash px-3 py-2 text-[13px] text-danger">{conn.statusMessage}</p>}

        <div className="flex flex-wrap gap-2">
          {conn.authType === 'oauth' && (conn.status !== 'active' || conn.credentialMode === 'per_user') && (
            <Button
              variant="brand"
              size="sm"
              loading={busy === 'auth'}
              onClick={() =>
                act('auth', async () => {
                  const r = await authorizeConnectionFn({ data: { id: conn.id } })
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
          {isAdmin && (
            <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-wash hover:text-danger" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          )}
        </div>

        {canEdit && (conn.authType === 'bearer' || conn.authType === 'headers') && (
          <Field label="Replace token" hint="Leave empty to keep the current one.">
            <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="New API key" />
          </Field>
        )}

        <Field label="Notes for agents">
          <Textarea rows={2} value={instructions} readOnly={!canEdit} onChange={(e) => setInstructions(e.target.value)} placeholder="When and how agents should use this." />
        </Field>

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
                <div className="flex flex-wrap gap-1.5">
                  {data.members.map((m) => {
                    const on = allowedUsers.has(m.userId)
                    return (
                      <button
                        key={m.userId}
                        onClick={() => {
                          const next = new Set(allowedUsers)
                          if (on) next.delete(m.userId)
                          else next.add(m.userId)
                          setAllowedUsers(next)
                        }}
                        className={cn('rounded-md border px-2 py-1 text-[13px]', on ? 'border-ink bg-ink text-white' : 'border-line-2 hover:bg-wash')}
                      >
                        {m.name}
                      </button>
                    )
                  })}
                </div>
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
