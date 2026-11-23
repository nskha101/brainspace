import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { setupPrompt } from '../../lib/agent-links'

/** The setup prompt at hero size: the one line a visitor pastes into their coding agent, with a button that copies it. */
export function SetupPrompt({ base }: { base: string }) {
  const [copied, setCopied] = useState(false)
  const prompt = setupPrompt(base)
  // The prompt wraps its command in backticks. Odd pieces are the command, shown as code.
  const pieces = prompt.split('`')

  const copy = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-lg border border-line-2 bg-sheet p-5">
      <div className="text-[14px] font-medium text-ink">Or paste this into your coding agent</div>
      <p className="mt-3 rounded-md bg-paper px-3.5 py-3 text-[15px] leading-[1.6] text-ink">
        {pieces.map((piece, i) =>
          i % 2 ? (
            <code key={i} className="font-mono text-[13px] [overflow-wrap:anywhere] text-agent">
              {piece}
            </code>
          ) : (
            <span key={i}>{piece}</span>
          ),
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3.5 text-sm font-medium whitespace-nowrap text-white hover:bg-ink-2"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy prompt'}</span>
        </button>
        <a href="#connect" className="text-[14px] font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          Other ways to connect
        </a>
      </div>
      <p className="mt-4 border-t border-line pt-3.5 text-[13px] leading-relaxed text-ink-3">
        Works in Claude Code, Codex, Cursor and VS Code. Your agent installs Brainspace and its skills, then tells you when
        to sign in.
      </p>
    </div>
  )
}
