import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { listTrashFn, purgeFn, restoreTrashFn } from '../lib/api'
import { ConfirmDialog } from '../components/FileDialogs'
import { Button, Empty, PageHeader } from '../components/ui'
import { errMessage, timeAgo } from '../lib/utils'

export const Route = createFileRoute('/app/trash')({
  loader: () => listTrashFn(),
  component: TrashPage,
})

function TrashPage() {
  const items = Route.useLoaderData()
  const router = useRouter()
  const [purging, setPurging] = useState<(typeof items)[number] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function restore(id: string) {
    setBusy(id)
    try {
      const r = await restoreTrashFn({ data: { id } })
      toast.success(`Restored ${r.restored}`)
      router.invalidate()
    } catch (e) {
      toast.error(errMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <PageHeader title="Trash" description="Deleted items from the team drive and your private drive. Restoring brings back the item with its full version history." />
      {items.length === 0 ? (
        <Empty title="Trash is empty" />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px]">{t.path}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  {t.kind}, deleted {timeAgo(t.deletedAt)} by {t.deletedBy}
                </div>
              </div>
              {t.canRestore && (
                <Button size="sm" onClick={() => restore(t.id)} loading={busy === t.id}>
                  Restore
                </Button>
              )}
              {t.canPurge && (
                <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-wash hover:text-danger" onClick={() => setPurging(t)}>
                  Delete forever
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!purging}
        onClose={() => setPurging(null)}
        title="Delete forever?"
        confirm="Delete forever"
        danger
        onConfirm={async () => {
          try {
            await purgeFn({ data: { id: purging!.id } })
            toast.success('Deleted forever')
            router.invalidate()
          } catch (e) {
            toast.error(errMessage(e))
          }
        }}
      >
        <span className="font-mono">{purging?.path}</span> and every version of it will be gone. This can't be undone.
      </ConfirmDialog>
    </div>
  )
}
