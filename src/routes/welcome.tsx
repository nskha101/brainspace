import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import { completeWelcomeFn, getMe, inviteFn, setAutoJoinFn, welcomeFn } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { AgentSetup } from '../components/AgentSetup'
import { ActivityRow } from '../components/ActivityRow'
import { Badge, Button, CopyField, Input, Select, Textarea } from '../components/ui'
import { ROLE_LABEL, cn, errMessage } from '../lib/utils'

type Step = 'agent' | 'skills' | 'first' | 'team'

export const Route = createFileRoute('/welcome')({
  validateSearch: (s: Record<string, unknown>): { step?: Step } =>
    ['agent', 'skills', 'first', 'team'].includes(s.step as string) ? { step: s.step as Step } : {},
  beforeLoad: async () => {
    const me = await getMe()
    if (!me) throw redirect({ to: '/login', search: { redirect: '/welcome' } as never })
    if (!me.current) throw redirect({ to: '/onboarding' })
    return { me }
  },
  loader: () => welcomeFn(),
  component: Welcome,
})

type Data = Awaited<ReturnType<typeof welcomeFn>>

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
  const initial = Route.useLoaderData()
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const step: Step = search.step ?? 'agent'
  const data = usePolledData(initial, step === 'agent' || step === 'first')
  // Skills can't be detected from the server, so that step counts as done once the user moves past it.
  const [passedSkills, setPassedSkills] = useState(false)
  const [invited, setInvited] = useState(false)
  useEffect(() => {
    if (step === 'first' || step === 'team') setPassedSkills(true)
  }, [step])
  const canInvite = data.role !== 'viewer'
  const steps: { id: Step; label: string; done: boolean }[] = [
    { id: 'agent', label: 'Connect your agent', done: data.agent.connected },
    { id: 'skills', label: 'Add the skills', done: passedSkills },
    { id: 'first', label: 'Give it a first job', done: data.agentActivity.length > 0 },
    ...(canInvite
      ? [{ id: 'team' as Step, label: 'Bring in your team', done: invited || (data.createdWorkspace && data.memberCount > 1) }]
      : []),
  ]
  const idx = steps.findIndex((s) => s.id === step)
  const go = (s: Step) => navigate({ search: { step: s } })
  const [finishing, setFinishing] = useState(false)

  async function finish() {
    setFinishing(true)
    await completeWelcomeFn()
    window.location.href = '/app'
  }

  const next = () => (idx < steps.length - 1 ? go(steps[idx + 1]!.id) : finish())

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Wordmark />
        <button onClick={finish} className="text-sm text-ink-2 hover:text-ink" disabled={finishing}>
          Skip setup
        </button>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-6 pt-6 pb-24 md:grid-cols-[220px_1fr]">
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

        <section className="min-w-0 rounded-xl border border-line bg-sheet p-6 sm:p-8">
          {step === 'agent' && <AgentStep data={data} />}
          {step === 'skills' && <SkillsStep data={data} />}
          {step === 'first' && <FirstJobStep data={data} email={me.user.email} />}
          {step === 'team' && <TeamStep data={data} onInvited={() => setInvited(true)} />}

          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <div>
              {idx > 0 && (
                <Button variant="ghost" onClick={() => go(steps[idx - 1]!.id)}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {idx < steps.length - 1 && (
                <Button variant="ghost" onClick={next}>
                  Do this later
                </Button>
              )}
              <Button variant="primary" onClick={next} loading={finishing}>
                {idx < steps.length - 1 ? 'Continue' : 'Go to your drive'}
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

function AgentStep({ data }: { data: Data }) {
  return (
    <>
      <StepHeader title="Connect your agent">
        Brainspace is built to be used through your AI agent. Once it's connected, it can read the team's docs, write
        new ones, and use the tools your team has connected, all as you and with your role.
      </StepHeader>
      <AgentSetup base={data.appUrl} />
      <AgentStatus data={data} />
    </>
  )
}

const AGENT_SKILLS: [string, string][] = [
  ['brainspace', 'How the brain works: paths, versions, promoting, skills'],
  ['brainspace-setup', 'Builds out a new workspace from your website'],
  ['brainspace-capture', 'Saves decisions and facts from a conversation'],
  ['brainspace-review', 'Summarizes what changed and undoes bad edits'],
  ['brainspace-skills', 'Turns how your team works into team skills'],
  ['brainspace-brand-kit', 'Logos, colors and fonts, used consistently'],
  ['brainspace-connections', 'Connects tools like HubSpot and PostHog'],
  ['brainspace-admin', 'People, roles and API keys'],
]

function SkillsStep({ data }: { data: Data }) {
  return (
    <>
      <StepHeader title="Add the skills">
        Skills teach your agent how to do a job well. There are two kinds: the Brainspace skills, which teach it how to
        use the brain, and your team's own skills, which live in the brain itself.
      </StepHeader>

      <h2 className="text-sm font-semibold">Brainspace skills</h2>
      <p className="mt-1 text-sm text-ink-2">
        If you installed the Claude Code plugin in the last step, you already have these. Otherwise:
      </p>
      <CopyField className="mt-3" value={`npx skills add ${data.appUrl}`} />
      <p className="mt-2 text-[13px] text-ink-3">
        Works with Codex, Cursor, Gemini CLI and most other agents. Or use <span className="font-mono">curl -fsSL {data.appUrl}/install.sh | sh</span>.
      </p>
      <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {AGENT_SKILLS.map(([n, d]) => (
          <li key={n}>
            <span className="font-mono text-[12.5px] font-medium">{n}</span>
            <span className="block text-ink-2">{d}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-semibold">Your team's skills</h2>
      <p className="mt-1 text-sm text-ink-2">
        These come through Brainspace, so there's nothing to install. Your agent finds them with{' '}
        <span className="font-mono text-[12.5px]">skills_list</span>, and they update for everyone when someone edits one.
      </p>
      {data.skills.length ? (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {data.skills.map((s) => (
            <li key={s.path} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {s.drive === 'me' && <Badge>private</Badge>}
              </div>
              <p className="text-[13.5px] text-ink-2">{s.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg bg-paper px-4 py-3.5 text-sm text-ink-2">
          No team skills yet. Once your agent is connected, describe something your team does often and ask it to turn
          that into a skill:
          <CopyField className="mt-2" mono={false} value="Turn how we write release notes into a team skill in Brainspace." />
        </div>
      )}
    </>
  )
}

function FirstJobStep({ data, email }: { data: Data; email: string }) {
  const domain = email.split('@')[1] ?? ''
  const [site, setSite] = useState(domain && !PUBLIC.test(domain) ? `https://${domain}` : '')
  // Decided once: the agent's first writes shouldn't swap the prompt out from under the user.
  const [empty] = useState(() => data.teamDocs <= 1 && data.teamFiles === 0)
  const canWrite = data.role !== 'viewer'
  const setupPrompt = `Set up our Brainspace from ${site || 'https://our-company.com'}`
  const prompts = canWrite
    ? [
        'Give me a quick tour of our team brain.',
        'Write a short launch announcement in our brand voice.',
        'Save the decisions from this conversation to the team brain.',
      ]
    : ['Give me a quick tour of our team brain.', 'What does our brand voice guide say about tone?', 'What changed in the brain this week?']

  return (
    <>
      <StepHeader title="Give it a first job">
        {empty && canWrite
          ? "Your team drive is empty, which is the point: your agent fills it in. Give it your website and it will write the company overview, brand kit and voice guide, and leave a TODO wherever it needs your input."
          : 'Try one of these in your agent. Its changes show up below as they happen.'}
      </StepHeader>

      {empty && canWrite ? (
        <div className="space-y-3">
          <div className="text-[13px] font-medium text-ink-2">Your website</div>
          <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://acme.com" className="max-w-md" />
          <div className="text-[13px] font-medium text-ink-2">Then paste this into your agent</div>
          <CopyField mono={false} value={setupPrompt} />
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
