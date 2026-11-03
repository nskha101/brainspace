import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Compass,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Image as ImageIcon,
  LogOut,
  Menu as MenuIcon,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { folderTreeFn, switchWorkspaceFn } from '../lib/api'
import { clearMeCache, getMeCached } from '../lib/me'
import { useLiveUpdates } from '../lib/live'
import { authClient } from '../lib/auth-client'
import { LogoMark } from '../components/Logo'
import { Avatar, Menu, MenuItem } from '../components/ui'
import { ROLE_LABEL, cn, driveHref } from '../lib/utils'

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    const me = await getMeCached()
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } as never })
    if (!me.current) throw redirect({ to: '/onboarding' })
    // New members land on the welcome flow, but deep links still work mid-setup.
    if (!me.current.onboarded && /^\/app\/?$/.test(location.pathname)) throw redirect({ to: '/welcome' })
    return { me }
  },
  loader: async () => {
    const [team, mine] = await Promise.all([folderTreeFn({ data: { drive: 'team' } }), folderTreeFn({ data: { drive: 'me' } })])
    return { team, mine }
  },
  // The sidebar trees don't need refetching on every click. Edits call
  // router.invalidate(), which refreshes them right away regardless.
  staleTime: 30_000,
  component: AppLayout,
})

type TreeEntry = { path: string; kind: 'folder' | 'doc' | 'file'; name: string }
type TreeNode = TreeEntry & { children: TreeNode[] }

function buildTree(entries: TreeEntry[], root: string): TreeNode[] {
  const byParent = new Map<string, TreeNode[]>()
  for (const e of entries) {
    const parent = e.path.slice(0, e.path.lastIndexOf('/')) || root
    const node: TreeNode = { ...e, children: [] }
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent)!.push(node)
  }
  const attach = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      n.children = byParent.get(n.path) ?? []
      n.children.sort(sortNodes)
      attach(n.children)
    }
  }
  const top = (byParent.get(root) ?? []).sort(sortNodes)
  attach(top)
  return top
}

const sortNodes = (a: TreeNode, b: TreeNode) =>
  Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name)

function TreeItem({ node, depth, current }: { node: TreeNode; depth: number; current: string }) {
  const active = current === node.path
  const containsCurrent = current.startsWith(node.path + '/')
  const [open, setOpen] = useState(containsCurrent)
  useEffect(() => {
    if (containsCurrent) setOpen(true)
  }, [containsCurrent])
  const Icon = node.kind === 'folder' ? (open ? FolderOpen : Folder) : node.kind === 'file' ? ImageIcon : FileText
  return (
    <li>
      <div
        className={cn(
          'group flex h-7 items-center rounded-md pr-2 text-[13.5px]',
          active ? 'bg-sheet font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-wash hover:text-ink',
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {node.kind === 'folder' ? (
          <button onClick={() => setOpen((o) => !o)} className="grid size-4 shrink-0 place-items-center text-ink-3" aria-label={open ? 'Collapse' : 'Expand'}>
            {node.children.length ? open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" /> : null}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <Link to={driveHref(node.path) as never} className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon className={cn('size-3.5 shrink-0', node.kind === 'folder' ? 'text-ink-3' : 'text-ink-3')} />
          <span className="truncate">{node.name}</span>
        </Link>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.path} node={c} depth={depth + 1} current={current} />
          ))}
        </ul>
      )}
    </li>
  )
}

function DriveSection({ label, root, entries, current }: { label: string; root: string; entries: TreeEntry[]; current: string }) {
  const tree = useMemo(() => buildTree(entries, root), [entries, root])
  const active = current === root
  return (
    <div>
      <Link
        to={driveHref(root) as never}
        className={cn(
          'flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] font-medium',
          active ? 'bg-sheet text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink hover:bg-wash',
        )}
      >
        <span className={cn('size-2 rounded-sm', root === '/team' ? 'bg-brand' : 'bg-ink-3')} />
        {label}
        <span className="ml-auto font-mono text-[11px] font-normal text-ink-3">{root}</span>
      </Link>
      <ul className="mt-0.5">
        {tree.map((n) => (
          <TreeItem key={n.path} node={n} depth={0} current={current} />
        ))}
      </ul>
    </div>
  )
}

