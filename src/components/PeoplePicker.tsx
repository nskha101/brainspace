import { useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Avatar, POPUP, useAnchored, useOutsideClose } from './ui'

export type PickPerson = { userId: string; name: string; email: string; image?: string | null }

/**
 * Choose people from the workspace: a box that suggests teammates as you type, above the list
 * of everyone picked so far. Clicking into the box shows everyone left, so a small team never
 * has to type.
 */
export function PeoplePicker({
  people,
  picked,
  onChange,
  youId,
  fixed = [],
  placeholder = 'Add people by name or email',
  empty,
}: {
  /** Everyone who can be picked. */
  people: PickPerson[]
  picked: Set<string>
  onChange: (next: Set<string>) => void
  /** Listed first and marked "(you)". */
  youId?: string
  /** People who are always on the list and can't be taken off. */
  fixed?: string[]
  placeholder?: string
  /** Shown in place of the list while nobody is picked. */
  empty?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const style = useAnchored(open, box, 264)
  useOutsideClose(open, root, () => setOpen(false))

  const isOn = (p: PickPerson) => picked.has(p.userId) || fixed.includes(p.userId)
  const chosen = people.filter(isOn).sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId))
  const rest = people.filter((p) => !isOn(p))
  const needle = q.trim().toLowerCase()
  const matches = needle ? rest.filter((p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)) : rest
  const at = Math.min(active, Math.max(0, matches.length - 1))

  const add = (p: PickPerson) => {
    onChange(new Set(picked).add(p.userId))
    setQ('')
    input.current?.focus()
  }
  const remove = (p: PickPerson) => {
    const next = new Set(picked)
    next.delete(p.userId)
    onChange(next)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive(Math.max(0, Math.min(matches.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && matches[at]) add(matches[at])
    } else if (e.key === 'Escape' && (open || q)) {
      // Inside a dialog, Escape should close the suggestions and leave the dialog open.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setQ('')
    }
  }

  return (
    <div className="space-y-2">
      <div ref={root}>
        <div
          ref={box}
          className={cn('flex h-9 items-center gap-2 rounded-md border bg-sheet px-3', open ? 'border-ink-3' : 'border-line-2')}
          onClick={() => input.current?.focus()}
        >
          <Search className="size-3.5 shrink-0 text-ink-3" />
          <input
            ref={input}
            role="combobox"
            aria-label={placeholder}
            aria-expanded={open}
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={open && matches[at] ? `${id}-${matches[at].userId}` : undefined}
            autoComplete="off"
            value={q}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={onKeyDown}
            // Tabbing away closes the suggestions. A click outside is handled by useOutsideClose.
            onBlur={(e) => e.relatedTarget && !root.current?.contains(e.relatedTarget) && setOpen(false)}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        {open && (
          <div id={id} role="listbox" aria-label="People you can add" style={style} className={POPUP}>
            {matches.map((p, i) => (
              <div
                key={p.userId}
                id={`${id}-${p.userId}`}
                role="option"
                aria-selected={i === at}
                onMouseEnter={() => setActive(i)}
                // Keep focus in the box, so several people can be added in a row.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(p)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5', i === at && 'bg-wash')}
              >
                <Avatar name={p.name} image={p.image} size={24} />
                <PersonText p={p} />
              </div>
            ))}
            {!matches.length && <p className="px-2.5 py-2 text-[13px] text-ink-3">{needle ? `Nobody matches "${q.trim()}".` : 'Everyone is already on the list.'}</p>}
          </div>
        )}
      </div>
      {chosen.length ? (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-line">
          {chosen.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
              <Avatar name={p.name} image={p.image} size={24} />
              <PersonText p={p} you={p.userId === youId} />
              {!fixed.includes(p.userId) && (
                <button type="button" onClick={() => remove(p)} aria-label={`Remove ${p.name || p.email}`} className="rounded p-1 text-ink-3 hover:bg-wash hover:text-ink">
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        empty && <p className="rounded-lg border border-dashed border-line-2 px-3 py-2.5 text-[13px] text-ink-3">{empty}</p>
      )}
    </div>
  )
}

function PersonText({ p, you }: { p: PickPerson; you?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">
        {p.name || p.email}
        {you && <span className="font-normal text-ink-3"> (you)</span>}
      </span>
      {p.name && <span className="block truncate text-xs text-ink-3">{p.email}</span>}
    </span>
  )
}
