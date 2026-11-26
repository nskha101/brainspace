import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  FolderInput,
  KeyRound,
  MoreHorizontal,
  PenLine,
  Play,
  Plus,
  Rows3,
  Search,
  SquareTerminal,
  Table2,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import {
  copyFn,
  dbAddColumnFn,
  dbAddRowFn,
  dbCreateTableFn,
  dbDeleteRowsFn,
  dbDropTableFn,
  dbInsertRowsFn,
  dbRunFn,
  dbUpdateCellFn,
  describeFn,
  moveFn,
  trashFn,
  type resolvePathFn,
} from '../lib/api'
import { csvColumns, csvRows, parseCsv, type CsvColumn } from '../lib/csv'
import { bytes, cn, errMessage, spaceHref } from '../lib/utils'
import { ShareButton, ShareDialog, whoSees } from './Share'
import { ConfirmDialog, PathDialog, TextDialog } from './FileDialogs'
import { AccessLine, NodeStats, PathCrumbs } from './PathHeader'
import { Button, CopyField, Field, Input, Menu, MenuItem, Modal, Select, Textarea } from './ui'

type DbData = Extract<Awaited<ReturnType<typeof resolvePathFn>>, { type: 'database' }>
type TableInfo = DbData['db']['tables'][number]
type Cell = string | number | null
type ColumnType = 'TEXT' | 'INTEGER' | 'REAL'

/** What the page is showing, kept in the URL so a refresh or a live update lands on the same view. */
export type DbSearch = { t?: string; q?: string; s?: string; d?: boolean; p?: number; tab?: 'columns' | 'sql' }

const TYPE_LABEL: Record<ColumnType, string> = { TEXT: 'Text', INTEGER: 'Whole number', REAL: 'Decimal' }

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

const isNumeric = (type: string) => /INT|REAL|FLOA|DOUB|NUM|DEC/i.test(type)

async function attempt<T>(fn: () => Promise<T>, ok?: string) {
  try {
    const r = await fn()
    if (ok) toast.success(ok)
    return r
  } catch (e) {
    toast.error(errMessage(e))
    throw e
  }
}

