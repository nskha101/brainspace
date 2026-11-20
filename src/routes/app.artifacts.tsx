import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Lock, Plus } from 'lucide-react'
import { artifactsFn, writeFn } from '../lib/api'
import { PathDialog } from '../components/FileDialogs'
import { Button, Empty, PageHeader } from '../components/ui'
import { spaceHref, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/artifacts')({
  loader: () => artifactsFn(),
  component: ArtifactsPage,
})

const starter = (title: string) => `<!doctype html>
<title>${title}</title>
<style>
  body { margin: 0; padding: 32px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  p { color: var(--brain-ink-2); margin: 0 0 20px; max-width: 60ch; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--brain-line); }
  th { color: var(--brain-ink-3); font-weight: 500; }
</style>

<h1>${title}</h1>
<p>Hello, <span id="who"></span>. This page is yours to change: open Code, or ask your agent to build it out.</p>
<table id="rows"></table>

<script>
  document.getElementById('who').textContent = brain.user.name

  // To show live data, put a database next to this page and read it here.
  // The page redraws whenever a flow, an agent or a person changes the data.
  //
  // async function load() {
  //   const rows = await brain.db.query('data.db', 'SELECT * FROM items ORDER BY rowid DESC LIMIT 100')
  //   const table = document.getElementById('rows')
  //   table.replaceChildren()
  //   const head = table.insertRow()
  //   for (const c of Object.keys(rows[0] ?? {})) head.appendChild(Object.assign(document.createElement('th'), { textContent: c }))
  //   for (const r of rows) {
  //     const tr = table.insertRow()
  //     for (const v of Object.values(r)) tr.insertCell().textContent = v ?? ''
  //   }
  // }
  // load()
  // brain.onChange(load)
</script>
`

function ArtifactsPage() {
  const artifacts = Route.useLoaderData()
  const { me } = Route.useRouteContext() as { me: { current: { role: string } } }
  const navigate = useNavigate()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const canWrite = me.current.role !== 'viewer'
  const team = artifacts.filter((a) => a.space === 'team')
  const mine = artifacts.filter((a) => a.space === 'me')

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Artifacts"
        description="Pages your agents build: dashboards, trackers and small tools. Each one is an .html doc that runs here and can read and update the databases next to it. Flows and agents keep them current."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New artifact
            </Button>
          )
        }
      />
      {[
        { label: 'Team artifacts', list: team, hint: 'Everyone in the workspace can open these.' },
        { label: 'Your private artifacts', list: mine, hint: 'Only you see these. Promote one to share it with the team.' },
      ].map((group) => (
        <section key={group.label} className="mt-6">
          <h2 className="text-sm font-semibold">{group.label}</h2>
          <p className="mb-3 text-[13px] text-ink-3">{group.hint}</p>
          {group.list.length === 0 ? (
            <Empty title="None yet">Ask your agent for one, like "build me a dashboard of open deals in Brainspace".</Empty>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {group.list.map((a) => (
                <li key={a.id}>
                  <Link to={spaceHref(a.path) as never} className="block px-4 py-3.5 hover:bg-paper">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.title}</span>
                      {a.restricted && <Lock className="size-3.5 text-brand-ink" aria-label="Restricted" />}
                      <span className="ml-auto text-[12px] text-ink-3">
                        v{a.version}, {timeAgo(a.updatedAt)}
                        {a.updatedByName ? ` by ${a.updatedByName}` : ''}
                      </span>
                    </div>
                    {a.description && <p className="mt-1 text-[13.5px] text-ink-2">{a.description}</p>}
                    <p className="mt-1 font-mono text-[12px] text-ink-3">{a.path}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <PathDialog
        open={open}
        onClose={() => setOpen(false)}
        title="New artifact"
        label="Name"
        initial=""
        confirm="Create artifact"
        hint="It starts in your personal space, in its own folder, so you can try it before promoting."
        onSubmit={async (name) => {
          const slug = name.toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (!slug) return
          const path = `/me/artifacts/${slug}/index.html`
          try {
            await writeFn({ data: { path, createOnly: true, message: 'New artifact', content: starter(name.trim().replace(/[<>&]/g, '')) } })
            await router.invalidate()
            navigate({ to: spaceHref(path) as never })
          } catch (e) {
            toast.error(errMessage(e))
            throw e
          }
        }}
      />
    </div>
  )
}
