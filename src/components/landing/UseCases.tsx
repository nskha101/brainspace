import { useState, type ReactNode } from 'react'
import { AppWindow, BotMessageSquare, CalendarClock, Check, Database, Hand, RotateCcw, Webhook, Workflow } from 'lucide-react'
import { logoUrl } from '../../lib/presets'
import { cn } from '../../lib/utils'
import { Mention, SlackMessage, ToolStep } from './Slack'

type Part = { label: string; icon?: ReactNode; domain?: string }

const BOT: Part = { label: 'Bot', icon: <BotMessageSquare /> }
const FLOW: Part = { label: 'Flow', icon: <Workflow /> }
const SCHEDULE: Part = { label: 'Schedule', icon: <CalendarClock /> }
const WEBHOOK: Part = { label: 'Webhook', icon: <Webhook /> }
const APPROVAL: Part = { label: 'Approval', icon: <Hand /> }
const DATABASE: Part = { label: 'Database', icon: <Database /> }
const ARTIFACT: Part = { label: 'Artifact', icon: <AppWindow /> }
const SLACK: Part = { label: 'Slack', domain: 'slack.com' }
const STRIPE: Part = { label: 'Stripe', domain: 'stripe.com' }
const POSTHOG: Part = { label: 'PostHog', domain: 'posthog.com' }
const POSTGRES: Part = { label: 'Postgres', domain: 'postgresql.org' }
const CONTEXT: Part = { label: 'Context.dev', domain: 'context.dev' }

/**
 * Four things a small team builds on Brainspace, each a card: a picture of it working, what it does,
 * the one request that made it, and the pieces it's made of.
 */
export function UseCases() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <UseCase
        title="Refunds that wait for a yes"
        ask="Let support ask for refunds in Slack. Find the charge, then wait for me to approve before anything goes to Stripe."
        parts={[BOT, FLOW, APPROVAL, SLACK, STRIPE]}
        picture={<RefundPicture />}
      >
        Dev asks the billing bot. It finds the charge and starts a refund flow that stops until Priya approves. The flow
        lives in a folder only Priya can open, so nobody else can approve it or issue a refund.
      </UseCase>

      <UseCase
        title="Failed payments, sorted before standup"
        ask="Every weekday at 8, post last night's failed payments to #revenue, with whether each customer is still using the product."
        parts={[BOT, SCHEDULE, STRIPE, POSTHOG, SLACK]}
        picture={<FailedPaymentsPicture />}
      >
        A bot reads Stripe and PostHog each morning and posts one list. The team chases the customers who are still active
        and stops worrying about the ones who already left.
      </UseCase>

      <UseCase
        title="A usage page for sales"
        ask="Copy each account's usage from prod every night, and make a page that shows who's close to their limit."
        parts={[FLOW, SCHEDULE, POSTGRES, DATABASE, ARTIFACT]}
        picture={<UsagePicture />}
      >
        A nightly flow copies usage into a team database, and a page inside Brainspace shows it. Maya sees who to upsell
        without a database login. The page can read the data and has nowhere to send it.
      </UseCase>

      <UseCase
        title="Every signup, researched"
        ask="When someone signs up, look up their company, save a note in /team/sales/leads, and tell #sales."
        parts={[BOT, WEBHOOK, CONTEXT, SLACK]}
        picture={<SignupPicture />}
      >
        Your app calls the bot's webhook on each signup. It looks the company up, writes the note and posts a two-line
        summary, so whoever replies first already knows who they're talking to.
      </UseCase>
    </div>
  )
}

