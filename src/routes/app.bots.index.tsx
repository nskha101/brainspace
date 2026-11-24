import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { BotMessageSquare, CalendarClock, Lock, Plus, Sparkles } from 'lucide-react'
import { botsFn } from '../lib/api'
import { Badge, Button, CopyField, PageHeader } from '../components/ui'
import { RunStatus, when } from '../components/FlowForms'
import { BotDialog } from '../components/BotForms'
import { timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/bots/')({
  loader: () => botsFn(),
  component: BotsPage,
})

const IDEAS = [
  'Make a Brainspace bot that reads yesterday’s meeting notes every weekday at 8am and adds the action items to /team/meetings/action-items.md.',
  'Make a bot that checks our competitors every Monday morning and writes a digest in /team/research/digests, one subagent per competitor.',
  'Make a private bot that reviews docs I changed this week against our voice guide every Friday and leaves its notes in /me/reviews.',
]

function BotsPage() {
  const { bots, role, aiConfigured } = Route.useLoaderData()
  const [open, setOpen] = useState(false)
  const canWrite = role !== 'viewer'
  const team = bots.filter((b) => b.visibility === 'team')
  const mine = bots.filter((b) => b.visibility === 'private')

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Bots"
        description="Agents that work on their own schedule. Each has instructions, a model, tools and the part of the brain it may touch, and everything it changes shows up in Activity."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New bot
            </Button>
          )
        }
      />

      {!aiConfigured && (
        <div className="mb-6 flex gap-2.5 rounded-lg border border-[#e8c87a] bg-[#fdf6e7] p-3.5 text-[13.5px]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-[#8a5a00]" />
          <div>
            Bots need a model, and this workspace has no AI Gateway key yet.{' '}
            <Link to="/app/settings" className="font-medium underline">
              An admin can add one in Settings
            </Link>
            .
          </div>
        </div>
      )}

      {bots.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-paper/50 p-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            <BotMessageSquare className="size-4.5 text-brand" /> No bots yet
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            Ask your agent to set one up. It writes the instructions, picks how often the bot should run, and runs it once so you can see what it does. A few to try:
          </p>
          <div className="mt-4 space-y-2">
            {IDEAS.map((i) => (
              <CopyField key={i} value={i} mono={false} />
            ))}
          </div>
        </div>
      ) : (
        [
          { label: 'Team bots', list: team, hint: 'Everyone sees these and their runs. They work in the team space only.' },
          { label: 'Your private bots', list: mine, hint: 'Only you see these. They can use your personal space too.' },
        ].map((group) =>
          group.list.length === 0 && group.label.startsWith('Your') ? null : (
            <section key={group.label} className="mt-6">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="mb-3 text-[13px] text-ink-3">{group.hint}</p>
              {group.list.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-2 px-4 py-3 text-[13px] text-ink-3">None yet.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {group.list.map((b) => (
                    <li key={b.id}>
                      <Link to="/app/bots/$botId" params={{ botId: b.id }} className="block px-4 py-3.5 hover:bg-paper">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{b.name}</span>
                          {b.visibility === 'private' && <Lock className="size-3 text-ink-3" />}
                          {!b.enabled && <Badge>Paused</Badge>}
                          <span className="ml-auto flex items-center gap-3 text-[12px] text-ink-3">
                            {b.nextRunAt && (
                              <span className="inline-flex items-center gap-1">
                                <CalendarClock className="size-3.5" /> Next {when(b.nextRunAt)}
                              </span>
                            )}
                            {b.lastRun?.status && (
                              <span className="inline-flex items-center gap-1.5">
                                <RunStatus status={b.lastRun.status} /> {b.lastRun.at ? timeAgo(b.lastRun.at) : ''}
                              </span>
                            )}
                          </span>
                        </div>
                        <p className="mt-1 text-[13.5px] text-ink-2">
                          {b.schedule ?? 'Runs when asked'}
                          {b.mine ? '' : ` · runs as ${b.owner}`}
                          {b.description ? ` · ${b.description}` : ''}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ),
        )
      )}
      <BotDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
