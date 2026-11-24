import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import { authorizeConnectionFn, completeWelcomeFn, connectionsFn, getMe, inviteFn, setAutoJoinFn, welcomeFn } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { AgentSetup } from '../components/AgentSetup'
import { ActivityRow } from '../components/ActivityRow'
import { AddConnection, ConnLogo, rememberConnectReturn } from '../components/AddConnection'
import { TOPICS, Tour } from '../components/Tour'
import { Badge, Button, CopyField, Input, Select, Textarea } from '../components/ui'
import { ROLE_LABEL, cn, errMessage } from '../lib/utils'
import { claudeConnectorLink, setupPrompt } from '../lib/agent-links'
import { presetById, type ConnectionPreset } from '../lib/presets'

const STEPS = ['tour', 'agent', 'tools', 'first', 'team'] as const
type Step = (typeof STEPS)[number]
type Search = { step?: Step; topic?: string; connected?: string; error?: string }

export const Route = createFileRoute('/welcome')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    step: STEPS.includes(s.step as Step) ? (s.step as Step) : undefined,
    topic: TOPICS.some((t) => t.id === s.topic) ? (s.topic as string) : undefined,
    connected: typeof s.connected === 'string' ? s.connected : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
  beforeLoad: async () => {
    const me = await getMe()
    if (!me) throw redirect({ to: '/login', search: { redirect: '/welcome' } as never })
    if (!me.current) throw redirect({ to: '/onboarding' })
    return { me }
  },
  loader: async () => {
    const [welcome, conns] = await Promise.all([welcomeFn(), connectionsFn()])
    return { welcome, conns }
  },
  component: Welcome,
})

type Data = Awaited<ReturnType<typeof welcomeFn>>
type Conns = Awaited<ReturnType<typeof connectionsFn>>

const TOURED_KEY = 'brainspace:toured'

function readToured() {
  try {
    return localStorage.getItem(TOURED_KEY) === '1'
  } catch {
    return false
  }
}

const PUBLIC = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail)\./

function usePolledData(initial: Data, active: boolean) {
  const [data, setData] = useState(initial)
  useEffect(() => setData(initial), [initial])
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => welcomeFn().then(setData).catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [active])
  return data
}

