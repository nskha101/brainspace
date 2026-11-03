import { Link, createFileRoute } from '@tanstack/react-router'
import { FileText, Image as ImageIcon } from 'lucide-react'
import { homeFn } from '../lib/api'
import { ActivityRow } from '../components/ActivityRow'
import { Badge, Empty } from '../components/ui'
import { driveHref, timeAgo } from '../lib/utils'
import { logoUrl, presetById } from '../lib/presets'

export const Route = createFileRoute('/app/')({
  loader: () => homeFn(),
  component: Home,
})

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

function Home() {
  const d = Route.useLoaderData()
  const first = d.userName?.split(' ')[0]
  const empty = d.stats.team.docs + d.stats.me.docs + d.stats.team.files <= 8 && d.connections.length === 0
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{first ? `Hi ${first}` : d.workspaceName}</h1>
      <p className="mt-1 text-[15px] text-ink-2">
        {d.workspaceName} has {plural(d.stats.team.docs, 'team doc')}, {plural(d.stats.team.files, 'file')} and{' '}
        {plural(d.skills.length, 'skill')}. You have {plural(d.stats.me.docs, 'private doc')}.
      </p>

      {empty && (
        <div className="mt-8 rounded-xl border border-line bg-paper p-6">
          <h2 className="font-semibold">Set up your brain</h2>
          <ol className="mt-3 space-y-2 text-[15px] text-ink-2">
            <li>
              <Link to={driveHref('/team/company/overview.md') as never} className="font-medium text-ink underline underline-offset-4">
                Fill in the company overview
              </Link>{' '}
              and the{' '}
              <Link to={driveHref('/team/brand/voice.md') as never} className="font-medium text-ink underline underline-offset-4">
                voice guide
              </Link>
              . Agents read these before writing anything.
            </li>
            <li>
              <Link to="/app/agents" className="font-medium text-ink underline underline-offset-4">
                Connect your agent
              </Link>{' '}
              so it can read and update the brain. After that you can ask it to do the rest.
            </li>
            <li>
              <Link to="/app/connections" className="font-medium text-ink underline underline-offset-4">
                Add connections
              </Link>{' '}
              like HubSpot or PostHog, and{' '}
              <Link to="/app/members" className="font-medium text-ink underline underline-offset-4">
                invite your team
              </Link>
              .
            </li>
          </ol>
        </div>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-2">Recently changed</h2>
          {d.recent.length === 0 ? (
            <Empty title="No docs yet" />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <Link to={driveHref(r.path) as never} className="flex items-start gap-3 px-4 py-3 hover:bg-paper">
                    {r.kind === 'file' ? <ImageIcon className="mt-0.5 size-4 text-ink-3" /> : <FileText className="mt-0.5 size-4 text-ink-3" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px] text-ink">{r.path}</div>
                      <div className="mt-0.5 text-[12.5px] text-ink-3">
                        v{r.version}, {timeAgo(r.updatedAt)} by {r.updatedByName ?? 'someone'}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-2">Activity</h2>
          {d.activity.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing yet.</p>
          ) : (
            <ul className="space-y-3">
              {d.activity.map((a) => (
                <ActivityRow key={a.id} a={a} compact />
              ))}
            </ul>
          )}
          <Link to="/app/activity" className="mt-4 inline-block text-sm text-brand-ink hover:underline">
            All activity
          </Link>
        </section>
      </div>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-2">Skills</h2>
          {d.skills.length === 0 ? (
            <p className="text-sm text-ink-3">No skills yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {d.skills.slice(0, 6).map((s) => (
                <li key={s.path}>
                  <Link to={driveHref(s.path) as never} className="group block">
                    <span className="font-medium group-hover:underline">{s.name}</span>
                    {s.drive === 'me' && <Badge className="ml-2">private</Badge>}
                    <span className="block truncate text-[13px] text-ink-2">{s.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-2">Connections</h2>
          {d.connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              None yet.{' '}
              <Link to="/app/connections" className="text-brand-ink hover:underline">
                Connect a tool
              </Link>
            </p>
          ) : (
            <ul className="space-y-2">
              {d.connections.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 text-sm">
                  {presetById(c.presetId)?.domain ? (
                    <img src={logoUrl(presetById(c.presetId)!.domain)} alt="" className="size-4 rounded" />
                  ) : (
                    <span className="size-4 rounded bg-line" />
                  )}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-ink-3">{c.toolCount} tools</span>
                  {c.status !== 'active' && <Badge tone="danger">{c.status === 'needs_auth' ? 'needs sign-in' : 'error'}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
