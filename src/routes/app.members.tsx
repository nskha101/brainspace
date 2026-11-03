import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Link2, UserPlus } from 'lucide-react'
import { inviteFn, membersFn, removeMemberFn, revokeInviteFn, setAutoJoinFn, setRoleFn } from '../lib/api'
import { ConfirmDialog } from '../components/FileDialogs'
import { Avatar, Badge, Button, CopyField, Input, Modal, PageHeader, Select } from '../components/ui'
import { ROLE_LABEL, errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/members')({
  loader: () => membersFn(),
  component: MembersPage,
})

const ROLE_HELP: Record<string, string> = {
  admin: 'Full control, including deleting team files, managing people and removing connections.',
  member: 'Reads and edits everything, promotes, uploads, adds connections and invites. No destructive actions.',
  viewer: 'Reads the team drive and uses read-only connection tools.',
}

function MembersPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const isAdmin = data.role === 'admin'
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ url: string; email: string | null; emailed: boolean } | null>(null)
  const [removing, setRemoving] = useState<(typeof data.members)[number] | null>(null)

  async function invite(link: boolean) {
    setBusy(true)
    try {
      const r = await inviteFn({ data: { email: link ? undefined : email, role } })
      setCreated(r)
      setEmail('')
      router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Members"
        description="Everyone in the workspace and what their role lets them do. Agents act as the person who connected them, with that person's role."
        actions={
          data.role !== 'viewer' && (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" /> Invite
            </Button>
          )
        }
      />

      <AutoJoin data={data.autoJoin} isAdmin={isAdmin} />

      <ul className="divide-y divide-line rounded-lg border border-line">
        {data.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={m.name} image={m.image} size={32} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {m.name} {m.you && <span className="text-ink-3">(you)</span>}
              </div>
              <div className="text-[13px] text-ink-2">{m.email}</div>
            </div>
            {isAdmin && !m.you ? (
              <Select
                value={m.role}
                onChange={async (e) => {
                  try {
                    await setRoleFn({ data: { userId: m.userId, role: e.target.value } })
                    toast.success(`${m.name} is now ${ROLE_LABEL[e.target.value]}`)
                    router.invalidate()
                  } catch (err) {
                    toast.error(errMessage(err))
                  }
                }}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Read-only</option>
              </Select>
            ) : (
              <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
            )}
            {(isAdmin || m.you) && (
              <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                {m.you ? 'Leave' : 'Remove'}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {data.invites.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold">Pending invites</h2>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.email ?? 'Join link'}</div>
                  <div className="text-[12.5px] text-ink-3">
                    {ROLE_LABEL[i.role]}, invited by {i.invitedBy} {timeAgo(i.createdAt)}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(i.url)
                    toast.success('Invite link copied')
                  }}
                >
                  <Link2 className="size-3.5" /> Copy link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await revokeInviteFn({ data: { id: i.id } })
                    router.invalidate()
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold">Roles</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          {Object.entries(ROLE_HELP).map(([r, t]) => (
            <div key={r}>
              <dt className="font-medium">{ROLE_LABEL[r]}</dt>
              <dd className="mt-1 text-ink-2">{t}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false)
          setCreated(null)
        }}
        title="Invite to the workspace"
      >
        {created ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              {created.email
                ? created.emailed
                  ? `We emailed ${created.email}. You can also send them this link.`
                  : `Send ${created.email} this link. Only they can use it.`
                : 'Anyone with this link can join for 14 days. Revoke it from pending invites when you’re done.'}
            </p>
            <CopyField value={created.url} />
            <Button onClick={() => setCreated(null)}>Invite someone else</Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              invite(false)
            }}
          >
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-ink-2">Email</div>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoFocus />
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-ink-2">Role</div>
              <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-full">
                {isAdmin && <option value="admin">Admin</option>}
                <option value="member">Member</option>
                <option value="viewer">Read-only</option>
              </Select>
              <p className="mt-1.5 text-xs text-ink-3">{ROLE_HELP[role]}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={busy}>
                Send invite
              </Button>
              <Button type="button" onClick={() => invite(true)} disabled={busy}>
                Create join link instead
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing?.you ? 'Leave the workspace?' : `Remove ${removing?.name}?`}
        confirm={removing?.you ? 'Leave' : 'Remove'}
        danger
        onConfirm={async () => {
          try {
            await removeMemberFn({ data: { userId: removing!.userId } })
            if (removing!.you) window.location.href = '/app'
            else router.invalidate()
          } catch (e) {
            toast.error(errMessage(e))
          }
        }}
      >
        {removing?.you
          ? 'You lose access to the team drive. Your private drive is kept in case you come back.'
          : 'They lose access right away and their API keys stop working. Their private drive is kept in case they come back.'}
      </ConfirmDialog>
    </div>
  )
}

type AutoJoinData = Awaited<ReturnType<typeof membersFn>>['autoJoin']

function AutoJoin({ data, isAdmin }: { data: AutoJoinData; isAdmin: boolean }) {
  const router = useRouter()
  const [role, setRole] = useState(data.role)
  const [busy, setBusy] = useState(false)

  async function save(enabled: boolean, nextRole: string = role) {
    setBusy(true)
    try {
      const r = await setAutoJoinFn({ data: { enabled, role: nextRole } })
      if (enabled && r.addedNow.length) {
        toast.success(`Auto-join is on. Added ${r.addedNow.length} ${r.addedNow.length === 1 ? 'person' : 'people'} already using @${r.domain}.`)
      } else {
        toast.success(enabled ? `Anyone signing in with @${r.domain} now joins automatically` : 'Auto-join is off')
      }
      router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!isAdmin && !data.enabled) return null
  if (isAdmin && !data.enabled && !data.available) return null

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-paper px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {data.enabled ? `Everyone with an @${data.domain} email joins automatically` : `Auto-add teammates with @${data.yourDomain} emails`}
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">
          {data.enabled
            ? `They join as ${ROLE_LABEL[data.role]?.toLowerCase()} the first time they sign in with a verified address. No invite needed.`
            : `Anyone who signs in with a verified @${data.yourDomain} address joins this workspace, and people already using Brainspace with one are added now.`}
        </div>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Select
            value={role}
            disabled={busy}
            onChange={(e) => {
              setRole(e.target.value as typeof role)
              if (data.enabled) save(true, e.target.value)
            }}
            aria-label="Role for people who join automatically"
          >
            <option value="member">as Member</option>
            <option value="viewer">as Read-only</option>
            <option value="admin">as Admin</option>
          </Select>
          <Button variant={data.enabled ? 'secondary' : 'primary'} loading={busy} onClick={() => save(!data.enabled)}>
            {data.enabled ? 'Turn off' : `Auto-add @${data.yourDomain}`}
          </Button>
        </div>
      )}
    </div>
  )
}
