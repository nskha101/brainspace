import { Link, createFileRoute } from '@tanstack/react-router'
import { authConfigFn, getMe } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { AgentSetup } from '../components/AgentSetup'
import { VersionDemo } from '../components/VersionDemo'
import { AgentSession } from '../components/landing/AgentSession'
import { ConnectionsDiagram } from '../components/landing/ConnectionsDiagram'
import { BotRunDemo } from '../components/landing/BotRunDemo'
import { FlowRunDemo } from '../components/landing/FlowRunDemo'
import { PipelineDemo } from '../components/landing/PipelineDemo'
import { SetupPrompt } from '../components/landing/SetupPrompt'
import { PromoteDiagram, RolesTable } from '../components/landing/Sharing'
import { SECTIONS, SpaceTree, useActiveSection } from '../components/landing/SpaceTree'
import { cn } from '../lib/utils'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [me, config] = await Promise.all([getMe(), authConfigFn()])
    return { me, base: config.appUrl.replace(/\/$/, '') }
  },
  component: Landing,
})

/**
 * One stop on the walk through a workspace. The tree beside the page links to each by id, so a
 * section's order here has to match the tree's.
 */
function Feature({
  id,
  title,
  first,
  children,
}: {
  id: string
  title: string
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <section id={id} className={cn('scroll-mt-6', first ? 'pb-16 sm:pb-24' : 'border-t border-line py-16 sm:py-24')}>
      <h2 className="max-w-[30ch] text-[clamp(27px,3.3vw,38px)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
        {title}
      </h2>
      {children}
    </section>
  )
}

const lede = 'mt-4 max-w-[62ch] text-[17px] leading-relaxed text-ink-2'
const note = 'mt-4 max-w-[62ch] text-[14px] leading-relaxed text-ink-3'
const path = 'font-mono text-[15px] text-ink'

