import { useState } from 'react'
import { CopyField } from './ui'
import { cn } from '../lib/utils'

const CLIENTS = ['Claude Code', 'Claude app', 'Cursor', 'Codex', 'Other'] as const

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-medium text-ink-2">
      {n}. {children}
    </div>
  )
}

const link = 'font-medium text-brand-ink underline underline-offset-4'

export function AgentSetup({ base }: { base: string }) {
  const [client, setClient] = useState<(typeof CLIENTS)[number]>('Claude Code')
  const url = `${base}/mcp`
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
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
            <p>Run /mcp, pick brainspace and sign in.</p>
            <details className="pt-2 text-[13px]">
              <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Can't use plugins?</summary>
              <div className="mt-3 space-y-3">
                <p>Run these in your terminal instead. The first adds the server, the second the skills.</p>
                <CopyField value={`claude mcp add --transport http --scope user brainspace ${url}`} />
                <CopyField value={`curl -fsSL ${base}/install.sh | sh`} />
              </div>
            </details>
          </>
        )}
        {client === 'Claude app' && (
          <>
            <p>
              For chat and Cowork in the Claude app or on claude.ai. The plugin brings the connection and the skills together,
              and carries over to Claude Code too.
            </p>
            <Step n={1}>
              <a href={`${base}/brainspace.plugin`} download className={link}>
                Download brainspace.plugin
              </a>
            </Step>
            <Step n={2}>Upload it under Customize → Plugins → Upload plugin</Step>
            <Step n={3}>Open the plugin's Connectors tab and connect Brainspace</Step>
            <p>Installing doesn't sign you in, so step 3 is what lets Claude reach your brain.</p>
            <details className="pt-2 text-[13px]">
              <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Brainspace isn't listed under Connectors?</summary>
              <div className="mt-3 space-y-3">
                <p>Add it under Settings → Connectors → Add custom connector with this URL:</p>
                <CopyField value={url} />
              </div>
            </details>
          </>
        )}
        {client === 'Cursor' && (
          <>
            <Step n={1}>Add this to ~/.cursor/mcp.json. Cursor opens a browser to sign in.</Step>
            <CopyField value={JSON.stringify({ mcpServers: { brainspace: { url } } }, null, 2)} />
            <Step n={2}>Install the skills</Step>
            <CopyField value={`npx skills add ${base} -g -a cursor`} />
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
            <CopyField value={`npx skills add ${base} -g -a codex`} />
          </>
        )}
        {client === 'Other' && (
          <>
            <p>Any MCP client that supports Streamable HTTP and OAuth can connect to:</p>
            <CopyField value={url} />
            <p>Skills install into most agents (Gemini CLI, Windsurf, OpenCode and others) with:</p>
            <CopyField value={`npx skills add ${base}`} />
            <p>For scripts and headless agents, create an API key on the Agents page and send it as a header:</p>
            <CopyField value={'Authorization: Bearer bs_…'} />
          </>
        )}
      </div>
    </div>
  )
}
