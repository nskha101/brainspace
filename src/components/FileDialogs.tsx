import { useEffect, useState } from 'react'
import { Button, Input, Modal, Textarea } from './ui'

export function PathDialog({
  open,
  onClose,
  title,
  label,
  initial,
  confirm,
  hint,
  onSubmit,
  extra,
}: {
  open: boolean
  onClose: () => void
  title: string
  label: string
  initial: string
  confirm: string
  hint?: React.ReactNode
  onSubmit: (value: string) => Promise<void>
  extra?: React.ReactNode
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])
  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    try {
      await onSubmit(value.trim())
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => submit()} loading={busy}>
            {confirm}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <div className="mb-1.5 text-[13px] font-medium text-ink-2">{label}</div>
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-[13px]" />
        {hint && <div className="mt-2 text-xs text-ink-3">{hint}</div>}
        {extra}
      </form>
    </Modal>
  )
}

export function TextDialog({
  open,
  onClose,
  title,
  initial,
  confirm,
  placeholder,
  rows = 3,
  hint,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  initial: string
  confirm: string
  placeholder?: string
  rows?: number
  hint?: React.ReactNode
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit(value.trim())
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Textarea autoFocus rows={rows} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
      {hint && <p className="mt-2 text-[12.5px] text-ink-3">{hint}</p>}
    </Modal>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirm,
  danger,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  confirm: string
  danger?: boolean
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{children}</div>
    </Modal>
  )
}
