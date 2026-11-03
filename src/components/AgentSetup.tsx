import { useState } from 'react'
import { CopyField } from './ui'
import { cn } from '../lib/utils'

const CLIENTS = ['Claude Code', 'Claude.ai', 'Claude Cowork', 'Cursor', 'Codex', 'Other'] as const

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
              Install the Brainspace plugin. It adds the MCP server and the agent skills in one go. Inside Claude Code, run
              these one at a time (Claude Code takes one slash command per message):
            </p>
            <div className="text-[13px] font-medium text-ink-2">1. Add the marketplace</div>
            <CopyField value={`/plugin marketplace add ${base}/marketplace.json`} />
            <div className="text-[13px] font-medium text-ink-2">2. Install the plugin</div>
            <CopyField value="/plugin install brainspace@brainspace" />
            <div className="text-[13px] font-medium text-ink-2">3. Sign in</div>
            <p>Run /mcp in Claude Code, pick brainspace and sign in.</p>
            <p className="pt-2">Prefer not to use plugins? Run these in your terminal instead, one at a time:</p>
            <div className="text-[13px] font-medium text-ink-2">1. Add the server</div>
            <CopyField value={`claude mcp add --transport http --scope user brainspace ${url}`} />
            <div className="text-[13px] font-medium text-ink-2">2. Install the skills</div>
            <CopyField value={`curl -fsSL ${base}/install.sh | sh`} />
          </>
        )}
        {client === 'Claude.ai' && (
          <>
            <p>Settings → Connectors → Add custom connector. Paste this URL and sign in when asked.</p>
            <CopyField value={url} />
            <p>
              To add the Brainspace skills too, upload{' '}
              <a href={`${base}/brainspace.plugin`} download className="font-medium text-brand-ink underline underline-offset-4">
                brainspace.plugin
              </a>{' '}
              under Customize → Plugins → Upload plugin. Plugins you install carry over between chat, Cowork and Claude Code.
            </p>
          </>
        )}
        {client === 'Claude Cowork' && (
          <>
            <p>The Brainspace plugin gives Cowork the connector and the skills together.</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <a href={`${base}/brainspace.plugin`} download className="font-medium text-brand-ink underline underline-offset-4">
                  Download brainspace.plugin
                </a>
                .
              </li>
              <li>In the Claude desktop app, open Cowork and go to Customize → Plugins → Upload plugin. Pick the file you downloaded.</li>
              <li>
                Open the Brainspace plugin's Connectors tab and connect Brainspace. Installing doesn't sign you in, so the skills
                can't reach your brain until this shows as connected.
              </li>
            </ol>
            <p>If the connector isn't listed there, add it under Settings → Connectors → Add custom connector with this URL:</p>
            <CopyField value={url} />
          </>
        )}
        {client === 'Cursor' && (
          <>
            <p>Add this to ~/.cursor/mcp.json. Cursor opens a browser to sign in.</p>
            <CopyField value={JSON.stringify({ mcpServers: { brainspace: { url } } }, null, 2)} />
            <p>Then install the skills:</p>
            <CopyField value={`npx skills add ${base} -g -a cursor`} />
          </>
        )}
        {client === 'Codex' && (
          <>
            <p>Run these in your terminal, one at a time:</p>
            <div className="text-[13px] font-medium text-ink-2">1. Add the server</div>
            <CopyField value={`codex mcp add brainspace --url ${url}`} />
            <div className="text-[13px] font-medium text-ink-2">2. Sign in</div>
            <CopyField value="codex mcp login brainspace" />
            <div className="text-[13px] font-medium text-ink-2">3. Install the skills</div>
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
