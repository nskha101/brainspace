import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { addConnectionFn } from '../lib/api'
import { logoUrl, presetById, siteDomain, type ConnectionPreset } from '../lib/presets'
import { Button, CopyField, Field, Input, Modal, Select, Textarea } from './ui'
import { errMessage } from '../lib/utils'

const RETURN_COOKIE = 'bs_connect_return'

/**
 * Where the OAuth callback sends the browser after a sign-in. Without a path it goes back to the
 * Connections page, so a stale value from an earlier attempt is cleared.
 */
export function rememberConnectReturn(path?: string) {
  document.cookie = path
    ? `${RETURN_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=900; samesite=lax`
    : `${RETURN_COOKIE}=; path=/; max-age=0; samesite=lax`
}

/**
 * A connection's logo: the known service's, else the icon its MCP server names, else the favicon of the site its URL
 * is on. Falls through to the next one when an image doesn't load.
 */
export function ConnLogo({ presetId, url, iconUrl, size = 20 }: { presetId: string | null; url?: string | null; iconUrl?: string | null; size?: number }) {
  const sources = [logoUrl(presetById(presetId)?.domain ?? ''), iconUrl ?? '', logoUrl(siteDomain(url))].filter(Boolean)
  const [failed, setFailed] = useState(0)
  const src = sources[failed]
  return src ? (
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded" onError={() => setFailed((n) => n + 1)} />
  ) : (
    <span className="shrink-0 rounded bg-line" style={{ width: size, height: size }} />
  )
}

/** The form for one new connection. `returnTo` is the page to come back to after an OAuth sign-in. */
export function AddConnection({
  preset,
  callbackUrl,
  slackAppReady,
  onClose,
  returnTo,
}: {
  preset: ConnectionPreset
  callbackUrl: string
  slackAppReady: boolean
  onClose: () => void
  returnTo?: string
}) {
  const router = useRouter()
  const custom = preset.id === 'custom-mcp' || preset.id === 'custom-http'
  const slack = preset.type === 'slack'
  const [name, setName] = useState(custom ? '' : preset.name)
  const [slug, setSlug] = useState(preset.slug)
  const [url, setUrl] = useState(preset.url)
  // Without a Slack app on this server, Slack can only connect with a bot token.
  const [authType, setAuthType] = useState(slack && !slackAppReady ? 'bearer' : preset.authType)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [headerName, setHeaderName] = useState('Authorization')
  const [headerValue, setHeaderValue] = useState('')
  const [mode, setMode] = useState<'shared' | 'per_user'>(preset.credentialMode ?? 'shared')
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
        rememberConnectReturn(returnTo)
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
            {authType === 'oauth' ? (slack ? 'Add to Slack' : 'Continue to sign in') : 'Connect'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {preset.setup && <p className="rounded-md bg-paper px-3 py-2.5 text-[13px] text-ink-2">{preset.setup}</p>}
        {slack && (
          <div className="space-y-2 rounded-md bg-paper px-3 py-2.5 text-[13px] text-ink-2">
            {authType === 'oauth' ? (
              <p>
                Slack asks you to pick a workspace and approve the Brainspace app. After that, flows and agents can post to its channels
                and DMs. Messages come from the app, not from you.
              </p>
            ) : (
              <p>
                {slackAppReady ? 'Paste' : "Add to Slack isn't set up on this server. Paste"} a bot token from a Slack app you made. It needs
                the chat:write scope, plus files:write for files and channels:read to find channels by name.
              </p>
            )}
            {slackAppReady && (
              <button className="text-brand-ink hover:underline" onClick={() => setAuthType(authType === 'oauth' ? 'bearer' : 'oauth')}>
                {authType === 'oauth' ? 'Use a bot token instead' : 'Use Add to Slack instead'}
              </button>
            )}
          </div>
        )}
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
        {authType === 'oauth' && !slack && (
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
