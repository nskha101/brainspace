import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { CopyField } from './ui'
import { cn } from '../lib/utils'
import { claudeConnectorLink, cursorInstallLink, setupPrompt, vscodeInstallLink } from '../lib/agent-links'

const CLIENTS = ['Claude app', 'Claude Code', 'Cursor', 'VS Code', 'Codex', 'Other'] as const
type Client = (typeof CLIENTS)[number]

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-medium text-ink-2">
      {n}. {children}
    </div>
  )
}

function LinkButton({ href, children, download }: { href: string; children: React.ReactNode; download?: boolean }) {
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      download={download}
      target={external && !download ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3.5 text-sm font-medium whitespace-nowrap text-white hover:bg-ink-2"
    >
      {children}
      {external && !download && <ExternalLink className="size-3.5 opacity-70" />}
    </a>
  )
}

function More({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="pt-2 text-[13px]">
      <summary className="cursor-pointer text-ink-3 hover:text-ink-2">{summary}</summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  )
}

const link = 'font-medium text-brand-ink underline underline-offset-4'

/**
 * How to connect an agent: one prompt for any coding agent, then per-client buttons and commands.
 * `prompt` replaces the default prompt, e.g. to add a first job.
 */
export function AgentSetup({ base, prompt }: { base: string; prompt?: string }) {
  const [client, setClient] = useState<Client>('Claude app')
  const url = `${base}/mcp`
  return (
    <div>
      <div className="rounded-lg border border-line bg-paper p-4">
        <div className="text-[13px] font-medium text-ink">Using a coding agent? Paste this into it</div>
        <CopyField className="mt-2" mono={false} value={prompt ?? setupPrompt(base)} />
        <p className="mt-2 text-[13px] text-ink-3">
          Works in Claude Code, Codex, Cursor, VS Code and most other coding agents. Your agent installs Brainspace and its
          skills, and tells you when to sign in.
        </p>
      </div>

      <div className="mt-6 text-[13px] font-medium text-ink-2">Or set it up yourself</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CLIENTS.map((c) => (
          <button
            key={c}
            onClick={() => setClient(c)}
            className={cn('rounded-md px-2.5 py-1 text-[13px]', client === c ? 'bg-ink text-white' : 'text-ink-2 hover:bg-wash')}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3 text-[14px] text-ink-2">
        {client === 'Claude app' && (
          <>
            <p>For chat and Cowork in the Claude app or on claude.ai. If you sign in to Claude Code with the same account, it gets Brainspace too.</p>
            <Step n={1}>Add Brainspace to Claude</Step>
            <LinkButton href={claudeConnectorLink(base)}>Add to Claude</LinkButton>
            <Step n={2}>Click Add, then Connect, and sign in</Step>
            <More summary="Want the Brainspace skills in Claude too?">
              <p>
                The skills teach Claude how your brain is laid out and how to fill it in. Claude can already get them from
                Brainspace, but installing them helps it reach for them on its own.{' '}
                <a href={`${base}/brainspace.plugin`} download className={link}>
                  Download brainspace.plugin
                </a>{' '}
                and upload it under Customize → Plugins → Upload plugin.
              </p>
            </More>
            <More summary="Setting it up for your whole Claude organization?">
              <p>
                Claude Team and Enterprise owners can add Brainspace for everyone. Teammates then just click Connect and sign
                in.
              </p>
              <a href={claudeConnectorLink(base, { admin: true })} target="_blank" rel="noreferrer" className={link}>
                Add Brainspace for your organization
              </a>
            </More>
          </>
        )}
        {client === 'Claude Code' && (
          <>
            <p>
              The Brainspace plugin brings the connection and the skills together, so there's nothing else to install. Paste
              these into Claude Code one at a time:
            </p>
            <Step n={1}>Add the marketplace</Step>
            <CopyField value={`/plugin marketplace add ${base}/marketplace.json`} />
            <Step n={2}>Install the plugin</Step>
            <CopyField value="/plugin install brainspace@brainspace" />
            <Step n={3}>Sign in</Step>
            <p>Run /reload-plugins, then /mcp, pick brainspace and sign in.</p>
            <More summary="Can't use plugins?">
              <p>Run these in your terminal instead. The first adds the server, the second the skills.</p>
              <CopyField value={`claude mcp add --transport http --scope user brainspace ${url}`} />
              <CopyField value={`npx -y skills add ${base} -g -a claude-code -y`} />
            </More>
          </>
        )}
        {client === 'Cursor' && (
          <>
            <Step n={1}>Add Brainspace to Cursor</Step>
            <LinkButton href={cursorInstallLink(base)}>Add to Cursor</LinkButton>
            <p>Cursor asks you to confirm, then opens a browser to sign in.</p>
            <Step n={2}>Install the skills in your terminal</Step>
            <CopyField value={`npx -y skills add ${base} -g -a cursor -y`} />
            <More summary="The button didn't open Cursor?">
              <p>Add this to ~/.cursor/mcp.json, inside mcpServers if the file already has one:</p>
              <CopyField value={JSON.stringify({ mcpServers: { brainspace: { url } } }, null, 2)} />
            </More>
          </>
        )}
        {client === 'VS Code' && (
          <>
            <p>For GitHub Copilot in VS Code.</p>
            <Step n={1}>Add Brainspace to VS Code</Step>
            <LinkButton href={vscodeInstallLink(base)}>Add to VS Code</LinkButton>
            <p>VS Code shows the server for you to install, then asks you to sign in when it starts.</p>
            <Step n={2}>Install the skills in your terminal</Step>
            <CopyField value={`npx -y skills add ${base} -g -a github-copilot -y`} />
            <More summary="The button didn't open VS Code?">
              <p>Run this in your terminal instead:</p>
              <CopyField value={`code --add-mcp '${JSON.stringify({ name: 'brainspace', type: 'http', url })}'`} />
            </More>
          </>
        )}
        {client === 'Codex' && (
          <>
            <p>Run these in your terminal, one at a time:</p>
            <Step n={1}>Add the server</Step>
            <CopyField value={`codex mcp add brainspace --url ${url}`} />
            <Step n={2}>Sign in</Step>
            <CopyField value="codex mcp login brainspace" />
            <Step n={3}>Install the skills</Step>
            <CopyField value={`npx -y skills add ${base} -g -a codex -y`} />
          </>
        )}
        {client === 'Other' && (
          <>
            <p>For Gemini CLI, Windsurf, OpenCode, Goose, Zed and most other agents, this adds the server to the ones it finds:</p>
            <CopyField value={`npx -y add-mcp ${url} -g -n brainspace`} />
            <p>Then the skills:</p>
            <CopyField value={`npx -y skills add ${base} -g`} />
            <p>Any MCP client that supports Streamable HTTP and OAuth can also connect to the URL directly:</p>
            <CopyField value={url} />
            <p>For scripts and headless agents, create an API key on the Agents page and send it as a header:</p>
            <CopyField value={'Authorization: Bearer bs_…'} />
          </>
        )}
      </div>
    </div>
  )
}
