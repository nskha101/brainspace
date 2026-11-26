import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Users } from 'lucide-react'
import type { AccessInfo } from '../server/services/access'
import { accessFn, setAccessFn } from '../lib/api'
import { errMessage } from '../lib/utils'
import { PeoplePicker } from './PeoplePicker'
import { Button, ChoiceSelect, Field, Modal, type Choice } from './ui'

type Loaded = Awaited<ReturnType<typeof accessFn>>
type Mode = 'everyone' | 'some'

export function namesList(people: { userId: string; name: string; email: string }[], youId?: string) {
  // "You" first: "Only you and Farris can see this".
  const sorted = youId ? [...people].sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId)) : people
  const list = sorted.map((p) => (p.userId === youId ? 'you' : p.name || p.email))
  // Everyone on the list has left the workspace: admins can get in.
  if (list.length <= 1) return list[0] ?? 'admins'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** Opens the share dialog. The icon says whether the item is open to everyone or to certain people. */
export function ShareButton({ access, onClick, variant = 'secondary' }: { access: AccessInfo | null; onClick: () => void; variant?: 'secondary' | 'ghost' }) {
  return (
    <Button size="sm" variant={variant} onClick={onClick} title="Choose who can see this">
      {access?.restricted ? <Lock className="size-3.5" /> : <Users className="size-3.5" />} Share
    </Button>
  )
}

/** Share a team folder or file with everyone, or with the people picked here. */
export function AccessDialog({
  path,
  name,
  folder,
  open,
  onClose,
  onSaved,
}: {
  path: string
  name: string
  /** A folder's setting covers what's inside it, and the dialog says so. */
  folder?: boolean
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [mode, setMode] = useState<Mode>('everyone')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<{ mode: Mode; ids: string[] }>({ mode: 'everyone', ids: [] })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setData(null)
    accessFn({ data: { path } })
      .then((d) => {
        setData(d)
        const own = d.access.restricted && !d.access.inherited
        const ids = own ? d.access.people.map((p) => p.userId) : [d.userId]
        setMode(own ? 'some' : 'everyone')
        setPicked(new Set(ids))
        setSaved({ mode: own ? 'some' : 'everyone', ids })
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
  // You stay on any list you set, so you count even when the list was saved without you.
  const ids = data ? new Set(picked).add(data.userId) : picked
  const changed = mode !== saved.mode || (mode === 'some' && (ids.size !== saved.ids.length || saved.ids.some((id) => !ids.has(id))))

  const options: Choice<Mode>[] = [
    {
      value: 'everyone',
      icon: <Users />,
      label: parent ? `Everyone who can see ${parent.split('/').pop()}` : 'Everyone in the workspace',
      detail: parent ? 'The same people as the folder it sits in.' : 'All your teammates, and their agents.',
    },
    { value: 'some', icon: <Lock />, label: 'Specific people', detail: 'Only the people you pick, and their agents.' },
  ]

  async function save() {
    if (!data) return
    setBusy(true)
    try {
      const r = await setAccessFn({ data: { path, people: mode === 'everyone' ? null : [...ids] } })
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
      title={`Share ${name}`}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!data || !changed}>
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
        <div className="space-y-4">
          {parent && (
            <p className="rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">
              This is inside <span className="font-mono">{parent}</span>, which only {namesList(a!.people, data.userId)} can see.
            </p>
          )}
          <Field label="Who can see it">
            <ChoiceSelect label="Who can see it" value={mode} onChange={setMode} options={options} />
          </Field>
          {mode === 'some' && (
            <Field
              label="People"
              hint={`Nobody else will see ${folder ? 'this folder or anything in it, including files added later' : 'it'}. That goes for admins too.`}
            >
              <PeoplePicker people={candidates} picked={ids} onChange={setPicked} youId={data.userId} fixed={[data.userId]} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  )
}
