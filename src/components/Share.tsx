import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, User, Users } from 'lucide-react'
import { accessFn, promoteFn, setAccessFn, shareNeedsFn } from '../lib/api'
import { errMessage } from '../lib/utils'
import { PeoplePicker, type PickPerson } from './PeoplePicker'
import { Button, ChoiceSelect, Field, Input, Modal, type Choice } from './ui'

type Loaded = Awaited<ReturnType<typeof accessFn>>
type Needs = NonNullable<Awaited<ReturnType<typeof shareNeedsFn>>>
/** Who something is shared with: only its owner, everyone, or the people picked. */
export type Who = 'me' | 'everyone' | 'some'

export function namesList(people: { userId: string; name: string; email?: string }[], youId?: string) {
  // "You" first: "Only you and Farris can see this".
  const sorted = youId ? [...people].sort((a, b) => Number(b.userId === youId) - Number(a.userId === youId)) : people
  const list = sorted.map((p) => (p.userId === youId ? 'you' : p.name || p.email || 'someone'))
  // Everyone on the list has left the workspace: admins can get in.
  if (list.length <= 1) return list[0] ?? 'admins'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export const WHO_ME: Choice<Who> = { value: 'me', icon: <User />, label: 'Only you', detail: 'Private to you and your agents.' }
export const WHO_EVERYONE: Choice<Who> = { value: 'everyone', icon: <Users />, label: 'Everyone in the workspace', detail: 'All your teammates, and their agents.' }
export const WHO_SOME: Choice<Who> = { value: 'some', icon: <Lock />, label: 'Specific people', detail: 'Only the people you pick, and their agents.' }

export const whoSees = (path: string, access?: { restricted: boolean } | null): Who => (path.startsWith('/me') ? 'me' : access?.restricted ? 'some' : 'everyone')

/** Opens a share dialog. The icon says who the item is shared with now. */
export function ShareButton({
  who,
  onClick,
  variant = 'secondary',
  size = 'sm',
}: {
  who: Who
  onClick: () => void
  variant?: 'secondary' | 'ghost'
  /** Match the buttons it sits beside: small in a file header, medium on a flow or bot page. */
  size?: 'sm' | 'md'
}) {
  const Icon = who === 'me' ? User : who === 'some' ? Lock : Users
  return (
    <Button size={size} variant={variant} onClick={onClick} title="Choose who can see this">
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} /> Share
    </Button>
  )
}

/**
 * The two fields every share dialog has: a dropdown for who can see the thing,
 * and, for specific people, the box to pick them in.
 */
export function WhoFields({
  who,
  onWho,
  options,
  people,
  picked,
  onPicked,
  youId,
  note,
}: {
  who: Who
  onWho: (who: Who) => void
  options: Choice<Who>[]
  /** Everyone who can be picked. */
  people: PickPerson[]
  picked: Set<string>
  onPicked: (next: Set<string>) => void
  youId: string
  /** Under the list of people: what picking them means. */
  note?: ReactNode
}) {
  return (
    <>
      <Field label="Who can see it">
        <ChoiceSelect label="Who can see it" value={who} onChange={onWho} options={options} />
      </Field>
      {who === 'some' && (
        <Field label="People" hint={note}>
          <PeoplePicker people={people} picked={new Set(picked).add(youId)} onChange={onPicked} youId={youId} fixed={[youId]} />
        </Field>
      )}
    </>
  )
}

/** Whether the people picked, with you always among them, differ from the saved list. */
export function sameIds(picked: Set<string>, saved: string[], youId: string) {
  const ids = new Set(picked).add(youId)
  const was = new Set(saved).add(youId)
  return ids.size === was.size && [...was].every((id) => ids.has(id))
}

/**
 * Share a folder or file. In the team space it chooses between everyone and
 * specific people. Something private moves into the team space as it's shared,
 * open to everyone or already restricted to the people picked.
 */
