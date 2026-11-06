import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { skillsFn, writeFn } from '../lib/api'
import { PathDialog } from '../components/FileDialogs'
import { Badge, Button, Empty, PageHeader } from '../components/ui'
import { spaceHref, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/skills')({
  loader: () => skillsFn(),
  component: SkillsPage,
})

function SkillsPage() {
  const skills = Route.useLoaderData()
  const { me } = Route.useRouteContext() as { me: { current: { role: string } } }
  const navigate = useNavigate()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const canWrite = me.current.role !== 'viewer'
  const team = skills.filter((s) => s.space === 'team')
  const mine = skills.filter((s) => s.space === 'me')

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Skills"
        description="Playbooks that teach agents how this team does a job. Each one is a SKILL.md in /team/skills or /me/skills. Agents list them with skills_list and load them with skill_get."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New skill
            </Button>
          )
        }
      />
      {[
        { label: 'Team skills', list: team, hint: 'Everyone’s agents can use these.' },
        { label: 'Your private skills', list: mine, hint: 'Only your agents see these. A private skill overrides a team skill with the same name.' },
      ].map((group) => (
        <section key={group.label} className="mt-6">
          <h2 className="text-sm font-semibold">{group.label}</h2>
          <p className="mb-3 text-[13px] text-ink-3">{group.hint}</p>
          {group.list.length === 0 ? (
            <Empty title="None yet" />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {group.list.map((s) => (
                <li key={s.path}>
                  <Link to={spaceHref(s.path) as never} className="block px-4 py-3.5 hover:bg-paper">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {s.files.length > 0 && <Badge>{s.files.length + 1} files</Badge>}
                      <span className="ml-auto text-[12px] text-ink-3">
                        v{s.version}, {timeAgo(s.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13.5px] text-ink-2">{s.description || <span className="text-ink-3">No description in frontmatter</span>}</p>
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
        title="New skill"
        label="Skill name"
        initial=""
        confirm="Create skill"
        hint="Lowercase with hyphens, like weekly-metrics-report. It starts in your personal space so you can try it before promoting."
        onSubmit={async (name) => {
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (!slug) return
          const path = `/me/skills/${slug}/SKILL.md`
          try {
            await writeFn({
              data: {
                path,
                createOnly: true,
                message: 'New skill',
                content: `---\nname: ${slug}\ndescription: Use when ...\n---\n\n# ${slug}\n\n1. \n`,
              },
            })
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
