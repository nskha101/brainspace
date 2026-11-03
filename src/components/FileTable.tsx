import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type RowSelectionState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileText,
  Folder,
  FolderInput,
  Image as ImageIcon,
  MoreHorizontal,
  PenLine,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'
import { Button, Menu, MenuItem } from './ui'
import { bytes, cn, driveHref, timeAgo } from '../lib/utils'

export type FileEntry = {
  id: string
  path: string
  name: string
  kind: 'folder' | 'doc' | 'file'
  drive: 'team' | 'me'
  description: string | null
  version: number
  size: number
  updatedAt: number
}

export type RowAction = 'rename' | 'move' | 'copy' | 'describe' | 'promote' | 'delete'
export type BulkAction = 'move' | 'copy' | 'promote' | 'delete'

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
})

const col = createColumnHelper<typeof features, FileEntry>()

type SortKey = 'name' | 'updatedAt' | 'size'
type UserSort = { id: SortKey; desc: boolean } | null

// Columns that render, with their widths. The table uses a fixed layout so long
// descriptions truncate instead of pushing the table past its border.
const WIDTH: Record<string, string> = {
  select: 'w-10 pr-0',
  updatedAt: 'hidden w-36 md:table-cell',
  size: 'hidden w-24 text-right sm:table-cell',
  actions: 'w-12 pl-0 text-right',
}

