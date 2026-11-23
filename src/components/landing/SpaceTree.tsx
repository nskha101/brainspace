import { useEffect, useState, type ReactNode } from 'react'
import { AppWindow, Bot, Database, FileText, Folder, Plug, Sparkles, Users, Workflow } from 'lucide-react'
import { cn } from '../../lib/utils'

type Leaf = { name: string; kind: string; icon: ReactNode; section: string }
type Branch = { folder: string; leaf: Leaf }

const TEAM: Branch[] = [
  { folder: 'brand', leaf: { name: 'voice.md', kind: 'doc', icon: <FileText />, section: 'docs' } },
  { folder: 'skills', leaf: { name: 'brand-voice', kind: 'skill', icon: <Sparkles />, section: 'skills' } },
  { folder: 'flows', leaf: { name: 'weekly-pipeline', kind: 'flow', icon: <Workflow />, section: 'flows' } },
  { folder: 'sales', leaf: { name: 'pipeline.db', kind: 'database', icon: <Database />, section: 'data' } },
  { folder: 'artifacts', leaf: { name: 'pipeline', kind: 'artifact', icon: <AppWindow />, section: 'data' } },
]

const MINE: Branch[] = [{ folder: 'drafts', leaf: { name: 'launch-email.md', kind: 'draft', icon: <FileText />, section: 'private' } }]

const PAGES = [
  { name: 'Connections', icon: <Plug />, section: 'connections' },
  { name: 'Agents', icon: <Bot />, section: 'connect' },
  { name: 'Members', icon: <Users />, section: 'roles' },
]

export const SECTIONS = ['docs', 'skills', 'flows', 'data', 'private', 'connections', 'connect', 'roles']

/** Which section sits in the upper part of the window, for the tree to mark. */
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id)
      },
      // A thin band a third of the way down: whichever section crosses it is the one being read.
      { rootMargin: '-35% 0px -64% 0px' },
    )
    for (const el of els) io.observe(el)
    return () => io.disconnect()
  }, [ids])
  return active
}

const row = 'flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] [&>svg]:size-4 [&>svg]:shrink-0'
const on = 'bg-sheet font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]'
const off = 'text-ink-2 hover:bg-wash hover:text-ink'

/**
 * The homepage's side navigation, drawn as the app's own sidebar: a team space, a personal space and
 * the pages below them. Each entry is the thing its section demonstrates.
 */
export function SpaceTree({ active }: { active: string }) {
  return (
    <nav aria-label="What's in a workspace" className="space-y-4">
      <Space label="Team space" root="/team" branches={TEAM} active={active} />
      <Space label="Personal space" root="/me" branches={MINE} active={active} />
      <ul className="space-y-0.5">
        {PAGES.map((p) => (
          <li key={p.section}>
            <a href={`#${p.section}`} aria-current={active === p.section ? 'true' : undefined} className={cn(row, active === p.section ? on : off)}>
              {p.icon}
              {p.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Space({ label, root, branches, active }: { label: string; root: string; branches: Branch[]; active: string }) {
  return (
    <div>
      <div className="flex h-7 items-center gap-2 px-2 text-[13.5px] font-medium text-ink">
        <span className={cn('size-2 rounded-sm', root === '/team' ? 'bg-brand' : 'bg-ink-3')} />
        {label}
        <span className="ml-auto font-mono text-[11px] font-normal text-ink-3">{root}</span>
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {branches.map(({ folder, leaf }) => (
          <li key={folder}>
            <div className={cn(row, 'text-ink-3')}>
              <Folder />
              {folder}
            </div>
            <a
              href={`#${leaf.section}`}
              aria-current={active === leaf.section ? 'true' : undefined}
              className={cn(row, 'ml-4', active === leaf.section ? on : off)}
            >
              {leaf.icon}
              <span className="truncate">{leaf.name}</span>
              <span className="ml-auto pl-1 text-[11px] font-normal text-ink-3">{leaf.kind}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
