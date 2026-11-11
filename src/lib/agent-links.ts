// Links and prompts that connect an agent to Brainspace. `base` is the app URL without a trailing slash.

/** The one-line prompt that works in any coding agent. `then` is an optional first job, e.g. "Then fill in our workspace from https://acme.com." */
export function setupPrompt(base: string, then?: string) {
  // curl rather than "fetch": agents' web tools summarize the page (Claude Code) or fail on it (Codex), losing the commands.
  return `Set me up with Brainspace: run \`curl -fsSL ${base}/setup.md\` and follow the steps.${then ? ` ${then}` : ''}`
}

/** Opens Claude's "Add custom connector" dialog with Brainspace filled in. The admin version adds it for the whole Claude organization. */
export function claudeConnectorLink(base: string, opts: { admin?: boolean } = {}) {
  const path = opts.admin ? 'admin-settings/connectors' : 'customize/connectors'
  return `https://claude.ai/${path}?modal=add-custom-connector&connectorName=Brainspace&connectorUrl=${encodeURIComponent(`${base}/mcp`)}`
}

export function cursorInstallLink(base: string) {
  const config = btoa(JSON.stringify({ url: `${base}/mcp` }))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=brainspace&config=${encodeURIComponent(config)}`
}

export function vscodeInstallLink(base: string) {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'brainspace', type: 'http', url: `${base}/mcp` }))}`
}

/** `.claude/settings.json` for a repo: everyone who opens it in Claude Code is offered the Brainspace plugin (server and skills). */
export function repoClaudeSettings(base: string) {
  return JSON.stringify(
    {
      extraKnownMarketplaces: { brainspace: { source: { source: 'url', url: `${base}/marketplace.json` } } },
      enabledPlugins: { 'brainspace@brainspace': true },
    },
    null,
    2,
  )
}