export function ShareDialog({
  path,
  name,
  folder,
  hides,
  teamPath,
  fixedPath,
  open,
  onClose,
  onSaved,
}: {
  path: string
  name: string
  /** A folder's setting covers what's inside it, and the dialog says so. */
  folder?: boolean
  /** What nobody else will see, when "this folder" isn't the word for it: "this flow or its runs". */
  hides?: string
  /** Where something private lands in /team. Defaults to the same path there. */
  teamPath?: string
  /** The team path can't be changed, like a flow's, which has to sit in /team/flows. */
  fixedPath?: boolean
  open: boolean
  onClose: () => void
  /** `path` is where the item is now: sharing something private moves it. */
  onSaved: (r: { path: string; moved: boolean }) => void | Promise<void>
}) {
  const isPrivate = path.startsWith('/me')
  const [data, setData] = useState<Loaded | null>(null)
  const [who, setWho] = useState<Who>('everyone')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<{ who: Who; ids: string[] }>({ who: 'everyone', ids: [] })
  const [to, setTo] = useState('')
  const [editTo, setEditTo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needs, setNeeds] = useState<Needs | null>(null)

  useEffect(() => {
    if (!open) return
    setData(null)
    setNeeds(null)
    const dest = teamPath ?? path.replace(/^\/me/, '/team')
    setTo(dest)
    setEditTo(false)
    // A private flow takes the private files it uses with it. Nothing else does.
    if (isPrivate && /^\/me\/flows\/[^/]+$/.test(path)) {
      shareNeedsFn({ data: { path, to: dest } })
        .then(setNeeds)
        .catch((e) => toast.error(errMessage(e)))
    }
    accessFn({ data: { path } })
      .then((d) => {
        setData(d)
        const own = !!d.access?.restricted && !d.access.inherited
        const now: Who = !d.access ? 'me' : own ? 'some' : 'everyone'
        const ids = own ? d.access!.people.map((p) => p.userId) : []
        setWho(now)
        setPicked(new Set(ids))
        setSaved({ who: now, ids })
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
  // Sharing something private with nobody else would only move it.
  const others = !!data && [...picked].some((id) => id !== data.userId)
  const changed = !!data && (who !== saved.who || (who === 'some' && !sameIds(picked, saved.ids, data.userId)))

  const options: Choice<Who>[] = isPrivate
    ? [WHO_ME, WHO_EVERYONE, WHO_SOME]
    : [parent ? { ...WHO_EVERYONE, label: `Everyone who can see ${parent.split('/').pop()}`, detail: 'The same people as the folder it sits in.' } : WHO_EVERYONE, WHO_SOME]

  async function save() {
    if (!data) return
    setBusy(true)
    try {
      const people = who === 'some' ? [...new Set(picked).add(data.userId)] : null
      if (isPrivate) {
        const r = await promoteFn({ data: { path, to: to.trim(), ...(people ? { people } : {}), ...(needs?.items.length ? { alsoShare: needs.items.map((i) => i.from) } : {}) } })
        const now = r.node?.path ?? to.trim()
        const others = candidates.filter((m) => people?.includes(m.userId))
        const also = r.alsoShared.length ? `, along with ${r.alsoShared.map((i) => i.to).join(', ')}` : ''
        toast.success(
          people
            ? `Only ${namesList(others, data.userId)} can see ${name} now. It's at ${now}${also}`
            : r.updated.length
              ? `Shared. ${r.updated.map((u) => `${u.path} is now v${u.version}`).join(', ')}${also}`
              : `${name} is shared with everyone, at ${now}${also}`,
        )
        await onSaved({ path: now, moved: true })
      } else {
        const r = await setAccessFn({ data: { path, people } })
        if (r.changed) {
          toast.success(r.restricted && !r.inherited ? `Only ${namesList(r.people, data.userId)} can see ${name} now` : `${name} is visible to ${parent ? `everyone who can see ${parent}` : 'everyone'}`)
        }
        await onSaved({ path, moved: false })
      }
      onClose()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const inside = hides ?? (folder ? 'this folder or anything in it, including files added later' : 'it')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${name}`}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!changed || (isPrivate && (!to.trim() || (who === 'some' && !others) || (who !== 'me' && !!needs?.blocked.length)))}>
            {isPrivate ? 'Share' : 'Save'}
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
          <WhoFields
            who={who}
            onWho={setWho}
            options={options}
            people={candidates}
            picked={picked}
            onPicked={setPicked}
            youId={data.userId}
            note={`Nobody else will see ${inside}. That goes for admins too.`}
          />
          {isPrivate && who !== 'me' && (
            <div className="rounded-md bg-wash px-3 py-2.5 text-[13px] text-ink-2">
              {editTo ? (
                <>
                  <div className="mb-1.5 font-medium">Team path</div>
                  <Input autoFocus value={to} onChange={(e) => setTo(e.target.value)} className="font-mono text-[13px]" />
                </>
              ) : (
                <p>
                  It moves to the team space, at <span className="font-mono text-ink">{to}</span>.{' '}
                  {!fixedPath && (
                    <button type="button" onClick={() => setEditTo(true)} className="underline underline-offset-2 hover:text-ink">
                      Change
                    </button>
                  )}
                </p>
              )}
              {who === 'everyone' && !fixedPath && (
                <p className="mt-1.5 text-xs text-ink-3">If a doc already exists there, yours becomes its next version and the current one stays in its history.</p>
              )}
            </div>
          )}
          {isPrivate && who !== 'me' && needs && <FlowNeeds needs={needs} audience={who === 'some' ? 'The people you pick' : 'Everyone in the workspace'} />}
        </div>
      )}
    </Modal>
  )
}

/** The private things a flow uses, which become shared when the flow does. */
function FlowNeeds({ needs, audience }: { needs: Needs; audience: string }) {
  if (needs.blocked.length) {
    return (
      <div className="rounded-md bg-danger-wash/60 px-3 py-2.5 text-[13px] text-danger">
        <div className="font-medium">This flow can't be shared yet</div>
        {needs.blocked.map((b) => (
          <p key={b} className="mt-1">
            {b}
          </p>
        ))}
      </div>
    )
  }
  if (!needs.items.length && !needs.bots.length) return null
  return (
    <div className="rounded-md bg-wash px-3 py-2.5 text-[13px] text-ink-2">
      {needs.items.length > 0 && (
        <>
          <div className="font-medium text-ink">
            {needs.items.length === 1 ? 'One private item is' : `${needs.items.length} private items are`} shared with it
          </div>
          <p className="mt-1">
            A shared flow can't use your private space, so what this one uses moves to the team space too. {audience} will be able to see {needs.items.length === 1 ? 'it' : 'them'}.
          </p>
          <ul className="mt-2 space-y-1">
            {needs.items.map((i) => (
              <li key={i.from}>
                <span className="font-mono text-ink">{i.from}</span>{' '}
                <span className="text-ink-3">
                  {i.kind === 'flow' || i.kind === 'folder' ? `${i.kind}, ${i.files} ${i.files === 1 ? 'file' : 'files'}` : i.kind === 'doc' ? 'file' : i.kind}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {needs.bots.length > 0 && (
        <p className={needs.items.length ? 'mt-2' : undefined}>
          It also runs your private {needs.bots.length === 1 ? 'bot' : 'bots'} {needs.bots.join(', ')}, and a shared flow only runs shared bots. Share {needs.bots.length === 1 ? 'that bot' : 'those bots'} too, or the flow
          will fail at that step.
        </p>
      )}
    </div>
  )
}