function Welcome() {
  const { welcome: initial, conns } = Route.useLoaderData()
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const step: Step = search.step ?? 'tour'
  const topicIdx = Math.max(0, TOPICS.findIndex((t) => t.id === search.topic))
  const data = usePolledData(initial, step === 'agent' || step === 'first')
  const [invited, setInvited] = useState(false)
  const [toured, setToured] = useState(false)
  useEffect(() => setToured(readToured()), [])
  const canInvite = data.role !== 'viewer'
  const domain = me.user.email.split('@')[1] ?? ''
  const [site, setSite] = useState(domain && !PUBLIC.test(domain) ? `https://${domain}` : '')
  // Decided once: the agent's first writes shouldn't swap the prompts out from under the user.
  const [empty] = useState(() => initial.teamDocs <= 1 && initial.teamFiles === 0)
  const offerSetup = empty && data.role !== 'viewer'
  const steps: { id: Step; label: string; done: boolean }[] = [
    { id: 'tour', label: 'How Brainspace works', done: toured },
    { id: 'agent', label: 'Connect your agent', done: data.agent.connected },
    { id: 'tools', label: 'Connect your tools', done: conns.connections.some((c) => c.status === 'active') },
    { id: 'first', label: 'Give it a first job', done: data.agentActivity.length > 0 },
    ...(canInvite
      ? [{ id: 'team' as Step, label: 'Bring in your team', done: invited || (data.createdWorkspace && data.memberCount > 1) }]
      : []),
  ]
  const idx = steps.findIndex((s) => s.id === step)
  const go = (s: Step) => navigate({ search: { step: s } })
  const [finishing, setFinishing] = useState(false)

  // Back from a connection's sign-in page.
  useEffect(() => {
    if (search.connected) toast.success(`${search.connected} is connected`)
    if (search.error) toast.error(search.error)
    if (search.connected || search.error) navigate({ search: { step: search.step }, replace: true })
  }, [search.connected, search.error])

  function markToured() {
    setToured(true)
    try {
      localStorage.setItem(TOURED_KEY, '1')
    } catch {}
  }

  async function finish() {
    setFinishing(true)
    await completeWelcomeFn()
    window.location.href = '/app'
  }

  const nextStep = () => {
    if (step === 'tour') markToured()
    return idx < steps.length - 1 ? go(steps[idx + 1]!.id) : finish()
  }
  // The tour pages through its topics before moving on.
  const inTour = step === 'tour'
  const lastTopic = topicIdx === TOPICS.length - 1
  const showTopic = (i: number) => {
    if (i === TOPICS.length - 1) markToured()
    navigate({ search: { step: 'tour', topic: TOPICS[i]!.id } })
  }
  const next = () => (inTour && !lastTopic ? showTopic(topicIdx + 1) : nextStep())
  const back = () => (inTour && topicIdx > 0 ? showTopic(topicIdx - 1) : idx > 0 ? go(steps[idx - 1]!.id) : undefined)
  const canGoBack = inTour ? topicIdx > 0 : idx > 0

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <button onClick={finish} className="text-sm text-ink-2 hover:text-ink" disabled={finishing}>
          Skip setup
        </button>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-6 pt-6 pb-24 md:grid-cols-[220px_1fr]">
        <aside>
          <p className="text-sm text-ink-2">
            {data.createdWorkspace ? 'Your workspace' : 'You joined'}
          </p>
          <p className="mt-0.5 font-semibold">{data.workspaceName}</p>
          <p className="text-[13px] text-ink-3">as {ROLE_LABEL[data.role]?.toLowerCase()}</p>
          <ol className="mt-8 space-y-1">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => go(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[14px]',
                    s.id === step ? 'bg-sheet font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-wash',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                      s.done ? 'bg-agent text-white' : s.id === step ? 'bg-ink text-white' : 'bg-line text-ink-2',
                    )}
                  >
                    {s.done ? <Check className="size-3" /> : i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="min-w-0 rounded-xl border border-line bg-sheet p-4 sm:p-8">
          {step === 'tour' && (
            <>
              <StepHeader title="How Brainspace works">
                Brainspace is a shared brain for your team's AI agents. Your agents read from it and write to it, use the
                tools you connect, and build automations the whole team can use. Here are the parts, what each is for, and
                what to ask your agent.
              </StepHeader>
              <Tour topic={TOPICS[topicIdx]!.id} onTopic={(id) => showTopic(TOPICS.findIndex((t) => t.id === id))} />
            </>
          )}
          {step === 'agent' && <AgentStep data={data} offerSetup={offerSetup} site={site} setSite={setSite} />}
          {step === 'tools' && <ToolsStep conns={conns} offerSetup={offerSetup} />}
          {step === 'first' && <FirstJobStep data={data} offerSetup={offerSetup} site={site} setSite={setSite} />}
          {step === 'team' && <TeamStep data={data} onInvited={() => setInvited(true)} />}

          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <div>
              {canGoBack && (
                <Button variant="ghost" onClick={back}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {inTour
                ? !lastTopic && (
                    <Button variant="ghost" onClick={nextStep}>
                      Skip the tour
                    </Button>
                  )
                : idx < steps.length - 1 && (
                    <Button variant="ghost" onClick={nextStep}>
                      Do this later
                    </Button>
                  )}
              <Button variant="primary" onClick={next} loading={finishing}>
                {inTour && !lastTopic ? (
                  <>
                    <span className="sm:hidden">Next</span>
                    <span className="hidden sm:inline">Next: {TOPICS[topicIdx + 1]!.label}</span>
                  </>
                ) : idx < steps.length - 1
                    ? 'Continue'
                    : 'Go to your space'}
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function StepHeader({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
      <div className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-ink-2">{children}</div>
    </div>
  )
}

function AgentStatus({ data }: { data: Data }) {
  if (data.agent.connected) {
    return (
      <div className="mt-6 flex items-center gap-2.5 rounded-lg bg-agent-wash px-4 py-3 text-sm text-agent">
        <Check className="size-4" />
        <span>
          Connected{data.agent.client ? `: ${data.agent.client}` : ''}. Your agent can use Brainspace now.
        </span>
      </div>
    )
  }
  return (
    <div className="mt-6 flex items-center gap-2.5 rounded-lg bg-paper px-4 py-3 text-sm text-ink-2">
      <Loader2 className="size-4 animate-spin" />
      Waiting for your agent to connect. This updates on its own once it signs in.
    </div>
  )
}

type SiteProps = { offerSetup: boolean; site: string; setSite: (s: string) => void }

function SiteInput({ site, setSite }: Pick<SiteProps, 'site' | 'setSite'>) {
  return <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://acme.com" className="mt-1.5 max-w-md" />
}

function AgentStep({ data, offerSetup, site, setSite }: { data: Data } & SiteProps) {
  const then = offerSetup
    ? `Then walk me through setting up our workspace${site.trim() ? `, starting from ${site.trim()}` : ''}.`
    : 'Then give me a short tour of what our team keeps in Brainspace.'
  return (
    <>
      <StepHeader title="Connect your agent">
        Brainspace is built to be used through your AI agent. Once it's connected, it can read the team's docs, write
        new ones, and use the tools your team has connected, all as you and with your role.
      </StepHeader>
      {offerSetup && (
        <div className="mb-6">
          <div className="text-[13px] font-medium text-ink-2">Your company's website</div>
          <SiteInput site={site} setSite={setSite} />
          <p className="mt-1.5 text-[13px] text-ink-3">
            Your team space starts empty. Once your agent is connected, it walks you through setup: it fills in the company
            overview, brand kit and voice guide from your site, then helps you connect tools and draft your first skills.
          </p>
        </div>
      )}
      <AgentSetup base={data.appUrl} prompt={setupPrompt(data.appUrl, then)} />
      <AgentStatus data={data} />
    </>
  )
}

/** What each suggested service is good for once it's connected, in the order they're offered. */
const SUGGESTED: { id: string; use: string }[] = [
  { id: 'slack', use: 'Flows and bots post digests, alerts and approval requests to your channels.' },
  { id: 'google-drive', use: 'Agents search and read your Docs, Sheets and PDFs. Each person connects their own Drive.' },
  { id: 'context-dev', use: 'Web search and brand data. Fills in your brand kit from your website and makes uploaded PDFs searchable.' },
  { id: 'notion', use: 'Agents read your existing wiki pages while you move what matters into the brain.' },
  { id: 'linear', use: 'Agents look up and file issues. A bot can tell you each morning what is blocked.' },
  { id: 'hubspot', use: 'Ask about any deal or contact, and run a weekly pipeline review.' },
  { id: 'github', use: 'Issues, pull requests and code search, and release notes drafted from what merged.' },
  { id: 'posthog', use: 'Ask product questions in plain English and get weekly metrics posted for you.' },
  { id: 'stripe', use: 'Revenue, subscriptions and invoices for finance questions and dashboards.' },
  { id: 'sentry', use: 'Errors and releases, for a triage bot or a weekly stability report.' },
]

function ToolsStep({ conns, offerSetup }: { conns: Conns; offerSetup: boolean }) {
  const [adding, setAdding] = useState<ConnectionPreset | null>(null)
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const canAdd = conns.role !== 'viewer'
  const connected = new Set(conns.connections.map((c) => c.presetId))
  const suggested = SUGGESTED.filter((s) => !connected.has(s.id))
  const returnTo = '/welcome?step=tools'

  async function signIn(id: string) {
    setSigningIn(id)
    try {
      const r = await authorizeConnectionFn({ data: { id } })
      rememberConnectReturn(returnTo)
      if (r.url) window.location.href = r.url
    } catch (e) {
      toast.error(errMessage(e))
      setSigningIn(null)
    }
  }

  return (
    <>
      <StepHeader title="Connect your tools">
        Connect a service once and every agent, flow and bot on the team can use it. Brainspace keeps the keys, and agents
        only get the tools. You can limit each one by role, person or tool later, on the Connections page.
      </StepHeader>

      {conns.connections.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[13px] font-medium text-ink-2">Connected</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {conns.connections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <ConnLogo presetId={c.presetId} size={20} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="truncate text-[12.5px] text-ink-3">
                    {c.toolCount} tools{c.credentialMode === 'per_user' ? ' · each person signs in' : ''}
                  </div>
                </div>
                {c.status === 'active' ? (
                  <Badge tone="ok">active</Badge>
                ) : c.status === 'needs_auth' && c.authType === 'oauth' && c.type !== 'slack' && c.usable ? (
                  <Button size="sm" variant="brand" loading={signingIn === c.id} onClick={() => signIn(c.id)}>
                    Sign in
                  </Button>
                ) : (
                  <Badge tone="danger">{c.status === 'needs_auth' ? 'needs sign-in' : 'error'}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canAdd ? (
        <>
          <h2 className="text-[13px] font-medium text-ink-2">
            {conns.connections.length ? 'Add more' : 'Pick the ones your team uses'}
          </h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {suggested.map((s) => {
              const p = presetById(s.id)!
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setAdding(p)}
                    className="flex h-full w-full items-start gap-3 rounded-lg border border-line p-3 text-left hover:border-line-2 hover:bg-paper"
                  >
                    <ConnLogo presetId={p.id} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {p.name}
                        {offerSetup && s.id === 'context-dev' && <Badge tone="brand">helps with setup</Badge>}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">{s.use}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-[13px] text-ink-3">
            Using something else? Connect{' '}
            <button className="text-brand-ink hover:underline" onClick={() => setAdding(presetById('custom-mcp')!)}>
              any MCP server
            </button>{' '}
            or{' '}
            <button className="text-brand-ink hover:underline" onClick={() => setAdding(presetById('custom-http')!)}>
              any REST API
            </button>
            , or ask your agent: <span className="text-ink-2">"Connect our Linear to Brainspace."</span>
          </p>
        </>
      ) : (
        <p className="rounded-lg bg-paper px-4 py-3 text-sm text-ink-2">
          Read-only members can't add connections. Ask an admin or member to connect the tools your team uses, and your
          agent can use their read-only tools here.
        </p>
      )}

      {adding && (
        <AddConnection
          preset={adding}
          callbackUrl={conns.callbackUrl}
          slackAppReady={conns.slackAppReady}
          returnTo={returnTo}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}

function FirstJobStep({ data, offerSetup, site, setSite }: { data: Data } & SiteProps) {
  const canWrite = data.role !== 'viewer'
  const fillPrompt = `Set up our Brainspace from ${site.trim() || 'https://our-company.com'}`
  const prompts = canWrite
    ? [
        'Bring what you already know about our team into Brainspace.',
        'Give me a quick tour of our team brain.',
        'Suggest a first flow for our team, based on the tools we have connected.',
        'Write a short launch announcement in our brand voice.',
        'Save the decisions from this conversation to the team brain.',
        'Turn how we write release notes into a team skill.',
      ]
    : ['Give me a quick tour of our team brain.', 'What does our brand voice guide say about tone?', 'What changed in the brain this week?']

  return (
    <>
      <StepHeader title="Give it a first job">
        {offerSetup
          ? "Your team space is empty, and your agent fills it in. Ask it to set things up and it runs you through it: it writes the company overview, brand kit and voice guide from your website, asks you what a website doesn't say, offers to connect the tools you use, and drafts your first skills and a first flow. It leaves a TODO wherever it needs your answer."
          : 'Try one of these in your agent. Its changes show up below as they happen.'}
      </StepHeader>

      {offerSetup ? (
        <div className="space-y-3">
          <div>
            <div className="text-[13px] font-medium text-ink-2">Your website</div>
            <SiteInput site={site} setSite={setSite} />
          </div>
          <div className="text-[13px] font-medium text-ink-2">Then paste this into your agent</div>
          <CopyField mono={false} value={fillPrompt} />
          <p className="text-[13px] text-ink-3">
            Already using an agent with your own notes and skills?{' '}
            <span className="text-ink-2">"Bring what you already know about our team into Brainspace."</span> imports them.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {prompts.map((p) => (
            <li key={p}>
              <CopyField mono={false} value={p} />
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-sm font-semibold">What your agent has done</h2>
      {data.agentActivity.length ? (
        <ul className="mt-4 space-y-4">
          {data.agentActivity.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="size-3.5 animate-spin" /> Nothing yet. This list updates on its own.
        </p>
      )}
    </>
  )
}

function TeamStep({ data, onInvited }: { data: Data; onInvited: () => void }) {
  const isAdmin = data.role === 'admin'
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState<'invite' | 'link' | 'auto' | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [autoOn, setAutoOn] = useState(data.autoJoin.enabled)

  async function sendInvites() {
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean)
    if (!list.length) return
    setBusy('invite')
    let sent = 0
    for (const email of list) {
      try {
        await inviteFn({ data: { email, role } })
        sent++
      } catch (e) {
        toast.error(`${email}: ${errMessage(e)}`)
      }
    }
    setBusy(null)
    if (sent) {
      onInvited()
      toast.success(`Invited ${sent} ${sent === 1 ? 'person' : 'people'}`)
      setEmails('')
    }
  }

  return (
    <>
      <StepHeader title="Bring in your team">
        The brain gets more useful as more people's agents read from it and add to it. Each person connects their own agent,
        which works with their role.
      </StepHeader>

      {isAdmin && data.autoJoin.available && (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3.5">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">
              {autoOn ? `Everyone with an @${data.autoJoin.yourDomain} email joins automatically` : `Auto-add everyone at @${data.autoJoin.yourDomain}`}
            </div>
            <div className="text-ink-2">Teammates join as members the first time they sign in. No invites needed.</div>
          </div>
          <Button
            variant={autoOn ? 'secondary' : 'primary'}
            loading={busy === 'auto'}
            onClick={async () => {
              setBusy('auto')
              try {
                const r = await setAutoJoinFn({ data: { enabled: !autoOn, role: 'member' } })
                setAutoOn(r.enabled)
                if (r.enabled) onInvited()
                if (r.enabled) {
                  toast.success(
                    r.addedNow.length ? `Added ${r.addedNow.length} teammates already on Brainspace` : `@${r.domain} teammates will join automatically`,
                  )
                }
              } catch (e) {
                toast.error(errMessage(e))
              } finally {
                setBusy(null)
              }
            }}
          >
            {autoOn ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      )}

      {isAdmin && (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3.5">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">On Claude Team or Enterprise?</div>
            <div className="text-ink-2">
              Add Brainspace for your whole Claude organization, and teammates only click Connect and sign in. Needs a Claude
              org owner.
            </div>
          </div>
          <a
            href={claudeConnectorLink(data.appUrl, { admin: true })}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-md border border-line-2 bg-sheet px-3.5 text-sm font-medium whitespace-nowrap text-ink hover:bg-wash"
          >
            Add to your Claude org
          </a>
        </div>
      )}

      <div className="text-[13px] font-medium text-ink-2">Invite by email</div>
      <Textarea
        className="mt-1.5"
        rows={3}
        value={emails}
        onChange={(e) => setEmails(e.target.value)}
        placeholder="sam@acme.com, priya@acme.com"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          {isAdmin && <option value="admin">as Admin</option>}
          <option value="member">as Member</option>
          <option value="viewer">as Read-only</option>
        </Select>
        <Button variant="primary" onClick={sendInvites} loading={busy === 'invite'} disabled={!emails.trim()}>
          Send invites
        </Button>
        <Button
          loading={busy === 'link'}
          onClick={async () => {
            setBusy('link')
            try {
              const r = await inviteFn({ data: { role } })
              setLink(r.url)
              onInvited()
            } catch (e) {
              toast.error(errMessage(e))
            } finally {
              setBusy(null)
            }
          }}
        >
          Get a join link
        </Button>
      </div>
      {link && (
        <div className="mt-4">
          <CopyField value={link} />
          <p className="mt-1.5 text-[13px] text-ink-3">Anyone with this link can join for 14 days. You can revoke it from Members.</p>
        </div>
      )}
    </>
  )
}