function UseCase({ title, ask, parts, picture, children }: { title: string; ask: string; parts: Part[]; picture: ReactNode; children: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-2 bg-sheet">
      <div className="min-h-[300px] border-b border-line bg-paper/70 p-4 sm:p-5">{picture}</div>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h3 className="text-[21px] leading-tight font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{children}</p>
        <div className="mt-5 text-[12px] font-medium tracking-wide text-ink-3 uppercase">What Priya asked her agent</div>
        <p className="mt-1.5 w-fit max-w-[52ch] rounded-lg rounded-tl-sm bg-ink px-3.5 py-2 text-[13.5px] leading-snug text-white">{ask}</p>
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-5" aria-label="Made of">
          {parts.map((p) => (
            <li key={p.label} className="flex h-6 items-center gap-1.5 rounded-md border border-line-2 bg-sheet px-2 text-[12px] text-ink-2 [&>svg]:size-3.5 [&>svg]:text-agent">
              {p.domain ? <img src={logoUrl(p.domain)} alt="" width={13} height={13} className="rounded-[2px]" /> : p.icon}
              {p.label}
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

/** The refund flow's run, stopped on Priya's approval until someone presses a button. */
function RefundPicture() {
  const [decision, setDecision] = useState<'waiting' | 'approved' | 'rejected'>('waiting')
  return (
    <div className="space-y-3">
      <SlackMessage from="dev" time="2:15">
        <Mention>@billing</Mention> refund Pinecrest's second charge from Nov 3, they were billed twice.
      </SlackMessage>

      <div className="rounded-lg border border-line-2 bg-sheet">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-[12.5px]">
          <span className="flex items-center gap-1.5 font-mono text-ink">
            <Workflow className="size-3.5 text-agent" aria-hidden /> refund
          </span>
          <span className={cn('font-medium', decision === 'waiting' ? 'text-[#a86400]' : decision === 'approved' ? 'text-ok' : 'text-ink-3')} aria-live="polite">
            {decision === 'waiting' ? 'Waiting for approval' : decision === 'approved' ? 'Finished' : 'Stopped'}
          </span>
        </div>
        <ol className="px-3.5 py-1.5">
          <ToolStep tool="stripe__list_payment_intents" arg="customer: Pinecrest" result="Two charges of $48.00 on November 3." />
          {decision === 'waiting' ? (
            <li className="landing-block my-1.5 rounded-md border border-[#e9c98c] bg-[#fdf6e7] px-3 py-2.5">
              <div className="text-[13.5px] font-medium text-ink">Refund $48.00 to Pinecrest?</div>
              <div className="mt-0.5 text-[12.5px] text-ink-2">The second of two identical charges. Only Priya Nair can see this run.</div>
              <div className="mt-2.5 flex gap-2">
                <button type="button" onClick={() => setDecision('approved')} className="rounded-md bg-ink px-3 py-1 text-[12.5px] font-medium text-white hover:bg-ink-2">
                  Approve
                </button>
                <button type="button" onClick={() => setDecision('rejected')} className="rounded-md border border-line-2 bg-sheet px-3 py-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
                  Reject
                </button>
              </div>
            </li>
          ) : decision === 'approved' ? (
            <>
              <ToolStep tool="approve" result="Approved by Priya Nair." />
              <ToolStep tool="stripe__create_refund" arg="pi_3QKv8a, $48.00" result="Refunded. Stripe emails Pinecrest a receipt." />
            </>
          ) : (
            <ToolStep tool="approve" result="Rejected by Priya Nair. Nothing went to Stripe." />
          )}
        </ol>
        {decision !== 'waiting' && (
          <div className="flex justify-end border-t border-line px-3.5 py-1.5">
            <button type="button" onClick={() => setDecision('waiting')} className="flex items-center gap-1 text-[12px] font-medium text-ink-3 hover:text-ink">
              <RotateCcw className="size-3" aria-hidden /> Start over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const FAILED = [
  { who: 'Kestrel Health', amount: '$240', why: 'Card expired', seen: 'Active today', next: 'Still using it. Ask for a new card.', tone: 'bg-brand' },
  { who: 'Orbit Labs', amount: '$96', why: 'Insufficient funds', seen: 'Active yesterday', next: 'Stripe retries Thursday.', tone: 'bg-[#c27a12]' },
  { who: 'Tallow & Co', amount: '$48', why: 'Card declined', seen: 'Last seen 41 days ago', next: 'Probably gone. No chase.', tone: 'bg-ink-3' },
]

function FailedPaymentsPicture() {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12.5px] text-ink-3">
        <img src={logoUrl('slack.com')} alt="" width={14} height={14} className="rounded-[2px]" />
        <span className="font-semibold text-ink"># revenue</span>
        <span>Tuesday</span>
      </div>
      <SlackMessage bot="payment-watch" time="8:00">
        Three payments failed overnight, $384 in all.
        <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-lg border border-line-2 bg-sheet">
          {FAILED.map((f) => (
            <li key={f.who} className="flex gap-2.5 px-3 py-2">
              <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', f.tone)} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
                  <span className="font-medium text-ink">{f.who}</span>
                  <span className="text-ink-2 tabular-nums">
                    {f.amount} · {f.why}
                  </span>
                </div>
                <div className="text-[12.5px] leading-snug text-ink-3">
                  {f.seen}. {f.next}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </SlackMessage>
    </div>
  )
}

const ACCOUNTS = [
  { name: 'Brightline', used: 61_400, limit: 50_000 },
  { name: 'Kestrel Health', used: 188_000, limit: 200_000 },
  { name: 'Orbit Labs', used: 44_100, limit: 50_000 },
  { name: 'Kitepay', used: 30_500, limit: 50_000 },
  { name: 'Pinecrest', used: 9_800, limit: 20_000 },
]

function UsagePicture() {
  const [onlyNear, setOnlyNear] = useState(false)
  const rows = ACCOUNTS.filter((a) => !onlyNear || a.used / a.limit >= 0.85)
  return (
    <div className="overflow-hidden rounded-lg border border-line-2 bg-sheet">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2">
        <span className="flex items-center gap-1.5 font-mono text-[12.5px] text-ink">
          <AppWindow className="size-3.5 text-agent" aria-hidden /> /team/sales/usage
        </span>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={onlyNear} onChange={(e) => setOnlyNear(e.target.checked)} className="size-3.5" />
          85% and up
        </label>
      </div>
      <div className="px-3.5 pt-3 pb-1">
        <div className="text-[15px] font-semibold tracking-[-0.01em]">Credits this month</div>
        <div className="text-[12px] text-ink-3">From usage.db. The usage-sync flow refreshed it at 2:00.</div>
      </div>
      <ul className="px-3.5 pb-3">
        {rows.map((a) => {
          const pct = Math.round((a.used / a.limit) * 100)
          const over = pct >= 100
          const near = pct >= 85
          return (
            <li key={a.name} className="landing-block py-2">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="font-medium text-ink">{a.name}</span>
                <span className={cn('tabular-nums', over ? 'font-semibold text-brand-ink' : near ? 'text-[#a86400]' : 'text-ink-3')}>
                  {over ? `${pct - 100}% over` : `${pct}%`}
                </span>
              </div>
              <div className="relative mt-1.5 h-1.5 rounded-full bg-wash">
                <div
                  className={cn('absolute inset-y-0 left-0 rounded-full', over ? 'bg-brand' : near ? 'bg-[#d89a2b]' : 'bg-line-2')}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SignupPicture() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line-2 bg-sheet px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <Webhook className="size-3.5 text-agent" aria-hidden /> Your app, on signup
        </div>
        <pre className="mt-1.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">
          <span className="text-agent">POST</span> /api/bots/hook/•••••{'\n'}
          {'{ "event": "signup", "email": "lena@kitepay.com" }'}
        </pre>
      </div>
      <div className="rounded-lg border border-line-2 bg-sheet px-3.5 py-1">
        <ol aria-label="What the bot did">
          <ToolStep tool="connection_call" arg="context kitepay.com" result="Payouts for marketplaces. 40 people, Berlin." />
          <ToolStep tool="write" arg="/team/sales/leads/kitepay.md" result="Saved as version 1." />
        </ol>
      </div>
      <SlackMessage bot="lead-research" time="11:06">
        <span className="flex items-center gap-1 text-[12px] text-ink-3">
          <Check className="size-3 text-ok" aria-hidden /> in #sales
        </span>
        Lena from <strong className="font-semibold">Kitepay</strong> signed up. They build payouts for marketplaces, about 40
        people in Berlin. Notes are in <span className="font-mono text-[12.5px]">/team/sales/leads/kitepay.md</span>.
      </SlackMessage>
    </div>
  )
}