function NavLink({ to, icon, children, exact }: { to: string; icon: React.ReactNode; children: React.ReactNode; exact?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = exact ? pathname === to : pathname.startsWith(to)
  return (
    <Link
      to={to as never}
      className={cn(
        'flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] [&>svg]:size-4',
        active ? 'bg-sheet font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-wash hover:text-ink',
      )}
    >
      {icon}
      {children}
    </Link>
  )
}

function AppLayout() {
  const { me } = Route.useRouteContext()
  const { team, mine } = Route.useLoaderData()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = decodeURIComponent(pathname.replace(/^\/app\/drive/, '')) || ''
  const [mobileOpen, setMobileOpen] = useState(false)
  useLiveUpdates(me.current!.id)

  useEffect(() => setMobileOpen(false), [pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        router.navigate({ to: '/app/search' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  async function switchTo(id: string) {
    await switchWorkspaceFn({ data: { id } })
    clearMeCache()
    await router.invalidate()
    router.navigate({ to: '/app' })
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-paper">
      <div className="px-3 pt-3">
        <Menu
          align="left"
          trigger={
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-wash">
              <LogoMark size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{me.current!.name}</span>
                <span className="block text-[11.5px] text-ink-3">{ROLE_LABEL[me.current!.role]}</span>
              </span>
              <ChevronDown className="size-3.5 text-ink-3" />
            </button>
          }
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[12px] text-ink-3">Workspaces</div>
          {me.workspaces.map((w) => (
            <MenuItem key={w.id} onClick={() => w.id !== me.current!.id && switchTo(w.id)}>
              <span className={cn('flex-1', w.id === me.current!.id && 'font-medium')}>{w.name}</span>
              <span className="text-[11.5px] text-ink-3">{ROLE_LABEL[w.role]}</span>
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Plus />} onClick={() => router.navigate({ to: '/onboarding' })}>
            New workspace
          </MenuItem>
          <MenuItem icon={<Settings />} onClick={() => router.navigate({ to: '/app/settings' })}>
            Workspace settings
          </MenuItem>
        </Menu>
        <Link
          to="/app/search"
          className="mt-2 flex h-8 items-center gap-2 rounded-md border border-line bg-sheet px-2.5 text-[13px] text-ink-3 hover:border-line-2"
        >
          <Search className="size-3.5" />
          Search the brain
          <kbd className="ml-auto font-mono text-[11px]">⌘K</kbd>
        </Link>
      </div>

      <nav className="mt-3 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">
          <NavLink to="/app" exact icon={<Home />}>
            Home
          </NavLink>
          <NavLink to="/app/skills" icon={<Sparkles />}>
            Skills
          </NavLink>
          <NavLink to="/app/activity" icon={<Activity />}>
            Activity
          </NavLink>
        </div>
        <DriveSection label="Team drive" root="/team" entries={team} current={current} />
        <DriveSection label="My drive" root="/me" entries={mine} current={current} />
        <div className="space-y-0.5">
          <NavLink to="/app/connections" icon={<Plug />}>
            Connections
          </NavLink>
          <NavLink to="/app/agents" icon={<Bot />}>
            Agents
          </NavLink>
          <NavLink to="/app/members" icon={<Users />}>
            Members
          </NavLink>
          <NavLink to="/app/trash" icon={<Trash2 />}>
            Trash
          </NavLink>
        </div>
      </nav>

      <div className="border-t border-line p-3">
        <Link
          to="/welcome"
          className="mb-1 flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] text-ink-2 hover:bg-wash hover:text-ink [&>svg]:size-4"
        >
          <Compass />
          Setup guide
        </Link>
        <Menu
          align="left"
          trigger={
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-wash">
              <Avatar name={me.user.name} image={me.user.image} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{me.user.email}</span>
            </button>
          }
        >
          <MenuItem
            icon={<LogOut />}
            onClick={async () => {
              await authClient.signOut()
              window.location.href = '/'
            }}
          >
            Sign out
          </MenuItem>
        </Menu>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded p-1.5 hover:bg-wash" aria-label="Open navigation">
            <MenuIcon className="size-5" />
          </button>
          <LogoMark size={20} />
          <span className="font-semibold">{me.current!.name}</span>
        </div>
        <main className="relative min-h-0 flex-1 overflow-y-auto bg-sheet">
          <NavProgress />
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** A thin bar at the top of the page while the next page's data loads. */
function NavProgress() {
  const pending = useRouterState({ select: (s) => s.status === 'pending' })
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!pending) return setVisible(false)
    const t = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(t)
  }, [pending])
  if (!visible) return null
  return (
    <div className="sticky top-0 z-30 -mb-0.5 h-0.5 overflow-hidden" role="progressbar" aria-label="Loading page">
      <div className="nav-progress h-full w-1/3 bg-brand" />
    </div>
  )
}
