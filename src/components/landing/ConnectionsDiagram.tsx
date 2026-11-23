import { Bot, KeyRound, Workflow } from 'lucide-react'
import { LogoMark } from '../Logo'
import { logoUrl } from '../../lib/presets'

const CALLERS = [
  { name: 'Claude Code', icon: <Bot /> },
  { name: 'Cursor', icon: <Bot /> },
  { name: 'Codex', icon: <Bot /> },
  { name: 'Claude app', icon: <Bot /> },
  { name: 'Your flows', icon: <Workflow /> },
]

const SERVICES = [
  ['HubSpot', 'hubspot.com'],
  ['Slack', 'slack.com'],
  ['PostHog', 'posthog.com'],
  ['Google Drive', 'drive.google.com'],
  ['Linear', 'linear.app'],
  ['Notion', 'notion.so'],
  ['GitHub', 'github.com'],
] as const

const chip = 'flex h-8 items-center gap-2 rounded-md border border-line-2 bg-sheet px-2.5 text-[13.5px] whitespace-nowrap text-ink'

// On wide screens each side is a column joined to the middle by a bracket: a rule down the
// column's inner edge, a tick from every chip to it, and one tick from the middle box.
const tickRight = 'md:after:absolute md:after:top-1/2 md:after:left-full md:after:h-px md:after:w-4 md:after:bg-line-2'
const tickLeft = 'md:before:absolute md:before:top-1/2 md:before:right-full md:before:h-px md:before:w-4 md:before:bg-line-2'

/** Agents and flows on one side, connected services on the other, and Brainspace holding the keys between them. */
export function ConnectionsDiagram() {
  return (
    <figure className="grid items-center gap-y-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <ul className="flex flex-wrap gap-2 md:flex-col md:border-r md:border-line-2 md:py-4 md:pr-4" aria-label="Who calls the tools">
        {CALLERS.map((c) => (
          <li key={c.name} className={`${chip} relative ${tickRight} [&>svg]:size-4 [&>svg]:text-agent`}>
            {c.icon}
            {c.name}
          </li>
        ))}
      </ul>

      <Down />

      <div className={`relative md:mx-4 ${tickLeft} ${tickRight}`}>
        <div className="rounded-lg border border-line-2 bg-sheet p-5">
          <div className="flex items-center gap-2">
            <LogoMark size={20} />
            <span className="font-mono text-[13px] text-ink">usebrain.space/mcp</span>
          </div>
          <ul className="mt-4 space-y-3 text-[14px] leading-snug text-ink-2">
            <li className="flex gap-2.5">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <span>
                <span className="font-medium text-ink">The keys stay here, encrypted.</span> An agent gets the tool, never the
                token behind it.
              </span>
            </li>
            <li className="border-t border-line pt-3">
              <span className="font-medium text-ink">You set who gets what</span>, by role, by person and by tool. Read-only
              members get read-only tools.
            </li>
            <li className="border-t border-line pt-3">
              Tools arrive named for their service:
              <span className="mt-1 block font-mono text-[12.5px] break-all text-agent">hubspot__search_crm_objects</span>
              <span className="block font-mono text-[12.5px] break-all text-agent">slack__post_message</span>
            </li>
          </ul>
        </div>
      </div>

      <Down />

      <ul className="flex flex-wrap gap-2 md:flex-col md:border-l md:border-line-2 md:py-4 md:pl-4" aria-label="Connected services">
        {SERVICES.map(([name, domain]) => (
          <li key={domain} className={`${chip} relative ${tickLeft}`}>
            <img src={logoUrl(domain)} alt="" width={16} height={16} className="rounded-[3px]" />
            {name}
          </li>
        ))}
      </ul>
    </figure>
  )
}

function Down() {
  return (
    <div className="flex justify-center md:hidden" aria-hidden>
      <div className="h-5 w-px bg-line-2" />
    </div>
  )
}
