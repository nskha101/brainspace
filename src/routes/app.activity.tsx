import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { activityFn } from '../lib/api'
import { ActivityRow, type ActivityItem } from '../components/ActivityRow'
import { Button, Empty, PageHeader } from '../components/ui'

export const Route = createFileRoute('/app/activity')({
  loader: () => activityFn({ data: {} }),
  component: ActivityPage,
})

function ActivityPage() {
  const first = Route.useLoaderData()
  const [items, setItems] = useState<ActivityItem[]>(first)
  const [more, setMore] = useState(first.length >= 100)
  const [busy, setBusy] = useState(false)
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <PageHeader
        title="Activity"
        description="Everything that changed in the team space and your personal space, by people and by agents. Agent actions are marked with the client that made them."
      />
      {items.length === 0 ? (
        <Empty title="No activity yet" />
      ) : (
        <ul className="space-y-5">
          {items.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </ul>
      )}
      {more && (
        <Button
          className="mt-8"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            const next = await activityFn({ data: { before: items[items.length - 1]!.createdAt } })
            setItems((i) => [...i, ...next])
            setMore(next.length >= 100)
            setBusy(false)
          }}
        >
          Load older
        </Button>
      )}
    </div>
  )
}
