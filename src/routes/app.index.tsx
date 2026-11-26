import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronRight, Clock, Database, FileText, Image as ImageIcon } from 'lucide-react'
import { homeFn } from '../lib/api'
import { ActivityRow } from '../components/ActivityRow'
import { RunStatus, when } from '../components/FlowForms'
import { Badge, CopyField, ItemIcon } from '../components/ui'
import { cn, readsSummary, spaceHref, timeAgo } from '../lib/utils'
import { logoUrl, presetById } from '../lib/presets'

export const Route = createFileRoute('/app/')({
  loader: () => homeFn(),
  component: Home,
})

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "/team/brand/voice.md" -> "/team/brand" */
const folderOf = (path: string) => path.replace(/\/[^/]+$/, '') || '/'

function Home() {
  const d = Route.useLoaderData()
  const first = d.userName?.split(' ')[0]
  const empty = d.stats.team.docs <= 1 && d.stats.team.files === 0
  const [tab, setTab] = useState<'changed' | 'read'>('changed')
  const list = tab === 'changed' ? d.recent : d.mostRead
  const scheduledFlows = d.flows.filter((f) => f.nextRunAt).length
  const activeBots = d.bots.filter((b) => b.enabled).length
  const flowTitle = (name: string) => d.flows.find((f) => f.name === name)?.title ?? name
  // Soonest scheduled first, then the ones that ran most recently.
  const flows = [...d.flows].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0)).slice(0, 5)
  const bots = [...d.bots].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)).slice(0, 5)

  return (
    <div className="px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{first ? `Hi ${first}` : d.workspaceName}</h1>
        <p className="mt-1 text-[15px] text-ink-2">
          Here's what's going on in {d.workspaceName}. You have {plural(d.stats.me.docs, 'private doc')}.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat to={spaceHref('/team')} label="Team docs" value={d.stats.team.docs} note={plural(d.stats.team.files, 'file')} />
          <Stat to="/app/flows" label="Flows" value={d.flows.length} note={scheduledFlows ? `${scheduledFlows} on a schedule` : 'None scheduled'} />
          <Stat to="/app/bots" label="Bots" value={d.bots.length} note={d.bots.length ? `${activeBots} active` : 'None yet'} />
          <Stat to="/app/skills" label="Skills" value={d.skills.length} note={`${d.skills.filter((s) => s.space === 'team').length} shared`} />
          <Stat to="/app/connections" label="Connections" value={d.connections.length} note={`${d.connections.reduce((n, c) => n + c.toolCount, 0)} tools`} />
        </div>

        {d.waiting.length > 0 && (
          <section className="mt-6 rounded-xl border border-[#e8c87a] bg-[#fdf6e7] p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#8a5a00]">
              <Clock className="size-4" /> Waiting for approval
            </h2>
            <ul className="mt-2 space-y-1">
              {d.waiting.map((r) => (
                <li key={r.id}>
                  <Link to="/app/flows/runs/$runId" params={{ runId: r.id }} className="flex items-center gap-2 rounded px-2 py-1.5 text-[13.5px] hover:bg-white/60">
                    <span className="font-medium">{flowTitle(r.flow)}</span>
                    <span className="truncate text-ink-2">{r.waitingFor}</span>
                    <span className="ml-auto shrink-0 text-[12px] text-ink-3">{timeAgo(r.createdAt)}</span>
                    <ChevronRight className="size-3.5 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {empty && (
          <div className="mt-6 rounded-xl border border-line bg-paper p-6">
            <h2 className="font-semibold">Let your agent build the brain</h2>
            <p className="mt-1 text-[15px] text-ink-2">The team space starts nearly empty on purpose. Agents fill it in.</p>
            <ol className="mt-4 space-y-4 text-[15px] text-ink-2">
              <li>
                <Link to="/app/agents" className="font-medium text-ink underline underline-offset-4">
                  Connect your agent
                </Link>{' '}
                and install the Brainspace skills. It takes a minute.
              </li>
              <li>
                Ask it to set things up. It writes the company overview, brand kit, voice guide and first team skills, and
                leaves a TODO wherever it needs your answer:
                <CopyField className="mt-2" mono={false} value="Set up our Brainspace from https://our-company.com" />
              </li>
              <li>
                Already have docs or brand assets?{' '}
                <Link to={spaceHref('/team') as never} className="font-medium text-ink underline underline-offset-4">
                  Drop the folder into the team space
                </Link>
                . Then{' '}
                <Link to="/app/connections" className="font-medium text-ink underline underline-offset-4">
                  connect your tools
                </Link>{' '}
                and{' '}
                <Link to="/app/members" className="font-medium text-ink underline underline-offset-4">
                  invite your team
                </Link>
                .
              </li>
            </ol>
          </div>
        )}

        <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-5 xl:grid-cols-2">
            <Card
              className="xl:col-span-2"
              title={
                <div className="flex gap-4" role="tablist">
                  {(
                    [
                      ['changed', 'Recently changed'],
                      ['read', 'Most read'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={cn(tab === id ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            >
              {list.length === 0 ? (
                <CardEmpty>{tab === 'changed' ? 'No docs yet.' : 'Nothing read yet.'}</CardEmpty>
              ) : (
                <ul className="grid divide-y divide-line md:grid-cols-2 md:divide-y-0">
                  {list.map((r) => (
                    <li key={r.id} className="md:border-b md:border-line md:odd:border-r md:[&:nth-last-child(-n+2)]:border-b-0">
                      <Link to={spaceHref(r.path) as never} className="flex items-start gap-3 px-4 py-3 hover:bg-paper">
                        {r.kind === 'database' ? (
                          <Database className="mt-0.5 size-4 shrink-0 text-ink-3" />
                        ) : r.kind === 'file' ? (
                          <ImageIcon className="mt-0.5 size-4 shrink-0 text-ink-3" />
                        ) : (
                          <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium text-ink">{r.name}</div>
                          <div className="truncate font-mono text-[12px] text-ink-3">{folderOf(r.path)}</div>
                          <div className="mt-0.5 text-[12.5px] text-ink-3">
                            {tab === 'changed' || !r.readAt
                              ? `${r.kind === 'database' ? 'Database' : `v${r.version}`}, ${timeAgo(r.updatedAt)} by ${r.updatedByName ?? 'someone'}`
                              : `${readsSummary(r)}, last ${timeAgo(r.readAt)}${r.readByName ? ` by ${r.readByName}` : ''}`}
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Flows" more={{ to: '/app/flows', label: 'All flows' }}>
              {flows.length === 0 ? (
                <CardEmpty>
                  No flows yet. Ask your agent to automate something, like a weekly digest.
                </CardEmpty>
              ) : (
                <ul className="divide-y divide-line">
                  {flows.map((f) => (
                    <li key={f.id}>
                      <Link to="/app/flows/$flowId" params={{ flowId: f.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper">
                        <ItemIcon icon={f.icon} kind="flow" size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[14px] font-medium">{f.title}</span>
                            {f.status === 'invalid' && <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-label="Needs fixing" />}
                          </div>
                          <div className="truncate text-[12.5px] text-ink-3">
                            {f.nextRunAt ? `Next ${when(f.nextRunAt)}` : f.lastRun ? `Ran ${timeAgo(f.lastRun.at)}` : 'Runs when asked'}
                            {f.createdBy && ` · by ${f.createdBy}`}
                          </div>
                        </div>
                        {f.lastRun && <RunStatus status={f.lastRun.status} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Bots" more={{ to: '/app/bots', label: 'All bots' }}>
              {bots.length === 0 ? (
                <CardEmpty>No bots yet. Ask your agent for one that does a job on a schedule.</CardEmpty>
              ) : (
                <ul className="divide-y divide-line">
                  {bots.map((b) => (
                    <li key={b.id}>
                      <Link to="/app/bots/$botId" params={{ botId: b.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper">
                        <ItemIcon icon={b.icon} kind="bot" size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium">{b.name}</div>
                          <div className="truncate text-[12.5px] text-ink-3">
                            {!b.enabled ? 'Paused' : b.nextRunAt ? `Next ${when(b.nextRunAt)}` : (b.schedule ?? 'Runs when asked')}
                            {` · ${b.mine ? 'yours' : `by ${b.owner}`}`}
                          </div>
                        </div>
                        {b.lastRun?.status && <RunStatus status={b.lastRun.status} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Skills" more={{ to: '/app/skills', label: 'All skills' }}>
              {d.skills.length === 0 ? (
                <CardEmpty>No skills yet. Ask your agent to turn something you do often into one.</CardEmpty>
              ) : (
                <ul className="divide-y divide-line">
                  {d.skills.slice(0, 5).map((s) => (
                    <li key={s.path}>
                      <Link to={spaceHref(s.path) as never} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper">
                        <ItemIcon icon={s.icon} kind="skill" size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[14px] font-medium">{s.title}</span>
                            {s.space === 'me' && <Badge>private</Badge>}
                          </div>
                          <div className="truncate text-[12.5px] text-ink-3">{s.description || (s.createdBy ? `by ${s.createdBy}` : s.name)}</div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Connections" more={{ to: '/app/connections', label: 'Manage' }}>
              {d.connections.length === 0 ? (
                <CardEmpty>
                  None yet.{' '}
                  <Link to="/app/connections" className="text-brand-ink hover:underline">
                    Connect a tool
                  </Link>
                </CardEmpty>
              ) : (
                <ul className="divide-y divide-line">
                  {d.connections.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      {presetById(c.presetId)?.domain ? (
                        <img src={logoUrl(presetById(c.presetId)!.domain)} alt="" className="size-5 rounded" />
                      ) : (
                        <span className="size-5 rounded bg-line" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      {c.status !== 'active' ? (
                        <Badge tone="danger">{c.status === 'needs_auth' ? 'needs sign-in' : 'error'}</Badge>
                      ) : (
                        <span className="text-[12.5px] text-ink-3">{plural(c.toolCount, 'tool')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Activity" more={{ to: '/app/activity', label: 'All activity' }}>
            {d.activity.length === 0 ? (
              <CardEmpty>Nothing yet.</CardEmpty>
            ) : (
              <ul className="space-y-3.5 px-4 py-3.5">
                {d.activity.map((a) => (
                  <ActivityRow key={a.id} a={a} compact />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ to, label, value, note }: { to: string; label: string; value: number; note: string }) {
  return (
    <Link to={to as never} className="rounded-xl border border-line bg-sheet px-4 py-3 transition-colors hover:border-line-2 hover:bg-paper">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-[24px] leading-tight font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="truncate text-[12px] text-ink-3">{note}</div>
    </Link>
  )
}

function Card({ title, more, className, children }: { title: ReactNode; more?: { to: string; label: string }; className?: string; children: ReactNode }) {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-line bg-sheet', className)}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm font-semibold">
        {title}
        {more && (
          <Link to={more.to as never} className="text-[13px] font-normal text-brand-ink hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-[13.5px] text-ink-3">{children}</p>
}
