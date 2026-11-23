import { Bot } from 'lucide-react'
import { cn } from '../../lib/utils'

const CALLS: { tool: string; arg?: string; result: string; skill?: boolean }[] = [
  { tool: 'whoami', result: 'Member of Fieldnote. 4 skills, 5 connections.' },
  { tool: 'skill_get', arg: 'brand-voice', result: 'Loaded the skill, version 3.', skill: true },
  { tool: 'read', arg: '/team/brand/voice.md', result: 'Version 5.' },
  { tool: 'hubspot__search_crm_objects', arg: 'offline beta list', result: '214 contacts.' },
  { tool: 'write', arg: '/me/drafts/launch-email.md', result: 'Saved as version 1, private to Maya.' },
]

const STEPS = [
  'Read /team/brand/voice.md before you write.',
  'Plain words and short sentences. No hype.',
  "It's Fieldnote, one word, capital F only.",
  'Check the draft against the words we avoid.',
]

/** A skill next to an agent using it: the playbook on the left, the tool calls it leads to on the right. */
export function AgentSession() {
  return (
    <div className="grid overflow-hidden rounded-lg border border-line-2 bg-sheet md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="border-b border-line md:border-r md:border-b-0">
        <div className="border-b border-line px-5 py-3 font-mono text-[13px] break-all text-ink">/team/skills/brand-voice/SKILL.md</div>
        <div className="px-5 py-5">
          <pre className="font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap text-ink-3">
            {'---\n'}
            <span className="text-ink-2">name:</span> brand-voice{'\n'}
            <span className="text-ink-2">description:</span> Use when writing anything a customer will read.{'\n'}
            {'---'}
          </pre>
          <div className="mt-4 text-[19px] font-[650] tracking-[-0.015em]">Brand voice</div>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 font-serif text-[16.5px] leading-[1.55] marker:font-sans marker:text-[13px] marker:text-ink-3">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      </div>

      <div className="min-w-0 bg-paper/50">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[13px]">
          <Bot className="size-4 text-agent" aria-hidden />
          <span className="font-medium text-agent">Claude Code</span>
          <span className="text-ink-3">signed in as Maya Chen</span>
        </div>
        <div className="px-5 py-5">
          <p className="ml-auto w-fit max-w-[36ch] rounded-lg rounded-br-sm bg-ink px-3.5 py-2 text-[14px] leading-snug text-white">
            Draft the launch email for offline mode.
          </p>
          <ol className="mt-5 space-y-1" aria-label="What the agent did">
            {CALLS.map((c) => (
              <li key={c.tool} className={cn('-mx-2 rounded-md px-2 py-1.5', c.skill && 'bg-agent-wash')}>
                <div className="font-mono text-[12.5px] leading-snug break-all">
                  <span className="text-agent">{c.tool}</span>
                  {c.arg && <span className="text-ink"> {c.arg}</span>}
                </div>
                <div className="mt-0.5 text-[13px] leading-snug text-ink-3">{c.result}</div>
              </li>
            ))}
          </ol>
          <p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">
            The draft is in your space. It follows the brand voice skill and is written for the 214 customers on the beta
            list. Promote it when you want the team to see it.
          </p>
        </div>
      </div>
    </div>
  )
}
