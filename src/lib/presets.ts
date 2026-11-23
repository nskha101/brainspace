export type PresetField = {
  key: string
  label: string
  placeholder?: string
  secret?: boolean
  help?: string
  optional?: boolean
}

export type ConnectionPreset = {
  id: string
  name: string
  slug: string
  type: 'mcp' | 'http' | 'slack' | 'gdrive'
  url: string
  authType: 'none' | 'bearer' | 'headers' | 'oauth'
  /** Alternative auth the preset also supports (e.g. API key instead of OAuth). */
  altAuthType?: 'bearer'
  description: string
  domain: string
  /** Credential fields collected when authType is bearer/headers, or static OAuth client. */
  fields?: PresetField[]
  /** OAuth servers without dynamic registration need a pre-registered app. */
  needsOAuthClient?: boolean
  setup?: string
  instructions?: string
  /** OAuth scopes to request. Without it the client asks for everything the server lists. */
  oauthScope?: string
  /** Default for "Who signs in" when the connection uses OAuth. */
  credentialMode?: 'shared' | 'per_user'
}

export const PRESETS: ConnectionPreset[] = [
  {
    id: 'slack',
    name: 'Slack',
    slug: 'slack',
    type: 'slack',
    url: 'https://slack.com',
    authType: 'oauth',
    altAuthType: 'bearer',
    domain: 'slack.com',
    description: 'Post messages and files to channels and DMs from flows and agents, as the Brainspace app.',
    fields: [
      {
        key: 'token',
        label: 'Bot token',
        placeholder: 'xoxb-...',
        secret: true,
        help: 'From your own Slack app: OAuth & Permissions → Bot User OAuth Token.',
      },
    ],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    slug: 'posthog',
    type: 'mcp',
    url: 'https://mcp.posthog.com/mcp',
    authType: 'bearer',
    domain: 'posthog.com',
    description: 'Product analytics, feature flags, experiments, session replay and error tracking.',
    fields: [
      {
        key: 'token',
        label: 'Personal API key',
        placeholder: 'phx_...',
        secret: true,
        help: 'PostHog → Settings → Personal API keys. Pick the "MCP Server" preset scope.',
      },
    ],
    instructions: 'Use for product analytics questions. Prefer saved insights before writing new HogQL.',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    slug: 'hubspot',
    type: 'mcp',
    url: 'https://mcp.hubspot.com',
    authType: 'oauth',
    domain: 'hubspot.com',
    description: 'CRM contacts, companies, deals, tickets and engagement history.',
    needsOAuthClient: true,
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'xxxxxxxx-xxxx-...' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
    setup:
      'HubSpot has no dynamic client registration. In your HubSpot developer account create an "MCP auth app", add the redirect URL shown below, then paste its client ID and secret here.',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    slug: 'gdrive',
    type: 'gdrive',
    url: 'https://www.googleapis.com/drive/v3',
    authType: 'oauth',
    domain: 'drive.google.com',
    description: 'Search and read Docs, Sheets, Slides, PDFs and other files in Google Drive, and create new ones.',
    needsOAuthClient: true,
    credentialMode: 'per_user',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: '1234-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
    setup:
      'Bring your own Google OAuth client. In a Google Cloud project, enable the Google Drive API, set up the consent screen under Google Auth Platform (Internal keeps it to your Google Workspace), and add the drive.readonly and drive.file scopes under Data Access. Then create a "Web application" OAuth client, add the redirect URL shown below, and paste its client ID and secret here.',
    instructions:
      'Use to find and read files in Google Drive. Search with search_files, then read_file_content. Each person sees only what their own Drive can open. Brainspace can create files but only change the ones it created. Ask before creating files.',
  },
  {
    id: 'context-dev',
    name: 'Context.dev',
    slug: 'context',
    type: 'mcp',
    url: 'https://mcp.context.dev/mcp',
    authType: 'bearer',
    altAuthType: 'bearer',
    domain: 'context.dev',
    description: 'Web search, scraping, crawling, brand data (logos, colors, fonts) and company enrichment.',
    fields: [
      {
        key: 'token',
        label: 'API key',
        placeholder: 'ctxt_...',
        secret: true,
        help: 'context.dev dashboard → API keys.',
      },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    slug: 'linear',
    type: 'mcp',
    url: 'https://mcp.linear.app/mcp',
    authType: 'oauth',
    domain: 'linear.app',
    description: 'Issues, projects, cycles and docs.',
  },
  {
    id: 'notion',
    name: 'Notion',
    slug: 'notion',
    type: 'mcp',
    url: 'https://mcp.notion.com/mcp',
    authType: 'oauth',
    domain: 'notion.so',
    description: 'Pages, databases and search across your Notion workspace.',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    slug: 'sentry',
    type: 'mcp',
    url: 'https://mcp.sentry.dev/mcp',
    authType: 'oauth',
    domain: 'sentry.io',
    description: 'Errors, issues, releases and performance data.',
  },
  {
    id: 'github',
    name: 'GitHub',
    slug: 'github',
    type: 'mcp',
    url: 'https://api.githubcopilot.com/mcp/',
    authType: 'bearer',
    domain: 'github.com',
    description: 'Repositories, issues, pull requests and code search.',
    fields: [
      {
        key: 'token',
        label: 'Personal access token',
        placeholder: 'github_pat_...',
        secret: true,
        help: 'Fine-grained token with the repo permissions your agents need.',
      },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    slug: 'stripe',
    type: 'mcp',
    url: 'https://mcp.stripe.com',
    authType: 'bearer',
    domain: 'stripe.com',
    description: 'Customers, subscriptions, invoices and payments.',
    fields: [
      {
        key: 'token',
        label: 'Restricted API key',
        placeholder: 'rk_live_...',
        secret: true,
        help: 'Use a restricted key with only the permissions agents need.',
      },
    ],
  },
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare Docs',
    slug: 'cfdocs',
    type: 'mcp',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    authType: 'none',
    domain: 'cloudflare.com',
    description: 'Search Cloudflare developer documentation. No credentials needed.',
  },
  {
    id: 'custom-mcp',
    name: 'Custom MCP server',
    slug: '',
    type: 'mcp',
    url: '',
    authType: 'bearer',
    domain: '',
    description: 'Any remote MCP server over Streamable HTTP or SSE.',
  },
  {
    id: 'custom-http',
    name: 'HTTP API',
    slug: '',
    type: 'http',
    url: '',
    authType: 'headers',
    domain: '',
    description: 'Give agents a scoped request tool for any REST API. Credentials stay on the server.',
  },
]

export function presetById(id: string | null | undefined) {
  return PRESETS.find((p) => p.id === id)
}

export function logoUrl(domain: string) {
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : ''
}
