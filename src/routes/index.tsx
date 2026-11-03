import { Link, createFileRoute } from '@tanstack/react-router'
import { Bot } from 'lucide-react'
import { getMe } from '../lib/api'
import { Wordmark } from '../components/Logo'
import { CopyField } from '../components/ui'
import { logoUrl } from '../lib/presets'

export const Route = createFileRoute('/')({
  loader: () => getMe(),
  component: Landing,
})

const TRANSCRIPT: { tool: string; arg: string; out: string; tone?: 'agent' }[] = [
  { tool: 'skill_get', arg: 'brand-voice', out: 'loaded /team/skills/brand-voice/SKILL.md' },
  { tool: 'read_many', arg: '/team/brand/voice.md, /team/company/overview.md', out: '2 docs, v14 and v6' },
  { tool: 'hubspot__search_crm_objects', arg: 'deals closed this month', out: '12 deals via HubSpot' },
  { tool: 'write', arg: '/me/drafts/october-recap.md', out: 'created v1 in your private drive' },
  { tool: 'promote', arg: '/me/drafts/october-recap.md', out: 'now at /team/updates/october-recap.md', tone: 'agent' },
]

function Landing() {
  const me = Route.useLoaderData()
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-5 text-sm">
          <Link to="/docs" className="text-ink-2 hover:text-ink">
            Connect an agent
          </Link>
          {me ? (
            <Link to="/app" className="rounded-md bg-ink px-3.5 py-2 font-medium text-white hover:bg-ink-2">
              Open your drive
            </Link>
          ) : (
            <Link to="/login" className="rounded-md bg-ink px-3.5 py-2 font-medium text-white hover:bg-ink-2">
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="grid gap-12 pt-14 pb-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-24">
          <div>
            <h1 className="max-w-xl text-[44px] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-[58px]">
              The shared brain your team's agents work from.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2">
              Brand kit, docs, playbooks and connected tools in one MCP server. Agents read it, update it and
              hand drafts to the team. Every change is versioned with who made it and which agent did.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={me ? '/app' : '/login'} className="rounded-md bg-brand px-4 py-2.5 text-[15px] font-medium text-white hover:bg-brand-ink">
                {me ? 'Open your drive' : 'Create a workspace'}
              </Link>
              <Link to="/docs" className="rounded-md px-4 py-2.5 text-[15px] font-medium text-ink-2 hover:bg-wash hover:text-ink">
                How agents connect
              </Link>
            </div>
            <div className="mt-10 max-w-lg">
              <p className="mb-2 text-sm text-ink-3">Add it to Claude Code</p>
              <CopyField value="claude mcp add --transport http brainspace https://usebrain.space/mcp" />
            </div>
          </div>

          <div className="rounded-xl border border-line bg-sheet shadow-[0_30px_60px_-30px_rgba(26,24,32,0.25)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] text-ink-2">
              <Bot className="size-4 text-agent" />
              <span>Agent, asked to write the October recap in our voice</span>
            </div>
            <ol className="space-y-0 p-2">
              {TRANSCRIPT.map((t, i) => (
                <li
                  key={t.tool}
                  className="landing-line rounded-lg px-3 py-2.5 opacity-0"
                  style={{ animation: `landing-in 420ms ease-out ${300 + i * 380}ms forwards` }}
                >
                  <div className="font-mono text-[12.5px]">
                    <span className="text-agent">{t.tool}</span>
                    <span className="text-ink-3">(</span>
                    <span className="text-ink">{t.arg}</span>
                    <span className="text-ink-3">)</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-ink-2">{t.out}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="grid gap-10 border-t border-line py-16 md:grid-cols-3">
          <div>
            <h2 className="font-semibold">Two drives</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              <code className="font-mono text-[13px]">/team</code> is shared with everyone.{' '}
              <code className="font-mono text-[13px]">/me</code> is yours. Draft privately, then promote it to the team
              with its history intact.
            </p>
          </div>
          <div>
            <h2 className="font-semibold">Versions with provenance</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Every edit records the person, the agent client and a commit message. Diff any two versions and restore
              in one call.
            </p>
          </div>
          <div>
            <h2 className="font-semibold">Connections, routed</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Connect HubSpot, PostHog, Context.dev or any MCP server once. Agents get its tools through Brainspace,
              scoped by role, and never see the keys.
            </p>
            <div className="mt-4 flex gap-3">
              {['hubspot.com', 'posthog.com', 'context.dev', 'linear.app', 'notion.so', 'github.com'].map((d) => (
                <img key={d} src={logoUrl(d)} alt={d} width={20} height={20} className="rounded grayscale-[0.2]" />
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line py-16">
          <h2 className="font-semibold">Roles</h2>
          <dl className="mt-4 grid gap-6 text-[15px] md:grid-cols-3">
            <div>
              <dt className="font-medium">Admin</dt>
              <dd className="mt-1 text-ink-2">Full control, including deleting team files and managing people.</dd>
            </div>
            <div>
              <dt className="font-medium">Member</dt>
              <dd className="mt-1 text-ink-2">Reads and edits everything. Can't take destructive actions.</dd>
            </div>
            <div>
              <dt className="font-medium">Read-only</dt>
              <dd className="mt-1 text-ink-2">Reads the team drive and uses read-only tools.</dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 border-t border-line px-6 py-8 text-sm text-ink-3">
        <span>usebrain.space</span>
        <Link to="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link to="/terms" className="hover:text-ink">
          Terms
        </Link>
        <a href="mailto:hello@usebrain.space" className="hover:text-ink">
          Contact
        </a>
      </footer>
      <style>{`@keyframes landing-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }`}</style>
    </div>
  )
}
