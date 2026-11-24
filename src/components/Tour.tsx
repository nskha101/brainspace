import type { ReactNode } from 'react'
import { AppWindow, BotMessageSquare, FolderTree, Plug, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { VersionDemo } from './VersionDemo'
import { AgentSession } from './landing/AgentSession'
import { BotRunDemo } from './landing/BotRunDemo'
import { ConnectionsDiagram } from './landing/ConnectionsDiagram'
import { FlowRunDemo } from './landing/FlowRunDemo'
import { PipelineDemo } from './landing/PipelineDemo'
import { PromoteDiagram, RolesTable } from './landing/Sharing'
import { CopyField } from './ui'
import { cn } from '../lib/utils'

type Topic = {
  id: string
  label: string
  icon: ReactNode
  title: string
  body: ReactNode
  uses: string[]
  ask: string[]
  demo: () => ReactNode
}

const code = 'font-mono text-[14px] text-ink'

/** The parts of Brainspace, in the order a new person meets them. Each has what it is, what teams use it for and what to ask an agent. */
export const TOPICS: Topic[] = [
  {
    id: 'spaces',
    label: 'Spaces and docs',
    icon: <FolderTree />,
    title: 'One brain, two spaces',
    body: (
      <>
        <p>
          Everything lives at a path. <code className={code}>/team</code> is shared with the whole workspace, and{' '}
          <code className={code}>/me</code> is private to you and your agents. A space holds docs, uploaded files and
          folders. Every save is a new version, signed by the person and the agent that made it, so you can see who changed
          what and roll anything back.
        </p>
        <p>
          Folders can carry notes for agents, like "read overview.md first" or "name new files by date", and agents follow
          them whenever they work in that folder.
        </p>
      </>
    ),
    uses: [
      'A company overview, pricing and positioning that every agent quotes the same way',
      'The brand kit: logos, colors, fonts and the voice guide',
      'Meeting notes, decisions and customer research',
      'Contracts, decks and PDFs that agents can search inside',
    ],
    ask: ['What do we have in the team brain about pricing?', 'Save the decisions from this conversation to the team brain.'],
    demo: () => <VersionDemo />,
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: <Sparkles />,
    title: 'Skills teach every agent how your team works',
    body: (
      <p>
        A skill is a playbook saved in the workspace: the steps, the format and the docs to read for one kind of job. Write
        it once, and Claude, Cursor, Codex or any other connected agent loads it when a task calls for it. Draft one in{' '}
        <code className={code}>/me</code>, try it on a real task, then share it with the team.
      </p>
    ),
    uses: [
      'How you write release notes or the weekly update',
      'Prepping a sales call: which docs and CRM fields to check first',
      'Triaging a bug report',
      'Writing a social post in your voice',
    ],
    ask: ['Turn how we write release notes into a team skill.', 'Which team skills do we have, and when should you use them?'],
    demo: () => <AgentSession />,
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: <Plug />,
    title: 'Connect a tool once, use it everywhere',
    body: (
      <>
        <p>
          Connect Slack, HubSpot, Linear, Google Drive, or any MCP server or REST API once for the workspace. Every agent,
          flow and bot on the team then reaches its tools through Brainspace, named like{' '}
          <code className={code}>hubspot__search_crm_objects</code>. The keys stay encrypted on the server. Agents get the
          tool, never the token.
        </p>
        <p>
          A connection either uses one shared account, which suits analytics, or has each person sign in with their own,
          which suits email and Drive. Admins can limit it by role, by person and by tool.
        </p>
      </>
    ),
    uses: [
      'Ask about any deal in HubSpot from any agent, without everyone setting up HubSpot',
      'Let flows and bots post to your Slack channels',
      'Read Drive files and Notion pages next to what is in the brain',
      'Pull PostHog or Stripe numbers into a dashboard',
    ],
    ask: ['Connect our Linear to Brainspace.', 'Which tools can you reach through Brainspace?'],
    demo: () => <ConnectionsDiagram />,
  },
  {
    id: 'flows',
    label: 'Flows',
    icon: <Workflow />,
    title: 'Flows run the work that repeats',
    body: (
      <>
        <p>
          A flow is a small automation. You describe the job, your agent writes the flow, and Brainspace runs it when someone
          clicks Run, on a schedule, or when a webhook fires.
        </p>
        <p>
          A step can call any tool from any connection, have an AI model write or sort something, read and update docs and
          databases, post to Slack, send an email, or stop and wait for a person to approve. Each flow lists the folders and
          connections it may touch and can't reach anything else. Steps are saved as they finish, so a flow can wait days
          for an approval and carry on where it stopped.
        </p>
      </>
    ),
    uses: [
      'Weekly PostHog metrics, compared with last week, posted to #growth',
      'A HubSpot pipeline review that flags deals that have gone quiet',
      'Meeting notes turned into owned action items once you approve them',
      'A summary of every new contract dropped into a folder',
      'A weekly digest of what competitors shipped',
    ],
    ask: ['Make a flow that posts last week\'s signups from PostHog to #growth every Monday at 9.', 'Show me the flow templates.'],
    demo: () => <FlowRunDemo />,
  },
  {
    id: 'artifacts',
    label: 'Databases and artifacts',
    icon: <AppWindow />,
    title: 'Databases hold the records. Artifacts show them.',
    body: (
      <p>
        Records that change, like customers, deals or feedback, go in a database inside a folder, and flows and agents keep
        it current. An artifact is a page your agent builds on top of that data: a dashboard, a tracker or a small tool. It
        runs inside Brainspace with the viewer's access, so it can show your data but has nowhere to send it.
      </p>
    ),
    uses: [
      'A pipeline dashboard that a nightly HubSpot flow keeps fresh',
      'A customer feedback tracker the team edits together',
      'A content calendar or launch checklist',
      'A small internal tool, like a pricing calculator',
    ],
    ask: ['Build a dashboard of our open deals by stage.', 'Make a customer feedback tracker the team can edit.'],
    demo: () => <PipelineDemo />,
  },
  {
    id: 'bots',
    label: 'Bots',
    icon: <BotMessageSquare />,
    title: 'Bots keep working after the chat ends',
    body: (
      <p>
        A bot is an agent with a standing job. Ask your agent for one and it writes the bot's instructions, picks how often
        it runs, and gives it only the folders, tools and connections the job needs. A flow runs the same steps every time; a
        bot decides what to do on each run, so it suits work that needs judgment. A webhook or a flow can also wake it.
      </p>
    ),
    uses: [
      'A morning brief from Linear, sent to you as a Slack DM',
      'A weekly look through HubSpot for customers who have gone quiet',
      'Keeping the customer database in step with HubSpot',
      'Watching competitors and writing up only what matters',
    ],
    ask: ["Make me a bot that checks Linear every weekday at 8 and DMs me what's blocked."],
    demo: () => <BotRunDemo />,
  },
  {
    id: 'sharing',
    label: 'Sharing and permissions',
    icon: <ShieldCheck />,
    title: "Draft in private, share when it's ready",
    body: (
      <>
        <p>
          Docs, skills, flows and artifacts start in your <code className={code}>/me</code> space. Promoting one moves it to{' '}
          <code className={code}>/team</code> with its history, and from then on everyone's agents use it. Admins can limit a
          team folder or file to certain people.
        </p>
        <p>
          Everyone has one of three roles, and an agent gets exactly the role of the person it signed in as. Flows and bots
          run as the person who started or owns them, so they can never reach more than that person can.
        </p>
      </>
    ),
    uses: [
      'A finance or hiring folder only the right people can open',
      'Read-only access for contractors and advisors',
      'Only admins can delete team files or remove a connection',
    ],
    ask: ['Share my launch email draft with the team.', 'Who can see /team/finance?'],
    demo: () => (
      <>
        <PromoteDiagram />
        <RolesTable />
      </>
    ),
  },
]

/** A walk through what Brainspace is, one part at a time. The caller owns which topic is showing. */
export function Tour({ topic, onTopic }: { topic: string; onTopic: (id: string) => void }) {
  const t = TOPICS.find((x) => x.id === topic) ?? TOPICS[0]!
  return (
    <div>
      <div className="-mx-1 flex flex-wrap gap-1" role="tablist" aria-label="Parts of Brainspace">
        {TOPICS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={x.id === t.id}
            onClick={() => onTopic(x.id)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] [&>svg]:size-3.5',
              x.id === t.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-wash hover:text-ink',
            )}
          >
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-8">
        <h2 className="text-[21px] font-semibold tracking-[-0.02em]">{t.title}</h2>
        <div className="mt-3 max-w-2xl space-y-3 text-[15px] leading-relaxed text-ink-2">{t.body}</div>

        <div className="mt-7 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-medium text-ink-2">Teams use it for</h3>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-snug text-ink">
              {t.uses.map((u) => (
                <li key={u} className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                  {u}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[13px] font-medium text-ink-2">Try asking your agent</h3>
            <div className="mt-2 space-y-2">
              {t.ask.map((a) => (
                <CopyField key={a} mono={false} value={a} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10">{t.demo()}</div>
      </div>
    </div>
  )
}
