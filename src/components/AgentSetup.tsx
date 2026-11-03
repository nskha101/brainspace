import { useState } from 'react'
import { CopyField } from './ui'
import { cn } from '../lib/utils'

const CLIENTS = ['Claude Code', 'Claude.ai', 'Cursor', 'Codex', 'Other'] as const

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
            <p>Install the Brainspace plugin. It adds the MCP server and the agent skills in one go. Run these inside Claude Code:</p>
            <CopyField value={`/plugin marketplace add ${base}/marketplace.json\n/plugin install brainspace@brainspace`} />
            <p>Then run /mcp, pick brainspace and sign in. Prefer not to use plugins? Add the server and skills separately:</p>
            <CopyField value={`claude mcp add --transport http --scope user brainspace ${url}\ncurl -fsSL ${base}/install.sh | sh`} />
          </>
        )}
        {client === 'Claude.ai' && (
          <>
            <p>Settings → Connectors → Add custom connector. Paste this URL and sign in when asked.</p>
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
            <p>Add the server, sign in, then install the skills:</p>
            <CopyField value={`codex mcp add brainspace --url ${url}\ncodex mcp login brainspace\nnpx skills add ${base} -g -a codex`} />
          </>
        )}
        {client === 'Other' && (
          <>
            <p>Any MCP client that supports Streamable HTTP and OAuth can connect to:</p>
            <CopyField value={url} />
            <p>Skills install into most agents (Gemini CLI, Windsurf, OpenCode and others) with:</p>
            <CopyField value={`npx skills add ${base}`} />
            <p>For scripts and headless agents, create an API key below and send it as a header:</p>
            <CopyField value={'Authorization: Bearer bs_…'} />
          </>
        )}
      </div>
    </div>
  )
}