function Landing() {
  const { me, base } = Route.useLoaderData()
  const active = useActiveSection(SECTIONS)
  const primary = me
    ? { to: '/app' as const, label: 'Open your space' }
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
            {me ? 'Open your space' : 'Sign in'}
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-[1200px] px-6">
        <section className="pt-10 pb-20 sm:pt-16 sm:pb-28">
          {/* Pulled left by the E's side bearing so its stem lines up with the text below. */}
          <h1 className="-ml-[0.035em] text-[clamp(44px,6.6vw,88px)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance">
            Every agent on your team, <br className="hidden lg:block" />
            working from the same page.
          </h1>

          <div className="mt-10 grid items-start gap-x-16 gap-y-10 sm:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
            <div>
              <p className="max-w-[54ch] text-[18px] leading-relaxed text-ink-2 sm:text-[19px]">
                Brainspace is a shared workspace your agents reach over MCP. They read the same brand kit and playbooks,
                use the tools you've connected, and build flows, bots and dashboards the whole team can use. Each change is
                saved with the person and the agent behind it.
              </p>
              <Link
                to={primary.to}
                className="mt-8 inline-block rounded-md bg-brand px-5 py-3 text-[15px] font-medium text-white hover:bg-brand-ink"
              >
                {primary.label}
              </Link>
            </div>
            <SetupPrompt base={base} />
          </div>
        </section>

        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="hidden lg:block">
            <div className="sticky top-6 -ml-2 max-h-[calc(100vh-1.5rem)] overflow-y-auto pr-10 pb-10">
              <SpaceTree active={active} />
            </div>
          </div>

          <div className="min-w-0">
            <Feature id="docs" title="Every doc keeps its history" first>
              <p className={lede}>
                Your brand kit, playbooks and research live as docs in the workspace. Every save is a version, signed by the
                person and the agent that made it. You can compare any two versions and restore an old one, and so can your
                agents.
              </p>
              <div className="mt-10">
                <VersionDemo />
              </div>
              <p className={note}>Three people and three agents edited this doc. Pick a version to see what changed.</p>
            </Feature>

            <Feature id="skills" title="Skills teach every agent how your team works">
              <p className={lede}>
                A skill is a playbook saved in the workspace: how you write, how you prep a customer call, how you triage a
                bug. Write it once. Claude, Cursor, Codex and any other agent that connects loads the same one when a task
                calls for it.
              </p>
              <div className="mt-10">
                <AgentSession />
              </div>
              <p className={note}>
                One request from Maya. Her agent loads the skill, reads the doc the skill points to, checks HubSpot and saves
                a draft only she can see.
              </p>
            </Feature>

            <Feature id="flows" title="Flows run the work that repeats">
              <p className={lede}>
                A flow is a small program your agent writes and Brainspace runs: on a schedule, from a webhook, or when
                someone asks. Each step is saved as it finishes, so a flow can sleep for days or wait for a person and pick
                up where it left off. It can only touch the folders and connections it declares.
              </p>
              <div className="mt-10">
                <FlowRunDemo />
              </div>
              <p className={note}>Approve or reject the run to see what the flow does next, then run it again from the top.</p>
            </Feature>

            <Feature id="data" title="Databases hold the records. Artifacts show them.">
              <p className={lede}>
                Customers, deals and feedback are rows, so a folder can hold a database that flows and agents keep current.
                An artifact is a page your agent builds on top of one: a dashboard, a tracker, a small tool. It runs inside
                Brainspace, where it can read your data and has nowhere to send it.
              </p>
              <div className="mt-10">
                <PipelineDemo />
              </div>
              <p className={note}>
                Change a deal's stage. The page redraws, the same way it does when a flow or an agent updates a row.
              </p>
            </Feature>

            <Feature id="private" title="Draft in private. Promote when it's ready.">
              <p className={lede}>
                Everything under <code className={path}>/me</code> is private to you and your agents. Everything under{' '}
                <code className={path}>/team</code> is shared. Docs, flows and artifacts start in your space, and promoting
                one moves it to the team's with its history. Team folders can be limited to certain people.
              </p>
              <PromoteDiagram />
            </Feature>

            <Feature id="bots" title="Bots keep working after the chat ends">
              <p className={lede}>
                A bot is an agent with a standing job. Ask your agent for one and it writes the instructions, decides how
                often the bot should run, and gives it only the folders, tools and connections the job needs. Each run reads
                what's there and decides what to do, and it can hand parts of the job to subagents. A webhook can wake a
                bot when something changes outside, and a flow can run one as a step. A bot is private to you until you
                share it with the team.
              </p>
              <div className="mt-10">
                <BotRunDemo />
              </div>
              <p className={note}>
                A flow runs the same steps every time. A bot is for work that needs judgment, and it can run flows for the
                parts that don't. Run this one again to watch it split the job three ways.
              </p>
            </Feature>

            <Feature id="connections" title="Connect your tools once">
              <p className={lede}>
                Connect HubSpot, Slack, PostHog, or any MCP server or API, once for the whole workspace. Every agent, flow
                and bot reaches it through Brainspace.
              </p>
              <div className="mt-10">
                <ConnectionsDiagram />
              </div>
            </Feature>

            <Feature id="connect" title="Connect an agent with one paste">
              <p className={lede}>
                Brainspace is a remote MCP server. Your agent signs in as you and gets your role in the workspace. Pick
                yours:
              </p>
              <div className="mt-8 max-w-[760px] rounded-lg border border-line-2 bg-sheet p-5">
                <AgentSetup base={base} />
              </div>
            </Feature>

            <Feature id="roles" title="Three roles decide who can do what">
              <p className={lede}>An agent has the role of the person it signed in as, and no more.</p>
              <RolesTable />
            </Feature>
          </div>
        </div>

        <section className="border-t border-line py-16 sm:py-24 lg:pl-[240px]">
          <p className="max-w-[20ch] text-[clamp(30px,4vw,44px)] leading-[1.05] font-semibold tracking-[-0.035em]">
            Give your agents the same page.
          </p>
          <Link
            to={primary.to}
            className="mt-8 inline-block rounded-md bg-brand px-5 py-3 text-[15px] font-medium text-white hover:bg-brand-ink"
          >
            {primary.label}
          </Link>
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
