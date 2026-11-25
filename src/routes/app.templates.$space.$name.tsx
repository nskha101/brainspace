import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CalendarClock, FolderOpen, Lock, Share2, Users, Workflow } from 'lucide-react'
import { promoteFn, templateFn } from '../lib/api'
import { Badge, Button, CopyField, ItemIcon } from '../components/ui'
import { MarkdownEditor } from '../components/Editor'
import { CheckRow, UseTemplateDialog, templateHref } from '../components/TemplateForms'
import { errMessage, spaceHref, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/templates/$space/$name')({
  loader: ({ params }) => templateFn({ data: { path: `/${params.space}/templates/${params.name}` } }),
  component: TemplatePage,
})

function TemplatePage() {
  const t = Route.useLoaderData()
  const navigate = useNavigate()
  const [useOpen, setUseOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const s = t.setup

  const share = async () => {
    if (!confirm(`Share ${t.title} with the team? Everyone in the workspace can then read its files and set up their own copy.`)) return
    setSharing(true)
    try {
      await promoteFn({ data: { path: t.path, message: `Share template ${t.name}` } })
      toast.success(`${t.title} is shared with the team.`)
      navigate(templateHref(t.path.replace(/^\/me\//, '/team/')))
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setSharing(false)
    }
  }

  const todoCount = [
    ...s.bots.map((b) => b.have),
    ...s.flows.map((f) => f.have),
    ...[...s.connections, ...s.secrets, ...s.docs, ...s.triggers].map((c) => c.state === 'ready'),
    !s.unfilled.length,
  ].filter((done) => !done).length

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 lg:px-10">
      <div className="mb-1 text-[13px] text-ink-3">
        <Link to="/app/bots" className="hover:text-ink">
          Bots
        </Link>{' '}
        / Templates
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <ItemIcon icon={t.icon} kind="bot" size={44} className="mt-0.5 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {t.title}
            <Badge>Template</Badge>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              {t.space === 'team' ? <Users className="size-3.5" /> : <Lock className="size-3.5" />}
              {t.space === 'team' ? 'Shared with the team' : 'Only you'}
            </span>
            {t.maker && <span>Made by {t.mine ? 'you' : t.maker}</span>}
            <span>Updated {timeAgo(t.updatedAt)}</span>
          </p>
          {t.description && <p className="mt-2 max-w-2xl text-[14px] text-ink-2">{t.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate({ to: spaceHref(t.path) as never })}>
            <FolderOpen className="size-4" /> Files
          </Button>
          {t.canShare && (
            <Button onClick={share} loading={sharing}>
              <Share2 className="size-4" /> Share with team
            </Button>
          )}
          {t.canUse && !s.started && (
            <Button variant="primary" onClick={() => setUseOpen(true)} disabled={t.problems.length > 0}>
              Use this template
            </Button>
          )}
        </div>
      </div>

      {t.problems.length > 0 && (
        <div className="mt-6 flex gap-2.5 rounded-lg border border-danger/30 bg-danger-wash p-3.5 text-[13.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            Some of its files can't be read, so it can't be used yet: {t.problems.join(' ')}
          </div>
        </div>
      )}

      {t.mine && t.space === 'me' && (
        <div className="mt-6 rounded-lg border border-line bg-paper/60 p-4 text-[13.5px] text-ink-2">
          Before you share it, check its files for anything that only fits you, like your Slack ID or a channel. Your agent can do it:
          <CopyField value={`Go through my "${t.title}" template in Brainspace and replace anything personal with fields.`} mono={false} className="mt-2" />
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">What you get</h2>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {t.bots.map((b) => (
            <li key={b.file} className="flex gap-3 px-4 py-3">
              <ItemIcon icon={b.icon} kind="bot" size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-[12px] text-ink-3">bot</span>
                  {b.cron && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
                      <CalendarClock className="size-3.5" /> {b.cron} {b.timezone ?? ''}
                    </span>
                  )}
                </div>
                {b.description && <p className="mt-0.5 text-[13.5px] text-ink-2">{b.description}</p>}
              </div>
            </li>
          ))}
          {t.flows.map((f) => (
            <li key={f.name} className="flex gap-3 px-4 py-3">
              <ItemIcon kind="flow" size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-medium">{f.name}</span>
                  <span className="text-[12px] text-ink-3">flow</span>
                </div>
                {f.description && <p className="mt-0.5 text-[13.5px] text-ink-2">{f.description}</p>}
              </div>
            </li>
          ))}
          {!t.bots.length && !t.flows.length && <li className="px-4 py-3 text-[13.5px] text-ink-3">Nothing in it yet.</li>}
        </ul>
      </section>

      <section className="mt-8">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">{s.started ? 'Your setup' : 'What you need'}</h2>
          {s.started && <span className="text-[12.5px] text-ink-3">{todoCount ? `${todoCount} left` : 'All done'}</span>}
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {s.started &&
            s.bots.map((b) => (
              <CheckRow key={b.name} done={b.have} detail={b.have ? 'Your private copy.' : 'Not made yet.'}>
                {b.id ? (
                  <Link to="/app/bots/$botId" params={{ botId: b.id }} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                ) : (
                  <span className="font-medium">{b.name}</span>
                )}
              </CheckRow>
            ))}
          {s.started &&
            s.flows.map((f) => (
              <CheckRow key={f.name} done={f.have} detail={f.have ? 'Your copy, running as you.' : 'Not made yet.'}>
                <Link to={spaceHref(f.path) as never} className="inline-flex items-center gap-1.5 font-mono text-[12.5px] hover:underline">
                  <Workflow className="size-3.5 text-ink-3" /> {f.path}
                </Link>
              </CheckRow>
            ))}
          {s.started && s.unfilled.length > 0 && (
            <CheckRow done={false} detail={t.fields.filter((f) => s.unfilled.includes(f.name)).map((f) => `${f.name}: ${f.about}`).join(' · ')}>
              Fill in {s.unfilled.map((k) => `{{${k}}}`).join(', ')} in your copy
            </CheckRow>
          )}
          {s.connections.map((c) => (
            <CheckRow key={c.slug} done={c.state === 'ready'} detail={c.detail}>
              <Link to="/app/connections" className="hover:underline">
                {c.name}
              </Link>{' '}
              connection
            </CheckRow>
          ))}
          {s.secrets.map((x) => (
            <CheckRow key={x.name} done={x.state === 'ready'} detail={`${x.about} ${x.state === 'ready' ? x.detail : ''}`.trim()}>
              Secret{' '}
              <Link to="/app/settings" className="font-mono text-[12.5px] hover:underline">
                {x.name}
              </Link>
            </CheckRow>
          ))}
          {s.docs.map((d) => (
            <CheckRow key={d.path} done={d.state === 'ready'} detail={d.about}>
              {d.state === 'ready' ? (
                <Link to={spaceHref(d.path) as never} className="font-mono text-[12.5px] hover:underline">
                  {d.path}
                </Link>
              ) : (
                <span className="font-mono text-[12.5px]">{d.path}</span>
              )}
            </CheckRow>
          ))}
          {s.triggers.map((tr) => (
            <CheckRow
              key={`${tr.flow}-${tr.kind}`}
              done={tr.state === 'ready'}
              detail={tr.state === 'ready' ? 'Set, running as you.' : 'Add it from the flow\'s page once its secrets are in.'}
            >
              {tr.kind === 'schedule' ? `Schedule (${tr.cron})` : 'Webhook'} on <span className="font-mono text-[12.5px]">{tr.flow}</span>
            </CheckRow>
          ))}
          {!s.started && !s.connections.length && !s.secrets.length && !s.docs.length && !s.triggers.length && (
            <li className="px-4 py-3 text-[13.5px] text-ink-3">Nothing beyond the template itself.</li>
          )}
        </ul>
        {t.canUse && (
          <div className="mt-3 text-[13.5px] text-ink-2">
            {s.started ? 'Your agent can finish the rest with you:' : 'Or have your agent set it up, fields and all:'}
            <CopyField value={t.ask} mono={false} className="mt-1.5" />
          </div>
        )}
      </section>

      {t.guide && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Setup guide</h2>
          <div className="rounded-lg border border-line px-2">
            <MarkdownEditor markdown={t.guide} editable={false} onChange={() => {}} />
          </div>
        </section>
      )}

      <UseTemplateDialog open={useOpen} onClose={() => setUseOpen(false)} template={t} userName={t.you} />
    </div>
  )
}
