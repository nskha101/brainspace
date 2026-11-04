import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Loader2, Workflow, X } from 'lucide-react'
import { cn } from '../lib/utils'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand'
  size?: 'sm' | 'md'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-ink text-white hover:bg-ink-2',
        variant === 'brand' && 'bg-brand text-white hover:bg-brand-ink',
        variant === 'secondary' && 'border border-line-2 bg-sheet text-ink hover:bg-wash',
        variant === 'ghost' && 'text-ink-2 hover:bg-wash hover:text-ink',
        variant === 'danger' && 'bg-danger text-white hover:bg-[#a32a14]',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  )
})

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-line-2 bg-sheet px-3 text-sm text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none',
        className,
      )}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-md border border-line-2 bg-sheet px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none',
          className,
        )}
        {...rest}
      />
    )
  },
)

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 rounded-md border border-line-2 bg-sheet px-2.5 text-sm text-ink focus:border-ink-3 focus:outline-none',
        className,
      )}
      {...rest}
    />
  )
}

export function Label({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{children}</span>
      {hint && <span className="-mt-1 mb-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-ink-2">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'agent' | 'danger' | 'ok'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11.5px] font-medium',
        tone === 'neutral' && 'bg-wash text-ink-2',
        tone === 'brand' && 'bg-brand-wash text-brand-ink',
        tone === 'agent' && 'bg-agent-wash text-agent',
        tone === 'danger' && 'bg-danger-wash text-danger',
        tone === 'ok' && 'bg-[#e6f4ea] text-ok',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Avatar({ name, image, size = 24 }: { name?: string | null; image?: string | null; size?: number }) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  if (image) {
    return <img src={image} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  }
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-line text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/** Marks something an agent did, as opposed to a person in the browser. */
export function ViaMark({ via, client }: { via: 'web' | 'mcp' | 'flow' | string; client?: string | null }) {
  if (via === 'flow') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-brand-wash px-1.5 py-px text-[11.5px] font-medium text-brand-ink" title={client ? `By the ${client} flow` : 'By a flow'}>
        <Workflow className="size-3" />
        {client ? shortClient(client) : 'flow'}
      </span>
    )
  }
  if (via !== 'mcp') return null
  return (
    <span className="inline-flex items-center gap-1 rounded bg-agent-wash px-1.5 py-px text-[11.5px] font-medium text-agent" title={client ? `Via agent: ${client}` : 'Via agent'}>
      <Bot className="size-3" />
      {client ? shortClient(client) : 'agent'}
    </span>
  )
}

function shortClient(c: string) {
  return c.length > 22 ? c.slice(0, 20) + '…' : c
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto rounded-xl border border-line bg-sheet p-0 text-ink shadow-[0_24px_64px_-12px_rgba(26,24,32,0.35)] backdrop:bg-ink/30"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-wash hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-paper/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function Menu({ trigger, children, align = 'right' }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className={cn(
            'absolute z-30 mt-1 min-w-48 rounded-lg border border-line bg-sheet p-1 shadow-[0_12px_32px_-8px_rgba(26,24,32,0.25)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, onClick, danger, disabled, icon }: { children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'text-danger hover:bg-danger-wash' : 'text-ink hover:bg-wash',
      )}
    >
      {icon && <span className="text-ink-3 [&>svg]:size-4">{icon}</span>}
      {children}
    </button>
  )
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function CopyField({ value, mono = true, className }: { value: string; mono?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-md border border-line-2 bg-sheet', className)}>
      <code className={cn('flex-1 overflow-x-auto px-3 py-2 text-[12.5px] whitespace-pre text-ink', mono ? 'font-mono' : 'font-sans')}>{value}</code>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="border-l border-line-2 px-3 text-xs font-medium text-ink-2 hover:bg-wash"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