export function FileTable({
  entries,
  canWrite,
  canDelete,
  onAction,
  onBulk,
  empty,
}: {
  entries: FileEntry[]
  canWrite: boolean
  canDelete: boolean
  onAction: (action: RowAction, entry: FileEntry) => void
  onBulk: (action: BulkAction, entries: FileEntry[]) => void
  empty: ReactNode
}) {
  const [userSort, setUserSort] = useState<UserSort>({ id: 'name', desc: false })
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  // Selection points at rows by id; drop it when the listing changes underneath.
  const idsKey = entries.map((e) => e.id).join(',')
  useEffect(() => setRowSelection({}), [idsKey])

  const columns = useMemo(
    () =>
      col.columns([
        // Hidden first sort key: folders always sit above files, whichever way a column is sorted.
        col.accessor((e) => (e.kind === 'folder' ? 0 : 1), {
          id: 'folderFirst',
          sortFn: (a, b) => (a.getValue('folderFirst') as number) - (b.getValue('folderFirst') as number),
        }),
        col.display({
          id: 'select',
          // Select-all covers only the rows on screen, so a filter can never hide what a bulk action touches.
          header: ({ table }) => {
            const shown = table.getRowModel().rows
            const all = shown.length > 0 && shown.every((r) => r.getIsSelected())
            const some = shown.some((r) => r.getIsSelected())
            return (
              <input
                type="checkbox"
                aria-label="Select all shown"
                className="size-3.5 accent-[var(--color-brand)]"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = some && !all
                }}
                onChange={(e) =>
                  table.setRowSelection(e.target.checked ? Object.fromEntries(shown.map((r) => [r.id, true])) : {})
                }
              />
            )
          },
          cell: ({ row }) => (
            <input
              type="checkbox"
              aria-label={`Select ${row.original.name}`}
              className="size-3.5 accent-[var(--color-brand)]"
              checked={row.getIsSelected()}
              onChange={(e) => row.toggleSelected(e.target.checked)}
            />
          ),
        }),
        col.accessor('name', {
          header: 'Name',
          sortFn: (a, b) => a.original.name.localeCompare(b.original.name, undefined, { numeric: true, sensitivity: 'base' }),
          filterFn: (row, _id, value) => {
            const q = String(value ?? '').toLowerCase()
            return !q || row.original.name.toLowerCase().includes(q) || (row.original.description ?? '').toLowerCase().includes(q)
          },
          cell: ({ row }) => {
            const e = row.original
            const Icon = e.kind === 'folder' ? Folder : e.kind === 'file' ? ImageIcon : FileText
            return (
              <Link to={driveHref(e.path) as never} className="flex min-w-0 items-start gap-2.5">
                <Icon className={cn('mt-0.5 size-4 shrink-0', e.kind === 'folder' ? 'text-ink-2' : 'text-ink-3')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{e.name}</span>
                  {e.description && (
                    <span className="block truncate text-[12.5px] text-ink-3" title={e.description}>
                      {e.description}
                    </span>
                  )}
                </span>
              </Link>
            )
          },
        }),
        col.accessor('updatedAt', {
          header: 'Updated',
          sortFn: (a, b) => a.original.updatedAt - b.original.updatedAt,
          cell: ({ row }) =>
            row.original.kind === 'folder' ? null : (
              <span className="whitespace-nowrap text-ink-2">
                {timeAgo(row.original.updatedAt)} <span className="text-ink-3">v{row.original.version}</span>
              </span>
            ),
        }),
        col.accessor('size', {
          header: 'Size',
          sortFn: (a, b) => a.original.size - b.original.size,
          cell: ({ row }) => (row.original.kind === 'folder' ? null : <span className="whitespace-nowrap text-ink-3">{bytes(row.original.size)}</span>),
        }),
        col.display({
          id: 'actions',
          cell: ({ row }) =>
            canWrite ? (
              <Menu
                trigger={
                  <button
                    className="rounded p-1 text-ink-3 opacity-60 group-hover:opacity-100 hover:bg-wash hover:text-ink"
                    aria-label={`Actions for ${row.original.name}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                }
              >
                <MenuItem icon={<PenLine />} onClick={() => onAction('rename', row.original)}>
                  Rename
                </MenuItem>
                <MenuItem icon={<FolderInput />} onClick={() => onAction('move', row.original)}>
                  Move
                </MenuItem>
                <MenuItem icon={<Copy />} onClick={() => onAction('copy', row.original)}>
                  Copy
                </MenuItem>
                <MenuItem icon={<FileText />} onClick={() => onAction('describe', row.original)}>
                  Describe
                </MenuItem>
                {row.original.drive === 'me' && (
                  <MenuItem icon={<Share2 />} onClick={() => onAction('promote', row.original)}>
                    Promote to team
                  </MenuItem>
                )}
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={<Trash2 />} danger disabled={!canDelete} onClick={() => onAction('delete', row.original)}>
                  {canDelete ? 'Delete' : 'Delete (admins only)'}
                </MenuItem>
              </Menu>
            ) : null,
        }),
      ]),
    [canWrite, canDelete, onAction],
  )

  const table = useTable({
    features,
    data: entries,
    columns,
    getRowId: (e) => e.id,
    enableRowSelection: canWrite,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    // Sorting is driven by the headers below, always behind folderFirst.
    onSortingChange: () => {},
    state: {
      sorting: [{ id: 'folderFirst', desc: false }, ...(userSort ? [userSort] : [])],
      columnFilters,
      rowSelection,
    },
  })

  const cycleSort = (id: SortKey) =>
    setUserSort((s) => (!s || s.id !== id ? { id, desc: id !== 'name' } : s.desc === (id !== 'name') ? { id, desc: !s.desc } : null))

  const shownColumns = (id: string) => id !== 'folderFirst' && (id !== 'select' || canWrite)
  const filter = (table.getColumn('name')?.getFilterValue() as string) ?? ''
  const rows = table.getRowModel().rows
  // Bulk actions only ever apply to selected rows that are currently shown.
  const selected = rows.filter((r) => r.getIsSelected()).map((r) => r.original)
  const inPrivate = entries[0]?.drive === 'me'

  if (!entries.length) return <>{empty}</>

  return (
    <div>
      <div className="mb-3 flex min-h-9 flex-wrap items-center gap-2">
        <label className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-line-2 bg-sheet px-2.5 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <Search className="size-3.5 shrink-0 text-ink-3" />
          <input
            value={filter}
            onChange={(e) => table.getColumn('name')?.setFilterValue(e.target.value)}
            placeholder="Filter this folder"
            className="h-full min-w-0 flex-1 bg-transparent placeholder:text-ink-3 outline-none"
          />
          {filter && (
            <button onClick={() => table.getColumn('name')?.setFilterValue('')} className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label="Clear filter">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="ml-1 mr-1 text-sm font-medium">{selected.length} selected</span>
            <Button size="sm" onClick={() => onBulk('move', selected)}>
              <FolderInput className="size-3.5" /> Move
            </Button>
            <Button size="sm" onClick={() => onBulk('copy', selected)}>
              <Copy className="size-3.5" /> Copy
            </Button>
            {inPrivate && (
              <Button size="sm" onClick={() => onBulk('promote', selected)}>
                <Share2 className="size-3.5" /> Promote
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-wash hover:text-danger" onClick={() => onBulk('delete', selected)}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => table.resetRowSelection()}>
              <X className="size-3.5" /> Clear
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-line">
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers
                  .filter((h) => shownColumns(h.column.id))
                  .map((h) => {
                    const id = h.column.id as SortKey
                    const sortable = id === 'name' || id === 'updatedAt' || id === 'size'
                    const active = userSort?.id === id
                    return (
                      <TableHead key={h.id} className={WIDTH[h.column.id]} aria-sort={active ? (userSort!.desc ? 'descending' : 'ascending') : undefined}>
                        {sortable ? (
                          <button
                            onClick={() => cycleSort(id)}
                            className={cn('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink-2', id === 'size' && 'flex-row-reverse')}
                          >
                            <table.FlexRender header={h} />
                            {active ? userSort!.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
                          </button>
                        ) : (
                          <table.FlexRender header={h} />
                        )}
                      </TableHead>
                    )
                  })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                  {row
                    .getAllCells()
                    .filter((c) => shownColumns(c.column.id))
                    .map((cell) => (
                      <TableCell key={cell.id} className={WIDTH[cell.column.id]}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-ink-2">
                  Nothing here matches "{filter}".
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