export function DatabaseView({ data, search, setSearch }: { data: DbData; search: DbSearch; setSearch: (patch: Partial<DbSearch>, replace?: boolean) => void }) {
  const router = useRouter()
  const navigate = useNavigate()
  const refresh = () => router.invalidate()
  const { db } = data
  const f = db.node
  const canWrite = data.role !== 'viewer'
  const isTeam = f.path.startsWith('/team')
  const canDelete = isTeam ? data.role === 'admin' : canWrite
  const parent = f.path.slice(0, f.path.lastIndexOf('/'))
  const current = db.tables.find((t) => t.name === db.table)
  const tab = search.tab ?? 'rows'
  const totalRows = db.tables.reduce((n, t) => n + (t.kind === 'view' ? 0 : (t.rows ?? 0)), 0)
  const [dialog, setDialog] = useState<null | 'rename' | 'move' | 'copy' | 'delete' | 'describe' | 'share' | 'table' | 'import'>(null)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <PathCrumbs path={f.path} />
          {f.description ? (
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{f.description}</p>
          ) : (
            canWrite && (
              <button onClick={() => setDialog('describe')} className="mt-1.5 text-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                Say what this data is, so agents know when to use it
              </button>
            )
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-3">
            <Database className="size-3.5" />
            <span>
              Database, {count(db.tables.length, 'table')}, {count(totalRows, 'row')}, {bytes(db.sizeBytes)}
            </span>
            <span aria-hidden>·</span>
            <NodeStats node={f} people={data.people} />
          </p>
          <AccessLine access={data.access} path={f.path} userId={data.userId} onManage={canWrite ? () => setDialog('share') : undefined} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {canWrite && <ShareButton who={whoSees(f.path, data.access)} onClick={() => setDialog('share')} />}
          {canWrite && (
            <>
              <Button size="sm" onClick={() => setDialog('import')}>
                <Upload className="size-3.5" /> Import CSV
              </Button>
              <Button size="sm" variant="primary" onClick={() => setDialog('table')}>
                <Plus className="size-3.5" /> New table
              </Button>
            </>
          )}
          {canWrite && (
            <Menu
              trigger={
                <Button size="sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            >
              <MenuItem icon={<PenLine />} onClick={() => setDialog('rename')}>
                Rename
              </MenuItem>
              <MenuItem icon={<FolderInput />} onClick={() => setDialog('move')}>
                Move
              </MenuItem>
              <MenuItem icon={<Copy />} onClick={() => setDialog('copy')}>
                Copy
              </MenuItem>
              <MenuItem icon={<FileText />} onClick={() => setDialog('describe')}>
                Describe
              </MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Trash2 />} danger disabled={!canDelete} onClick={() => setDialog('delete')}>
                {canDelete ? 'Delete' : 'Delete (admins only)'}
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>

      {db.tables.length === 0 ? (
        <EmptyDatabase path={f.path} canWrite={canWrite} onNewTable={() => setDialog('table')} onImport={() => setDialog('import')} />
      ) : (
        <div className="mt-7 gap-6 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)]">
          <TableRail tables={db.tables} current={db.table} onPick={(t) => setSearch({ t, q: undefined, s: undefined, d: undefined, p: undefined })} />
          <div className="mt-4 min-w-0 lg:mt-0">
            <div className="flex items-center gap-1 border-b border-line">
              <TabButton active={tab === 'rows'} onClick={() => setSearch({ tab: undefined })} icon={<Rows3 />}>
                Rows
              </TabButton>
              <TabButton active={tab === 'columns'} onClick={() => setSearch({ tab: 'columns' })} icon={<Columns3 />}>
                Columns
              </TabButton>
              <TabButton active={tab === 'sql'} onClick={() => setSearch({ tab: 'sql' })} icon={<SquareTerminal />}>
                SQL
              </TabButton>
            </div>
            {/* The SQL box stays mounted so what you typed survives a look at the rows. */}
            <div className={tab === 'sql' ? '' : 'hidden'}>
              <SqlTab path={f.path} table={current?.name ?? null} canWrite={canWrite} onChanged={refresh} />
            </div>
            {tab === 'rows' && current && (
              <RowsTab key={current.name} data={data} table={current} search={search} setSearch={setSearch} canWrite={canWrite} onChanged={refresh} />
            )}
            {tab === 'columns' && current && <ColumnsTab path={f.path} table={current} canWrite={canWrite} onChanged={refresh} onDropped={() => setSearch({ t: undefined, tab: undefined })} />}
          </div>
        </div>
      )}

      {current && <AgentHelp path={f.path} table={current.name} />}

      <NewTableDialog
        open={dialog === 'table'}
        onClose={() => setDialog(null)}
        onCreate={async (table, columns) => {
          await attempt(() => dbCreateTableFn({ data: { path: f.path, table, columns } }), `Created ${table}`)
          setSearch({ t: table, q: undefined, s: undefined, d: undefined, p: undefined, tab: undefined })
          refresh()
        }}
      />
      <ImportCsvDialog
        open={dialog === 'import'}
        onClose={() => setDialog(null)}
        path={f.path}
        tables={db.tables}
        onDone={(table) => {
          setSearch({ t: table, q: undefined, s: undefined, d: undefined, p: undefined, tab: undefined })
          refresh()
        }}
      />
      <PathDialog
        open={dialog === 'rename'}
        onClose={() => setDialog(null)}
        title={`Rename ${f.name}`}
        label="New name"
        initial={f.name}
        confirm="Rename"
        hint="Flows and agents find it by path, so update anything that uses the old name."
        onSubmit={async (name) => {
          const r = await attempt(() => moveFn({ data: { from: f.path, to: `${parent}/${name}` } }), 'Renamed')
          await refresh()
          navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <PathDialog
        open={dialog === 'move'}
        onClose={() => setDialog(null)}
        title={`Move ${f.name}`}
        label="Destination path"
        initial={f.path}
        confirm="Move"
        hint="Start with /team/ or /me/. End with / to move into a folder. Flows and agents find it by path."
        onSubmit={async (to) => {
          const r = await attempt(() => moveFn({ data: { from: f.path, to } }), 'Moved')
          await refresh()
          navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <PathDialog
        open={dialog === 'copy'}
        onClose={() => setDialog(null)}
        title={`Copy ${f.name}`}
        label="Copy to"
        initial={isTeam ? f.path.replace(/^\/team/, '/me') : f.path.replace(/(\.[a-z0-9]+)?$/i, '-copy$1')}
        confirm="Copy"
        hint="Copies every table and row. The copy is separate: changes to one don't reach the other."
        onSubmit={async (to) => {
          const r = await attempt(() => copyFn({ data: { from: f.path, to } }), 'Copied')
          await refresh()
          if (r.node) navigate({ to: spaceHref(r.node.path) as never })
        }}
      />
      <TextDialog
        open={dialog === 'describe'}
        onClose={() => setDialog(null)}
        title={`Describe ${f.name}`}
        initial={f.description ?? ''}
        placeholder="What the data is and what keeps it current. For example: Active customers and how to reach them, synced from HubSpot every hour by the customer-sync flow."
        confirm="Save"
        onSubmit={async (d) => {
          await attempt(() => describeFn({ data: { path: f.path, description: d } }))
          refresh()
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={`Delete ${f.name}?`}
        confirm="Move to trash"
        danger
        onConfirm={async () => {
          await attempt(() => trashFn({ data: { path: f.path } }), 'Moved to trash')
          await navigate({ to: spaceHref(parent) as never })
          refresh()
        }}
      >
        The database goes to the trash with all its rows. Flows and agents that use it will fail until it's restored from Trash.
      </ConfirmDialog>
      {canWrite && (
        <ShareDialog
          path={f.path}
          name={f.name}
          open={dialog === 'share'}
          onClose={() => setDialog(null)}
          onSaved={async (r) => {
            await refresh()
            if (r.moved) navigate({ to: spaceHref(r.path) as never })
          }}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13.5px] [&>svg]:size-3.5',
        active ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function TableRail({ tables, current, onPick }: { tables: TableInfo[]; current: string | null; onPick: (t: string) => void }) {
  return (
    <nav aria-label="Tables" className="min-w-0">
      <div className="mb-1.5 hidden px-2 text-[12px] font-medium text-ink-3 lg:block">Tables</div>
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
        {tables.map((t) => {
          const active = t.name === current
          const Icon = t.kind === 'view' ? Eye : Table2
          return (
            <li key={t.name} className="shrink-0">
              <button
                onClick={() => onPick(t.name)}
                title={t.kind === 'view' ? 'A view: a saved query' : undefined}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px]',
                  active ? 'bg-paper font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-wash hover:text-ink',
                )}
              >
                <Icon className="size-3.5 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{t.name}</span>
                {t.rows !== null && <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{t.rows.toLocaleString()}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Rows

function RowsTab({
  data,
  table,
  search,
  setSearch,
  canWrite,
  onChanged,
}: {
  data: DbData
  table: TableInfo
  search: DbSearch
  setSearch: (patch: Partial<DbSearch>, replace?: boolean) => void
  canWrite: boolean
  onChanged: () => void
}) {
  const { db } = data
  const path = db.node.path
  const editable = canWrite && table.editable
  const page = Math.max(1, search.p ?? 1)
  const pages = Math.max(1, Math.ceil(db.total / data.pageSize))
  const [filter, setFilter] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const types = useMemo(() => new Map(table.columns.map((c) => [c.name, c])), [table.columns])

  // Filter as you type, without a request per keystroke.
  useEffect(() => {
    if (filter === (search.q ?? '')) return
    const t = setTimeout(() => setSearch({ q: filter || undefined, p: undefined }, true), 250)
    return () => clearTimeout(t)
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Selection points at rows by id; drop it when the page of rows changes.
  const rowKey = db.rowids.join(',')
  useEffect(() => setSelected(new Set()), [rowKey])

  const sortBy = (col: string) => {
    if (search.s !== col) setSearch({ s: col, d: undefined, p: undefined })
    else if (!search.d) setSearch({ d: true, p: undefined })
    else setSearch({ s: undefined, d: undefined, p: undefined })
  }

  const from = db.total === 0 ? 0 : (page - 1) * data.pageSize + 1
  const to = Math.min(db.total, page * data.pageSize)
  const allSelected = db.rowids.length > 0 && db.rowids.every((id) => id !== null && selected.has(id))

  return (
    <div className="pt-4">
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2">
        <label className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-line-2 bg-sheet px-2.5 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <Search className="size-3.5 shrink-0 text-ink-3" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${table.name}`}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label="Clear filter">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        {selected.size > 0 ? (
          <>
            <span className="ml-1 text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-wash hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="size-3.5" /> Clear
            </Button>
          </>
        ) : (
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => window.open(`/api/db/${db.node.id}/export?table=${encodeURIComponent(table.name)}`)}>
              <Download className="size-3.5" /> Export CSV
            </Button>
            {canWrite && table.kind === 'table' && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" /> Add row
              </Button>
            )}
          </div>
        )}
      </div>

      {db.error ? (
        <p className="rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger">{db.error}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-paper/70">
                {editable && (
                  <th className="w-9 px-2.5 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      className="size-3.5 accent-[var(--color-brand)]"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(db.rowids.filter((x): x is number => x !== null)) : new Set())}
                    />
                  </th>
                )}
                {db.columns.map((c) => {
                  const col = types.get(c)
                  const active = search.s === c
                  return (
                    <th key={c} className={cn('h-9 px-3 text-left align-middle font-medium whitespace-nowrap', col && isNumeric(col.type) && 'text-right')} aria-sort={active ? (search.d ? 'descending' : 'ascending') : undefined}>
                      <button onClick={() => sortBy(c)} className={cn('inline-flex items-center gap-1.5 hover:text-ink', active ? 'text-ink' : 'text-ink-2')} title={col ? `${c}: ${col.type || 'any type'}` : c}>
                        {col?.primaryKey && <KeyRound className="size-3 text-ink-3" aria-label="Key column" />}
                        <span className="font-mono text-[12.5px]">{c}</span>
                        {col?.type && <span className="text-[11px] font-normal text-ink-3 lowercase">{col.type}</span>}
                        {active ? search.d ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {db.rows.length === 0 ? (
                <tr>
                  <td colSpan={db.columns.length + (editable ? 1 : 0)} className="px-4 py-10 text-center text-ink-2">
                    {search.q ? `No rows match "${search.q}".` : canWrite ? 'No rows yet. Add one here, import a CSV, or have a flow or your agent fill it in.' : 'No rows yet.'}
                  </td>
                </tr>
              ) : (
                db.rows.map((row, i) => {
                  const id = db.rowids[i] ?? null
                  const picked = id !== null && selected.has(id)
                  return (
                    <tr key={id ?? i} className={cn('border-b border-line last:border-0', picked ? 'bg-brand-wash/40' : 'hover:bg-paper/60')}>
                      {editable && (
                        <td className="px-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select row ${i + 1}`}
                            className="size-3.5 accent-[var(--color-brand)]"
                            checked={picked}
                            onChange={(e) => {
                              if (id === null) return
                              setSelected((s) => {
                                const next = new Set(s)
                                if (e.target.checked) next.add(id)
                                else next.delete(id)
                                return next
                              })
                            }}
                          />
                        </td>
                      )}
                      {row.map((v, j) => {
                        const name = db.columns[j]!
                        const col = types.get(name)
                        return (
                          <GridCell
                            key={name}
                            value={v}
                            numeric={!!col && isNumeric(col.type)}
                            editable={editable && id !== null}
                            onSave={async (next) => {
                              await attempt(() => dbUpdateCellFn({ data: { path, table: table.name, rowid: id!, column: name, value: next } }))
                              onChanged()
                            }}
                          />
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-3">
        <span>
          {db.total === 0 ? 'No rows' : `${from.toLocaleString()}-${to.toLocaleString()} of ${count(db.total, 'row')}`}
          {search.q ? ' matching the filter' : ''}
          {editable ? '. Click a cell to edit it.' : table.kind === 'view' ? '. A view shows the result of a saved query, so its rows are changed in the tables behind it.' : canWrite ? '. Rows in this table are changed with SQL.' : ''}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setSearch({ p: page - 1 === 1 ? undefined : page - 1 })} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular-nums">
              Page {page} of {pages.toLocaleString()}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setSearch({ p: page + 1 })} aria-label="Next page">
              <ChevronRight className="size-4" />
            </Button>
          </span>
        )}
      </div>

      <AddRowDialog
        open={adding}
        onClose={() => setAdding(false)}
        table={table}
        onAdd={async (values) => {
          await attempt(() => dbAddRowFn({ data: { path, table: table.name, values } }), 'Row added')
          onChanged()
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${count(selected.size, 'row')}?`}
        confirm="Delete"
        danger
        onConfirm={async () => {
          await attempt(() => dbDeleteRowsFn({ data: { path, table: table.name, rowids: [...selected] } }), `Deleted ${count(selected.size, 'row')}`)
          setSelected(new Set())
          onChanged()
        }}
      >
        Deleted rows can't be brought back. Databases don't keep a version history the way docs do.
      </ConfirmDialog>
    </div>
  )
}

function CellText({ value }: { value: Cell }) {
  if (value === null) return <span className="text-ink-3/70 italic">null</span>
  if (value === '') return <span className="text-ink-3/70 italic">empty</span>
  return <>{String(value)}</>
}

function GridCell({ value, numeric, editable, onSave }: { value: Cell; numeric: boolean; editable: boolean; onSave: (next: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const cancelled = useRef(false)

  async function commit() {
    if (cancelled.current) return
    setEditing(false)
    const before = value === null ? '' : String(value)
    if (draft === before) return
    setSaving(true)
    try {
      await onSave(draft === '' ? null : draft)
    } catch {
      // The toast already says what went wrong; the cell keeps its old value.
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <td className="p-0">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelled.current = true
              setEditing(false)
            }
          }}
          placeholder="null"
          className={cn('h-9 w-full min-w-32 bg-brand-wash/40 px-3 text-[13px] outline-none ring-2 ring-brand ring-inset placeholder:text-ink-3/70 placeholder:italic', numeric && 'text-right tabular-nums')}
        />
      </td>
    )
  }
  const text = value === null ? '' : String(value)
  return (
    <td
      className={cn('h-9 max-w-[22rem] truncate px-3 align-middle', numeric && 'text-right tabular-nums', editable && 'cursor-text', saving && 'opacity-50')}
      title={text.length > 40 ? text : undefined}
      onClick={
        editable
          ? () => {
              cancelled.current = false
              setDraft(text)
              setEditing(true)
            }
          : undefined
      }
    >
      <CellText value={value} />
    </td>
  )
}

function AddRowDialog({ open, onClose, table, onAdd }: { open: boolean; onClose: () => void; table: TableInfo; onAdd: (values: Record<string, string | null>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setValues({})
  }, [open])
  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    try {
      await onAdd(Object.fromEntries(table.columns.map((c) => [c.name, values[c.name] ? values[c.name]! : null])))
      onClose()
    } catch {
      // Keep the form open so the values aren't lost.
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add a row to ${table.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => submit()} loading={busy}>
            Add row
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {table.columns.map((c, i) => {
          const auto = c.primaryKey && /INT/i.test(c.type)
          return (
            <label key={c.name} className="block">
              <span className="mb-1 flex items-baseline gap-2 text-[13px]">
                <span className="font-mono font-medium text-ink">{c.name}</span>
                <span className="text-[12px] text-ink-3 lowercase">{c.type || 'any'}</span>
              </span>
              <Input
                autoFocus={i === 0}
                value={values[c.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
                placeholder={auto ? 'Filled in automatically' : c.default !== null ? `Default: ${c.default}` : c.notNull ? 'Required' : 'Empty'}
                inputMode={isNumeric(c.type) ? 'decimal' : undefined}
              />
            </label>
          )
        })}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Columns

function ColumnsTab({ path, table, canWrite, onChanged, onDropped }: { path: string; table: TableInfo; canWrite: boolean; onChanged: () => void; onDropped: () => void }) {
  const [adding, setAdding] = useState(false)
  const [dropping, setDropping] = useState(false)
  const unique = new Set(table.indexes.filter((i) => i.unique && i.columns.length === 1).map((i) => i.columns[0]))
  const what = table.kind === 'view' ? 'view' : 'table'
  return (
    <div className="pt-4">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-paper/70 text-left text-[12.5px] text-ink-3">
              <th className="h-9 px-3 font-medium">Column</th>
              <th className="px-3 font-medium">Type</th>
              <th className="px-3 font-medium">Rules</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((c) => {
              const fk = table.foreignKeys.find((k) => k.column === c.name)
              const rules = [
                c.primaryKey ? 'Key' : null,
                !c.primaryKey && unique.has(c.name) ? 'Unique' : null,
                c.notNull && !c.primaryKey ? 'Required' : null,
                c.default !== null ? `Default ${c.default}` : null,
                fk ? `Points to ${fk.table}${fk.to ? `.${fk.to}` : ''}` : null,
              ].filter(Boolean)
              return (
                <tr key={c.name} className="border-b border-line last:border-0">
                  <td className="h-9 px-3 font-mono text-[12.5px] font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {c.primaryKey && <KeyRound className="size-3 text-ink-3" />}
                      {c.name}
                    </span>
                  </td>
                  <td className="px-3 text-ink-2 lowercase">{c.type || 'any'}</td>
                  <td className="px-3 text-ink-2">{rules.join(', ') || <span className="text-ink-3">None</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {table.indexes.some((i) => i.columns.length > 1) && (
        <p className="mt-3 text-[13px] text-ink-2">
          {table.indexes
            .filter((i) => i.columns.length > 1)
            .map((i) => `${i.unique ? 'Unique together' : 'Indexed together'}: ${i.columns.join(', ')}`)
            .join('. ')}
          .
        </p>
      )}
      {table.sql && (
        <details className="mt-4 text-[13px]">
          <summary className="cursor-pointer text-ink-2 hover:text-ink">How this {what} was defined</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-paper/60 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink">{table.sql}</pre>
        </details>
      )}
      {canWrite && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {table.kind === 'table' && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add column
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-wash hover:text-danger" onClick={() => setDropping(true)}>
            <Trash2 className="size-3.5" /> Delete {what}
          </Button>
        </div>
      )}
      <AddColumnDialog
        open={adding}
        onClose={() => setAdding(false)}
        table={table.name}
        onAdd={async (column) => {
          await attempt(() => dbAddColumnFn({ data: { path, table: table.name, column } }), `Added ${column.name}`)
          onChanged()
        }}
      />
      <ConfirmDialog
        open={dropping}
        onClose={() => setDropping(false)}
        title={`Delete the ${what} ${table.name}?`}
        confirm={`Delete ${what}`}
        danger
        onConfirm={async () => {
          await attempt(() => dbDropTableFn({ data: { path, table: table.name } }), `Deleted ${table.name}`)
          onDropped()
          onChanged()
        }}
      >
        {table.kind === 'view'
          ? 'The saved query goes away. The tables it reads from are untouched.'
          : `Its ${table.rows === null ? '' : `${count(table.rows, 'row')} `}and columns are removed for good. This can't be undone, and flows or agents that use the table will start failing.`}
      </ConfirmDialog>
    </div>
  )
}

function TypeSelect({ value, onChange }: { value: ColumnType; onChange: (t: ColumnType) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as ColumnType)} aria-label="Column type">
      {(Object.keys(TYPE_LABEL) as ColumnType[]).map((t) => (
        <option key={t} value={t}>
          {TYPE_LABEL[t]}
        </option>
      ))}
    </Select>
  )
}

function AddColumnDialog({ open, onClose, table, onAdd }: { open: boolean; onClose: () => void; table: string; onAdd: (c: { name: string; type: ColumnType }) => Promise<void> }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ColumnType>('TEXT')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setType('TEXT')
    }
  }, [open])
  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onAdd({ name: name.trim(), type })
      onClose()
    } catch {
      // Stay open; the toast has the reason.
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add a column to ${table}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => submit()} loading={busy} disabled={!name.trim()}>
            Add column
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex gap-2">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="column_name" className="font-mono text-[13px]" />
        <TypeSelect value={type} onChange={setType} />
      </form>
      <p className="mt-2 text-xs text-ink-3">Existing rows get an empty value in the new column.</p>
    </Modal>
  )
}

type DraftColumn = { name: string; type: ColumnType; primaryKey: boolean }

function NewTableDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (table: string, columns: DraftColumn[]) => Promise<void> }) {
  const start = (): DraftColumn[] => [
    { name: 'id', type: 'INTEGER', primaryKey: true },
    { name: 'name', type: 'TEXT', primaryKey: false },
  ]
  const [table, setTable] = useState('')
  const [columns, setColumns] = useState<DraftColumn[]>(start)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setTable('')
      setColumns(start())
    }
  }, [open])
  const set = (i: number, patch: Partial<DraftColumn>) => setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : patch.primaryKey ? { ...c, primaryKey: false } : c)))
  const named = columns.filter((c) => c.name.trim())
  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!table.trim() || !named.length) return
    setBusy(true)
    try {
      await onCreate(
        table.trim(),
        named.map((c) => ({ ...c, name: c.name.trim() })),
      )
      onClose()
    } catch {
      // Stay open; the toast has the reason.
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New table"
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => submit()} loading={busy} disabled={!table.trim() || !named.length}>
            Create table
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Table name">
          <Input autoFocus value={table} onChange={(e) => setTable(e.target.value)} placeholder="customers" className="font-mono text-[13px]" />
        </Field>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink-2">
            <span>Columns</span>
            <span className="text-xs font-normal text-ink-3">Key: the column that tells rows apart</span>
          </div>
          <div className="space-y-2">
            {columns.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={c.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="column_name" className="font-mono text-[13px]" aria-label={`Column ${i + 1} name`} />
                <TypeSelect value={c.type} onChange={(type) => set(i, { type })} />
                <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-2">
                  <input type="radio" name="key" className="accent-[var(--color-brand)]" checked={c.primaryKey} onChange={() => set(i, { primaryKey: true })} />
                  Key
                </label>
                <button type="button" onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))} disabled={columns.length === 1} className="rounded p-1 text-ink-3 hover:bg-wash hover:text-ink disabled:opacity-30" aria-label={`Remove column ${i + 1}`}>
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setColumns((cs) => [...cs, { name: '', type: 'TEXT', primaryKey: false }])}>
            <Plus className="size-3.5" /> Add column
          </Button>
        </div>
        <p className="text-xs text-ink-3">
          A whole-number key fills itself in. A key lets flows and agents update a row instead of adding it twice. Dates and JSON are stored as text.
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// CSV import

