import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AtSign, BotMessageSquare, CalendarClock, Lock, Plus, Sparkles, Workflow } from 'lucide-react'
import { botsFn } from '../lib/api'
import { Badge, Button, CopyField, ItemIcon, PageHeader } from '../components/ui'
import { RunStatus, when } from '../components/FlowForms'
import { BotDialog } from '../components/BotForms'
import { templateHref } from '../components/TemplateForms'
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
  const { bots, templates, role, aiConfigured } = Route.useLoaderData()
  const [open, setOpen] = useState(false)
  const canWrite = role !== 'viewer'
  // Every workspace has one bot of its own, listed apart from the ones people made.
  const own = bots.find((b) => b.kind === 'workspace')
  const made = bots.filter((b) => b.kind !== 'workspace')
  const team = made.filter((b) => b.visibility === 'team')
  const mine = made.filter((b) => b.visibility === 'private')
  // Someone with no bots of their own most likely came to copy a teammate's.
  const templatesFirst = mine.length === 0

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

      {own && (
        <Link to="/app/bots/$botId" params={{ botId: own.id }} className="mb-6 flex gap-3.5 rounded-xl border border-line px-4 py-4 hover:bg-paper">
          <ItemIcon icon={own.icon} kind="bot" size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{own.name}</span>
              <Badge tone="agent">Workspace bot</Badge>
              {!own.enabled && <Badge>Paused</Badge>}
              {own.lastRun?.status && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink-3">
                  <RunStatus status={own.lastRun.status} /> {own.lastRun.at ? timeAgo(own.lastRun.at) : ''}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[13.5px] text-ink-2">
              Ask it anything about the team space, or to build a flow, a bot or an artifact. It acts as whoever asks, and anyone can ask it to change its name or instructions.
            </p>
            <p className="mt-1 text-[12px] text-ink-3">{own.slack ? `Mention @${own.slack.handle ?? 'Brainspace'} in Slack, or ask it from its page` : 'Ask it from its page'}</p>
          </div>
        </Link>
      )}

      {templates.length > 0 && templatesFirst && <Templates list={templates} />}

      {made.length === 0 ? (
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
          { label: 'Team bots', list: team, hint: 'Shared with everyone, or with the people each one names. They work in the team space only.' },
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
                      <Link to="/app/bots/$botId" params={{ botId: b.id }} className="flex gap-3.5 px-4 py-3.5 hover:bg-paper">
                        <ItemIcon icon={b.icon} kind="bot" size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{b.name}</span>
                            {b.visibility === 'private' && <Lock className="size-3 text-ink-3" />}
                            {b.sharedWith && <Lock className="size-3 text-brand-ink" aria-label="Only certain people can see this" />}
                            {!b.enabled && <Badge>Paused</Badge>}
                            {b.slack && (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-paper px-1.5 py-0.5 text-[12px] text-ink-2"
                                title={b.slack.handle ? `Mention @${b.slack.handle} in Slack to ask it something` : `Ask it in Slack with @Brainspace ${b.name}`}
                              >
                                <AtSign className="size-3 text-ink-3" />
                                {b.slack.handle ?? 'In Slack'}
                              </span>
                            )}
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
                          {b.description && <p className="mt-0.5 text-[13.5px] text-ink-2">{b.description}</p>}
                          <p className="mt-1 text-[12px] text-ink-3">
                            {[b.schedule, b.webhook ? 'wakes on its webhook' : null, b.flows.length ? `runs in ${b.flows.join(', ')}` : null].filter(Boolean).join(' · ') || 'Runs when asked'}
                            {` · ${b.mine ? 'yours' : `by ${b.owner}`}`}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ),
        )
      )}
      {templates.length > 0 && !templatesFirst && <Templates list={templates} />}
      <BotDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

type TemplateItem = Awaited<ReturnType<typeof botsFn>>['templates'][number]

/** Bots teammates packaged so anyone can set up their own copy. */
function Templates({ list }: { list: TemplateItem[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">Templates</h2>
      <p className="mb-3 text-[13px] text-ink-3">Set up your own copy of a teammate's bot. It runs as you, with your own logins, secrets and docs.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => (
          <li key={t.path}>
            <Link {...templateHref(t.path)} className="flex h-full gap-3 rounded-lg border border-line px-4 py-3.5 hover:bg-paper">
              <ItemIcon icon={t.icon} kind="bot" size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  {t.space === 'me' && <Lock className="size-3 text-ink-3" />}
                </div>
                {t.description && <p className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-2">{t.description}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                  {t.flows.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Workflow className="size-3" /> {t.flows.length} {t.flows.length === 1 ? 'flow' : 'flows'}
                    </span>
                  )}
                  {t.needs.connections.length > 0 && <span>Uses {t.needs.connections.join(', ')}</span>}
                  {t.maker && <span>by {t.maker}</span>}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
