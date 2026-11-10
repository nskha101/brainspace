import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Users } from 'lucide-react'
import { accessFn, setAccessFn } from '../lib/api'
import { cn, errMessage } from '../lib/utils'
import { Avatar, Button, Modal } from './ui'

type Loaded = Awaited<ReturnType<typeof accessFn>>

export function namesList(people: { userId: string; name: string; email: string }[], youId?: string) {
  // "You" first: "Only you and Farris can see this".
  const sorted = youId ? [...people].sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId)) : people
  const list = sorted.map((p) => (p.userId === youId ? 'you' : p.name || p.email))
  // Everyone on the list has left the workspace: admins can get in.
  if (list.length <= 1) return list[0] ?? 'admins'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** Admins pick whether a team folder or file is open to everyone or only to certain people. */
export function AccessDialog({
  path,
  name,
  open,
  onClose,
  onSaved,
}: {
  path: string
  name: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [mode, setMode] = useState<'everyone' | 'some'>('everyone')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setData(null)
    accessFn({ data: { path } })
      .then((d) => {
        setData(d)
        const own = d.access.restricted && !d.access.inherited
        setMode(own ? 'some' : 'everyone')
        setPicked(new Set(own ? d.access.people.map((p) => p.userId) : [d.userId]))
      })
      .catch((e) => {
        toast.error(errMessage(e))
        onClose()
      })
  }, [open, path])

  const a = data?.access
  // Inside a restricted folder, only the people who can see that folder are worth offering.
  const candidates = a?.inherited ? (data?.members ?? []).filter((m) => a.people.some((p) => p.userId === m.userId)) : (data?.members ?? [])
  const parent = a?.inherited ? a.restrictedAt : null

  async function save() {
    if (!data) return
    setBusy(true)
    try {
      const r = await setAccessFn({ data: { path, people: mode === 'everyone' ? null : [...picked] } })
      if (r.changed) {
        toast.success(r.restricted && !r.inherited ? `Only ${namesList(r.people, data.userId)} can see ${name} now` : `${name} is visible to ${parent ? `everyone who can see ${parent}` : 'everyone'}`)
      }
      onSaved()
      onClose()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Who can see ${name}`}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!data || (mode === 'some' && picked.size < 1)}>
            Save
          </Button>
        </>
      }
    >
      {!data ? (
        <div className="flex justify-center py-8 text-ink-3">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {parent && (
            <p className="rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">
              This is inside <span className="font-mono">{parent}</span>, which only {namesList(a!.people, data.userId)} can see.
            </p>
          )}
          <Choice
            active={mode === 'everyone'}
            onClick={() => setMode('everyone')}
            icon={<Users className="size-4" />}
            title={parent ? `Everyone who can see ${parent.split('/').pop()}` : 'Everyone in the workspace'}
            detail={parent ? 'Same people as the folder it sits in.' : 'Anyone in the workspace, and their agents, can find and open it.'}
          />
          <Choice
            active={mode === 'some'}
            onClick={() => setMode('some')}
            icon={<Lock className="size-4" />}
            title="Only certain people"
            detail="Everyone else, admins included, won't see it at all. Covers everything inside it, including files added later."
          />
          {mode === 'some' && (
            <ul className="max-h-72 overflow-y-auto rounded-lg border border-line">
              {candidates.map((m) => {
                const you = m.userId === data.userId
                const on = you || picked.has(m.userId)
                return (
                  <li key={m.userId} className="border-b border-line last:border-0">
                    <label className={cn('flex items-center gap-3 px-3 py-2', you ? 'cursor-default' : 'cursor-pointer hover:bg-wash')}>
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[var(--color-brand)]"
                        checked={on}
                        disabled={you}
                        onChange={(e) =>
                          setPicked((s) => {
                            const next = new Set(s)
                            if (e.target.checked) next.add(m.userId)
                            else next.delete(m.userId)
                            return next
                          })
                        }
                      />
                      <Avatar name={m.name} image={m.image} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {m.name || m.email}
                          {you && <span className="font-normal text-ink-3"> (you)</span>}
                        </span>
                        <span className="block truncate text-xs text-ink-3">{m.email}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}

function Choice({ active, onClick, icon, title, detail }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left',
        active ? 'border-brand bg-brand-wash/50' : 'border-line hover:bg-wash',
      )}
    >
      <span className={cn('mt-0.5', active ? 'text-brand-ink' : 'text-ink-3')}>{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[13px] text-ink-2">{detail}</span>
      </span>
    </button>
  )
}