type Parsed = { fileName: string; columns: CsvColumn[]; body: string[][] }

function ImportCsvDialog({ open, onClose, path, tables, onDone }: { open: boolean; onClose: () => void; path: string; tables: TableInfo[]; onDone: (table: string) => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [target, setTarget] = useState('')
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const real = tables.filter((t) => t.kind === 'table')
  useEffect(() => {
    if (open) {
      setParsed(null)
      setTarget('')
      setName('')
      setProgress(null)
    }
  }, [open])

  async function pick(file: File) {
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      toast.error('That file needs a header row and at least one row of data.')
      return
    }
    const [header, ...body] = rows
    setParsed({ fileName: file.name, columns: csvColumns(header!, body), body })
    setName(
      file.name
        .replace(/\.[a-z0-9]+$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'imported',
    )
  }

  const existing = real.find((t) => t.name === target)
  const unknown = parsed && existing ? parsed.columns.filter((c) => !existing.columns.some((x) => x.name === c.name)).map((c) => c.name) : []

  async function run() {
    if (!parsed) return
    const table = existing ? existing.name : name.trim()
    if (!table) return
    const rows = csvRows(parsed.columns, parsed.body)
    setProgress({ done: 0, total: rows.length })
    try {
      if (!existing) await dbCreateTableFn({ data: { path, table, columns: parsed.columns } })
      for (let i = 0; i < rows.length; i += 500) {
        await dbInsertRowsFn({ data: { path, table, rows: rows.slice(i, i + 500) } })
        setProgress({ done: Math.min(rows.length, i + 500), total: rows.length })
      }
      toast.success(`Imported ${count(rows.length, 'row')} into ${table}`)
      onDone(table)
      onClose()
    } catch (e) {
      toast.error(errMessage(e))
      onDone(table)
    } finally {
      setProgress(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import a CSV"
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} loading={!!progress} disabled={!parsed || (!existing && !name.trim()) || unknown.length > 0}>
            {progress ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : parsed ? `Import ${count(parsed.body.length, 'row')}` : 'Import'}
          </Button>
        </>
      }
    >
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      {!parsed ? (
        <button
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center rounded-lg border border-dashed border-line-2 px-6 py-10 text-center hover:border-ink-3 hover:bg-paper/60"
        >
          <Upload className="size-5 text-ink-3" />
          <span className="mt-2 font-medium">Choose a CSV file</span>
          <span className="mt-1 text-sm text-ink-2">The first row is used as the column names.</span>
        </button>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            {real.length > 0 && (
              <Field label="Import into">
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">A new table</option>
                  {real.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!existing && (
              <div className="min-w-48 flex-1">
                <Field label="Table name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-[13px]" />
                </Field>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
              Choose another file
            </Button>
          </div>
          {unknown.length > 0 && (
            <p className="rounded-lg bg-danger-wash px-3 py-2 text-sm text-danger">
              {existing!.name} has no column named {unknown.join(', ')}. Add {unknown.length === 1 ? 'it' : 'them'} first, rename the CSV header, or import into a new table.
            </p>
          )}
          <div>
            <div className="mb-1.5 text-[13px] text-ink-2">
              {parsed.fileName}: {count(parsed.body.length, 'row')}, {count(parsed.columns.length, 'column')}. The first rows:
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-line">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-paper/70 text-left">
                    {parsed.columns.map((c) => (
                      <th key={c.name} className="h-8 px-2.5 font-medium whitespace-nowrap">
                        <span className="font-mono">{c.name}</span> {!existing && <span className="text-[11px] font-normal text-ink-3">{TYPE_LABEL[c.type].toLowerCase()}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.body.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {parsed.columns.map((c, j) => (
                        <td key={c.name} className="h-8 max-w-48 truncate px-2.5">
                          {r[j] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// SQL

type ConsoleResult = Awaited<ReturnType<typeof dbRunFn>>

function SqlTab({ path, table, canWrite, onChanged }: { path: string; table: string | null; canWrite: boolean; onChanged: () => void }) {
  const [sql, setSql] = useState(() => (table ? `SELECT * FROM "${table}" LIMIT 100` : ''))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!sql.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await dbRunFn({ data: { path, sql } })
      setResult(r)
      if (r.changes > 0 || r.columns.length === 0) onChanged()
    } catch (e) {
      setResult(null)
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-4">
      <Textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            run()
          }
        }}
        rows={5}
        spellCheck={false}
        placeholder={'SELECT plan, count(*) AS customers FROM customers GROUP BY plan'}
        className="font-mono text-[13px] leading-relaxed"
        aria-label="SQL"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-3">
          {canWrite
            ? 'SQLite. Statements that change data run as one transaction and can’t be undone.'
            : 'SQLite. Your role is read-only, so only SELECT statements run.'}
        </span>
        <Button size="sm" variant="primary" onClick={run} loading={busy} disabled={!sql.trim()}>
          <Play className="size-3.5" /> Run <kbd className="ml-1 font-mono text-[11px] opacity-70">⌘↵</kbd>
        </Button>
      </div>
      {error && <p className="mt-4 rounded-lg bg-danger-wash px-4 py-3 text-sm whitespace-pre-wrap text-danger">{error}</p>}
      {result && (
        <div className="mt-4">
          {result.columns.length > 0 ? (
            <>
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0">
                    <tr className="border-b border-line bg-paper text-left">
                      {result.columns.map((c, i) => (
                        <th key={i} className="h-9 px-3 font-mono text-[12.5px] font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-b border-line last:border-0 hover:bg-paper/60">
                        {row.map((v, j) => (
                          <td key={j} className={cn('h-9 max-w-[22rem] truncate px-3', typeof v === 'number' && 'tabular-nums')} title={typeof v === 'string' && v.length > 40 ? v : undefined}>
                            <CellText value={v} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[13px] text-ink-3">
                {count(result.rows.length, 'row')}
                {result.truncated ? '. There are more: narrow it down or add LIMIT and OFFSET.' : ''}
                {result.changes > 0 ? `. ${count(result.changes, 'row')} changed.` : ''}
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-line bg-paper/60 px-4 py-3 text-sm text-ink-2">
              Done. {result.changes > 0 ? `${count(result.changes, 'row')} changed.` : 'No rows changed.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state and agent help

function EmptyDatabase({ path, canWrite, onNewTable, onImport }: { path: string; canWrite: boolean; onNewTable: () => void; onImport: () => void }) {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-line-2 px-6 py-12 text-center">
      <Database className="mx-auto size-6 text-ink-3" />
      <p className="mt-3 font-medium">No tables yet</p>
      {canWrite ? (
        <>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">Make a table here, bring one in from a CSV, or tell your agent what you want to keep track of and let it set the tables up.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={onNewTable}>
              <Plus className="size-4" /> New table
            </Button>
            <Button onClick={onImport}>
              <Upload className="size-4" /> Import CSV
            </Button>
          </div>
          <div className="mx-auto mt-6 max-w-xl text-left">
            <div className="mb-1.5 text-[12.5px] text-ink-3">Or paste this to your agent and finish the sentence:</div>
            <CopyField mono={false} value={`In Brainspace, set up the database ${path} to keep track of `} />
          </div>
        </>
      ) : (
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">Nothing has been added to this database yet.</p>
      )}
    </div>
  )
}

function AgentHelp({ path, table: t }: { path: string; table: string }) {
  return (
    <section className="mt-10 rounded-lg border border-line bg-paper/50 px-5 py-4">
      <h2 className="text-sm font-semibold">Using this from an agent or a flow</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">
        Agents and flows read and update this database by its path. It shows up in <code className="font-mono text-[12.5px]">db_list</code> and in search, and this page updates as they write.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
            <Bot className="size-3.5 text-agent" /> Ask your agent
          </div>
          <CopyField mono={false} value={`Use the Brainspace database ${path}. Check its tables with db_schema first.`} />
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
            <Workflow className="size-3.5 text-brand-ink" /> In a flow
          </div>
          <CopyField value={`const rows = await step.do('load ${t}', () =>\n  db.query('${path}', 'SELECT * FROM "${t}" LIMIT 100'),\n)`} />
          <p className="mt-1.5 text-xs text-ink-3">
            List the path under <code className="font-mono">uses.read</code> in FLOW.md, or <code className="font-mono">uses.write</code> if the flow changes it.
          </p>
        </div>
      </div>
    </section>
  )
}
