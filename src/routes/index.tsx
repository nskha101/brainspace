import { Link, createFileRoute } from '@tanstack/react-router'
import { authConfigFn, getMe } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { AgentSetup } from '../components/AgentSetup'
import { VersionDemo } from '../components/VersionDemo'
import { logoUrl } from '../lib/presets'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [me, config] = await Promise.all([getMe(), authConfigFn()])
    return { me, base: config.appUrl.replace(/\/$/, '') }
  },
  component: Landing,
})

const SERVICES = [
  ['HubSpot', 'hubspot.com'],
  ['PostHog', 'posthog.com'],
  ['Context.dev', 'context.dev'],
  ['Linear', 'linear.app'],
  ['Notion', 'notion.so'],
  ['GitHub', 'github.com'],
] as const

// Every section below the hero shares the doc's gutter: title on the left, content in the main column.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-14 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-0 sm:py-20">
      <h2 className="pr-6 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="min-w-0 sm:pl-5">{children}</div>
    </section>
  )
}

function Landing() {
  const { me, base } = Route.useLoaderData()
  const primary = me
    ? { to: '/app' as const, label: 'Open your drive' }
    : { to: '/login' as const, label: 'Create a workspace' }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-5 text-sm">
          <Link to="/docs" className="hidden text-ink-2 hover:text-ink sm:inline">
            Connect an agent
          </Link>
          <Link to={me ? '/app' : '/login'} className="rounded-md bg-ink px-3.5 py-2 font-medium text-white hover:bg-ink-2">
            {me ? 'Open your drive' : 'Sign in'}
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-[1200px] px-6">
        <section className="pt-12 pb-16 sm:pt-20 sm:pb-24">
          <h1 className="text-[clamp(44px,6.6vw,88px)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance">
            Every agent on your team, <br className="hidden lg:block" />
            working from the same page.
          </h1>

          <div className="mt-8 sm:mt-10 sm:pl-[220px]">
            <p className="max-w-[56ch] text-[18px] leading-relaxed text-ink-2 sm:text-[19px]">
              Brainspace is a shared drive your agents reach over MCP. They read your brand kit and playbooks, write
              drafts, and use the tools you've connected. Each change is saved as a version with the person and the agent
              behind it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={primary.to}
                className="rounded-md bg-brand px-5 py-3 text-[15px] font-medium text-white hover:bg-brand-ink"
              >
                {primary.label}
              </Link>
              <a href="#connect" className="rounded-md px-4 py-3 text-[15px] font-medium text-ink-2 hover:bg-wash hover:text-ink">
                Connect an agent
              </a>
            </div>
          </div>

          <div className="mt-16 sm:mt-20">
            <VersionDemo />
            <p className="mt-4 max-w-[60ch] text-[14px] leading-relaxed text-ink-3 sm:ml-[220px]">
              Three people and three agents edited this doc. Pick a version to see what changed and who changed it. Older
              versions can be compared and restored by you or your agents.
            </p>
          </div>
        </section>

        <Section title="Two drives">
          <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
            Everything under <code className="font-mono text-[15px] text-ink">/me</code> is private to you and your agents.
            Everything under <code className="font-mono text-[15px] text-ink">/team</code> is shared. Draft in private, then
            promote the doc when it's ready. Its history comes with it.
          </p>
          <PromoteDiagram />
        </Section>

        <Section title="Connected tools">
          <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
            Connect HubSpot, PostHog or any MCP server once for the whole workspace. Every agent can use its tools through
            Brainspace, limited by each person's role, and none of them see the API keys.
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {SERVICES.map(([name, domain]) => (
              <li key={domain} className="flex items-center gap-2 text-[14px] text-ink-2">
                <img src={logoUrl(domain)} alt="" width={18} height={18} className="rounded-[4px]" />
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-8 font-mono text-[13px] text-ink-2">
            <span className="text-agent">hubspot__search_crm_objects</span>
            <span className="text-ink-3">(</span>deals closed this month<span className="text-ink-3">)</span>
          </p>
        </Section>

        <Section title="Connect an agent">
          <div id="connect" className="scroll-mt-8">
            <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
              Brainspace is a remote MCP server. Agents sign in as you and get your role in the workspace. Pick yours:
            </p>
            <div className="mt-6 max-w-[760px] rounded-lg border border-line-2 bg-sheet p-5">
              <AgentSetup base={base} />
            </div>
          </div>
        </Section>

        <Section title="Who can do what">
          <dl className="grid max-w-[760px] gap-6 text-[15px] sm:grid-cols-3">
            <div>
              <dt className="font-semibold">Admin</dt>
              <dd className="mt-1 leading-relaxed text-ink-2">Everything, including deleting team files and managing people.</dd>
            </div>
            <div>
              <dt className="font-semibold">Member</dt>
              <dd className="mt-1 leading-relaxed text-ink-2">Reads and edits everything. Can't delete team files.</dd>
            </div>
            <div>
              <dt className="font-semibold">Read-only</dt>
              <dd className="mt-1 leading-relaxed text-ink-2">Reads the team drive and uses read-only tools.</dd>
            </div>
          </dl>
        </Section>

        <section className="grid border-t border-line py-16 sm:grid-cols-[200px_minmax(0,1fr)] sm:py-24">
          <div />
          <div className="sm:pl-5">
            <p className="max-w-[20ch] text-[clamp(30px,4vw,44px)] leading-[1.05] font-semibold tracking-[-0.035em]">
              Give your agents the same page.
            </p>
            <Link
              to={primary.to}
              className="mt-8 inline-block rounded-md bg-brand px-5 py-3 text-[15px] font-medium text-white hover:bg-brand-ink"
            >
              {primary.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1200px] flex-wrap gap-x-6 gap-y-2 border-t border-line px-6 py-8 text-sm text-ink-3">
        <span>usebrain.space</span>
        <Link to="/docs" className="hover:text-ink">
          Docs
        </Link>
        <Link to="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link to="/terms" className="hover:text-ink">
          Terms
        </Link>
        <a href="mailto:hello@usebrain.space" className="hover:text-ink">
          Contact
        </a>
      </footer>
    </div>
  )
}

function PromoteDiagram() {
  return (
    <figure className="mt-8 max-w-[640px]">
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-md border border-dashed border-line-2 px-4 py-3">
          <div className="text-[12.5px] text-ink-3">Private</div>
          <div className="mt-1 font-mono text-[13px] break-all text-ink">/me/drafts/october-recap.md</div>
          <div className="mt-1 text-[12.5px] text-ink-3">v1 to v3</div>
        </div>
        <div className="flex items-center gap-2 px-1 text-[13px] font-medium text-brand-ink sm:flex-col sm:gap-1">
          <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden className="hidden sm:block">
            <path d="M0 6h36M31 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          promote
        </div>
        <div className="rounded-md border border-line-2 bg-sheet px-4 py-3">
          <div className="text-[12.5px] text-ink-3">Team</div>
          <div className="mt-1 font-mono text-[13px] break-all text-ink">/team/updates/october-recap.md</div>
          <div className="mt-1 text-[12.5px] text-ink-3">v1 to v3, now shared</div>
        </div>
      </div>
    </figure>
  )
}
