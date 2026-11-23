/**
 * Google Drive: a built-in connection whose tools run here against the Drive
 * REST API, with a Google OAuth client the workspace brings. Each person
 * usually connects their own Drive, so calls run as them.
 *
 * Kept free of D1 and Worker imports so it can be exercised with a stub fetch.
 */
import { AppError, invalid } from '../errors'
import type { CachedTool, Json } from '../db/app-schema'

export const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Read everything, and change only files Brainspace created. */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file']

const MIME = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
  shortcut: 'application/vnd.google-apps.shortcut',
  pdf: 'application/pdf',
}

/** Office and PDF types the parser turns into markdown, by MIME type. */
const PARSE_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/epub+zip': 'epub',
}

const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|sql|x-sh|csv|x-ndjson)\b)/
const TEXT_DOWNLOAD_LIMIT = 10 * 1024 * 1024
const PARSE_DOWNLOAD_LIMIT = 50 * 1024 * 1024
const UPLOAD_LIMIT = 100 * 1024 * 1024
const LIST_FIELDS = 'id,name,mimeType,modifiedTime,size,webViewLink,parents,owners(displayName,emailAddress),shortcutDetails'
const FILE_FIELDS =
  'id,name,mimeType,description,size,createdTime,modifiedTime,viewedByMeTime,webViewLink,parents,driveId,shared,starred,trashed,' +
  'owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),shortcutDetails,capabilities(canEdit,canDownload)'

type Fetch = typeof fetch
type Obj = Record<string, any>

// ---------------------------------------------------------------------------
// Errors

export class DriveApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message)
  }
}

async function apiError(res: Response) {
  const j = (await res.json().catch(() => null)) as Obj | null
  const e = j?.error ?? {}
  const reason = String(e.errors?.[0]?.reason ?? e.details?.find?.((d: Obj) => d.reason)?.reason ?? e.status ?? `http_${res.status}`)
  return new DriveApiError(res.status, reason, String(e.message ?? `HTTP ${res.status}`))
}

/** Turn a Drive error into something an agent (or the person reading a run) can act on. */
export function driveFailure(err: unknown, reconnectHint: string, file?: string): Error {
  if (!(err instanceof DriveApiError)) return err as Error
  const what = file ? ` ${file}` : ''
  if (err.status === 401) {
    return new AppError('unauthorized', 'Google rejected the Drive sign-in. It may have been revoked or expired.', { hint: reconnectHint })
  }
  if (err.reason === 'accessNotConfigured' || err.reason === 'SERVICE_DISABLED') {
    return new AppError('upstream', "The Google Drive API isn't turned on in the Google Cloud project behind this connection.", {
      hint: 'In Google Cloud, open APIs & Services → Library, enable the Google Drive API in the project that owns the OAuth client, then try again.',
    })
  }
  if (err.reason === 'insufficientPermissions' || err.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || err.reason === 'insufficientScopes') {
    return new AppError('forbidden', "The Drive sign-in doesn't include the permission this needs.", {
      hint: `${reconnectHint} Leave every Drive permission ticked on Google's consent screen.`,
    })
  }
  if (err.reason === 'appNotAuthorizedToFile' || err.reason === 'appNotAuthorizedToChild') {
    return new AppError('forbidden', `Brainspace can read${what} but can only change files and folders it created.`, {
      hint: 'Create a new file with create_file, or put it in a folder Brainspace made.',
    })
  }
  if (err.status === 404 || err.reason === 'notFound') {
    return new AppError('not_found', `Google Drive couldn't find the file${what}, or this account can't see it.`, {
      hint: 'Check the ID with search_files. Each person sees only what their own Drive can open.',
    })
  }
  if (err.reason === 'exportSizeLimitExceeded') {
    return new AppError('too_large', `That file is too big for Google to export${what}.`, { hint: 'Open it in Drive with the webViewLink instead.' })
  }
  if (err.status === 429 || err.reason === 'userRateLimitExceeded' || err.reason === 'rateLimitExceeded') {
    return new AppError('upstream', 'Google Drive is rate limiting this account right now.', { hint: 'Wait a minute and try again.' })
  }
  if (err.status === 403) return new AppError('forbidden', `Google Drive refused${what}: ${err.message}`)
  if (err.status === 400) return invalid(`Google Drive rejected the request: ${err.message}`)
  return new AppError('upstream', `Google Drive failed (${err.status} ${err.reason}): ${err.message}`)
}

// ---------------------------------------------------------------------------
// OAuth

export type GoogleTokens = { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string }
type OAuthClient = { clientId: string; clientSecret: string }

export function googleAuthorizeUrl(clientId: string, redirectUri: string, state: string, scope = DRIVE_SCOPES.join(' ')) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', scope)
  u.searchParams.set('state', state)
  // Without offline access there's no refresh token, and the connection dies after an hour.
  // Google only sends one on a fresh consent, hence prompt=consent.
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  return u.toString()
}

async function tokenRequest(client: OAuthClient, params: Record<string, string>, f: Fetch) {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params }).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  const j = (await res.json().catch(() => null)) as Obj | null
  return { ok: res.ok && !!j?.access_token, status: res.status, j: j ?? {} }
}

function toTokens(j: Obj): GoogleTokens {
  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
    expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000,
    scope: j.scope ? String(j.scope) : undefined,
  }
}

/** Swap the code from Google's redirect for tokens. */
export async function exchangeGoogleCode(client: OAuthClient, code: string, redirectUri: string, f: Fetch = fetch) {
  const r = await tokenRequest(client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, f)
  if (!r.ok) {
    const why = r.j.error_description || r.j.error || `HTTP ${r.status}`
    const hint =
      r.j.error === 'invalid_client' || r.j.error === 'unauthorized_client'
        ? 'Check the client ID and secret on the connection, and that the OAuth client is a "Web application".'
        : r.j.error === 'redirect_uri_mismatch'
          ? `Add ${redirectUri} to the OAuth client's authorized redirect URIs.`
          : 'Start connecting Google Drive again.'
    throw new AppError('upstream', `Google didn't finish the sign-in: ${why}.`, { hint })
  }
  return toTokens(r.j)
}

/** Get a fresh access token. Throws "unauthorized" when Google has revoked the grant. */
export async function refreshGoogleToken(client: OAuthClient, refreshToken: string, reconnectHint: string, f: Fetch = fetch) {
  const r = await tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken }, f)
  if (!r.ok) {
    if (r.j.error === 'invalid_grant' || r.j.error === 'invalid_client' || r.j.error === 'unauthorized_client') {
      throw new AppError('unauthorized', `Google won't renew the Drive sign-in (${r.j.error}). It was revoked, or the OAuth client changed.`, { hint: reconnectHint })
    }
    throw new AppError('upstream', `Google couldn't renew the Drive sign-in: ${r.j.error_description || r.j.error || `HTTP ${r.status}`}.`)
  }
  return { ...toTokens(r.j), refreshToken: (r.j.refresh_token as string | undefined) ?? refreshToken }
}

/** Whose Drive a token opens. */
export async function driveAccount(accessToken: string, f: Fetch = fetch): Promise<{ email?: string; name?: string }> {
  const res = await f(`${DRIVE_API}/about?fields=user(displayName,emailAddress)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw await apiError(res)
  const j = (await res.json()) as Obj
  return { email: j.user?.emailAddress, name: j.user?.displayName }
}

// ---------------------------------------------------------------------------
// Tool definitions

const fileIdArg = { type: 'string', description: 'The Drive file ID, from search_files, or a Drive/Docs URL.' }

const TOOLS: Omit<CachedTool, 'exposedName'>[] = [
  {
    name: 'search_files',
    title: 'Search files',
    description:
      'Find files in Google Drive, including shared drives, by words in their content or name, by type, or inside a folder. Returns IDs to pass to read_file_content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for in the file content and name.' },
        name: { type: 'string', description: 'Only files whose name contains this.' },
        type: {
          type: 'string',
          enum: ['doc', 'sheet', 'slides', 'pdf', 'folder'],
          description: 'Only Google Docs, Sheets, Slides, PDFs or folders.',
        },
        folderId: { type: 'string', description: 'Only files directly inside this folder (ID or URL). Pass it alone to list a folder.' },
        modifiedAfter: { type: 'string', description: 'Only files changed after this date, e.g. 2026-01-31.' },
        q: { type: 'string', description: "Advanced: a raw Drive query, e.g. \"'me' in owners\". Combined with the other filters." },
        limit: { type: 'number', description: 'Most files to return (default 25, max 100).' },
        pageToken: { type: 'string', description: 'nextPageToken from the previous call, for more results.' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'list_recent_files',
    title: 'List recent files',
    description: 'List the files this person opened or changed most recently in Google Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['doc', 'sheet', 'slides', 'pdf', 'folder'] },
        limit: { type: 'number', description: 'Most files to return (default 25, max 100).' },
        pageToken: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'get_file_metadata',
    title: 'Get file details',
    description: 'Details of one Drive file: name, type, owner, who changed it last and when, size, folder and link.',
    inputSchema: { type: 'object', properties: { fileId: fileIdArg }, required: ['fileId'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'read_file_content',
    title: 'Read a file',
    description:
      'Read a Drive file as text. Google Docs come back as Markdown, Sheets as CSV (or Markdown with every tab, when the workspace can parse files), Slides as plain text. PDFs and Office files are converted to Markdown when the workspace can parse files; text files come back as they are.',
    inputSchema: { type: 'object', properties: { fileId: fileIdArg }, required: ['fileId'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'create_file',
    title: 'Create a file',
    description:
      'Create a file in Google Drive: a Google Doc from Markdown, a Google Sheet from CSV, or a plain file. Pass content, or path to copy a file from Brainspace. Brainspace can later change only the files it created.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name in Drive. Defaults to the Brainspace file name when you pass path.' },
        content: { type: 'string', description: 'The text: Markdown for a doc, CSV for a sheet.' },
        path: { type: 'string', description: 'A Brainspace file or doc to copy into Drive, e.g. /team/reports/q3.pdf.' },
        as: {
          type: 'string',
          enum: ['doc', 'sheet', 'file'],
          description: 'doc: a Google Doc (default for content). sheet: a Google Sheet from CSV. file: keep it as is (default for path).',
        },
        folderId: { type: 'string', description: 'Folder to put it in (ID or URL). Defaults to My Drive.' },
        description: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
]

export function driveToolDefs(): Omit<CachedTool, 'exposedName'>[] {
  return TOOLS.map((t) => ({ ...t, inputSchema: t.inputSchema as Record<string, Json> }))
}

// ---------------------------------------------------------------------------
// Running tools

export type DriveDeps = {
  /** A current access token. `fresh` asks for a new one after Google answered 401. */
  token: (fresh?: boolean) => Promise<string>
  /** What to tell an agent when the sign-in is gone. */
  reconnectHint: string
  /** Read a Brainspace file or doc as the caller, checking their access. */
  readFile: (path: string) => Promise<{ name: string; mimeType?: string | null; data: ArrayBuffer }>
  /** Turn a PDF or Office file into Markdown. Returns null when the workspace has no parser. */
  parse?: (bytes: ArrayBuffer, ext: string, mime: string) => Promise<string | null>
  fetch?: Fetch
}

type Ctx = DriveDeps & { f: Fetch }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Accept a bare ID or any Drive/Docs URL that carries one. */
export function fileIdFrom(raw: string) {
  const s = raw.trim()
  const m = s.match(/\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/) ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (m) return m[1]!
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s
  throw invalid(`"${raw}" isn't a Drive file ID or link.`, 'Find the file with search_files and pass its id.')
}

function requiredId(a: Obj, key = 'fileId') {
  const v = str(a[key])
  if (!v) throw invalid(`Pass ${key}.`)
  return fileIdFrom(v)
}

/** Call Drive, getting a new token and trying once more if Google says the token is stale. */
async function call(c: Ctx, url: string, init: RequestInit = {}, timeout = 60_000): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await c.token(attempt > 0)
    const res = await c.f(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    })
    if (res.status === 401 && attempt === 0) continue
    if (!res.ok) throw await apiError(res)
    return res
  }
}

async function getJson(c: Ctx, path: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const u = new URL(`${DRIVE_API}${path}`)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v))
  return (await (await call(c, u.toString())).json()) as Obj
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function typeFilter(t: unknown) {
  if (t === undefined || t === null || t === '') return undefined
  const mime = MIME[t as keyof typeof MIME]
  if (!mime || t === 'shortcut') throw invalid(`type must be one of doc, sheet, slides, pdf, folder.`)
  return `mimeType = ${quote(mime)}`
}

function limitOf(a: Obj) {
  return Math.min(Math.max(Math.floor(Number(a.limit) || 25), 1), 100)
}

function fileSummary(f: Obj) {
  return {
    id: f.id as string,
    name: f.name as string,
    type: typeName(f.mimeType),
    mimeType: f.mimeType as string,
    modifiedTime: f.modifiedTime as string | undefined,
    owner: f.owners?.[0]?.emailAddress as string | undefined,
    size: f.size ? Number(f.size) : undefined,
    link: f.webViewLink as string | undefined,
    ...(f.shortcutDetails?.targetId ? { shortcutTo: f.shortcutDetails.targetId as string } : {}),
  }
}

function typeName(mime: string) {
  for (const [k, v] of Object.entries(MIME)) if (v === mime) return k
  return mime?.startsWith('application/vnd.google-apps.') ? mime.slice('application/vnd.google-apps.'.length) : 'file'
}

async function listFiles(c: Ctx, clauses: string[], params: Record<string, string | number | boolean | undefined>) {
  const j = await getJson(c, '/files', {
    q: ['trashed = false', ...clauses].join(' and '),
    fields: `nextPageToken,incompleteSearch,files(${LIST_FIELDS})`,
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    ...params,
  })
  return {
    files: ((j.files ?? []) as Obj[]).map(fileSummary),
    nextPageToken: (j.nextPageToken as string | undefined) || undefined,
    ...(j.incompleteSearch ? { note: 'Google searched only part of the shared drives. Narrow the search for complete results.' } : {}),
  }
}

async function searchFiles(c: Ctx, a: Obj) {
  const clauses: string[] = []
  const query = str(a.query)
  if (query) clauses.push(`fullText contains ${quote(query)}`)
  const name = str(a.name)
  if (name) clauses.push(`name contains ${quote(name)}`)
  const type = typeFilter(a.type)
  if (type) clauses.push(type)
  if (str(a.folderId)) clauses.push(`${quote(fileIdFrom(a.folderId))} in parents`)
  const after = str(a.modifiedAfter)
  if (after) {
    const d = new Date(after)
    if (Number.isNaN(d.getTime())) throw invalid('modifiedAfter must be a date, e.g. 2026-01-31.')
    clauses.push(`modifiedTime > ${quote(d.toISOString())}`)
  }
  const raw = str(a.q)
  if (raw) clauses.push(`(${raw})`)
  if (!clauses.length) throw invalid('Pass query, name, type, folderId or q.', 'For the latest files, use list_recent_files.')
  // fullText search ranks by relevance and doesn't accept an order.
  const orderBy = query || raw?.includes('fullText') ? undefined : str(a.folderId) ? 'folder,name' : 'modifiedTime desc'
  return listFiles(c, clauses, { pageSize: limitOf(a), pageToken: str(a.pageToken), orderBy })
}

async function listRecent(c: Ctx, a: Obj) {
  const type = typeFilter(a.type)
  return listFiles(c, type ? [type] : [], { pageSize: limitOf(a), pageToken: str(a.pageToken), orderBy: 'recency desc' })
}

async function metadata(c: Ctx, id: string) {
  return getJson(c, `/files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS, supportsAllDrives: true })
}

async function getMetadata(c: Ctx, a: Obj) {
  const f = await metadata(c, requiredId(a))
  return {
    ...fileSummary(f),
    description: f.description || undefined,
    createdTime: f.createdTime,
    viewedByMeTime: f.viewedByMeTime,
    owners: f.owners,
    lastModifiedBy: f.lastModifyingUser,
    parents: f.parents,
    sharedDrive: f.driveId,
    shared: f.shared,
    starred: f.starred,
    trashed: f.trashed,
    canEdit: f.capabilities?.canEdit,
  }
}

async function download(c: Ctx, f: Obj, limit: number) {
  const size = Number(f.size ?? 0)
  if (size > limit) {
    throw new AppError('too_large', `${f.name} is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${limit / 1024 / 1024} MB Brainspace reads.`, {
      hint: `Open it in Drive instead: ${f.webViewLink ?? ''}`.trim(),
    })
  }
  const res = await call(c, `${DRIVE_API}/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`, {}, 120_000)
  return res.arrayBuffer()
}

function exportAs(c: Ctx, id: string, mime: string) {
  return call(c, `${DRIVE_API}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(mime)}`, {}, 120_000)
}

async function readContent(c: Ctx, a: Obj) {
  let f = await metadata(c, requiredId(a))
  if (f.mimeType === MIME.shortcut && f.shortcutDetails?.targetId) f = await metadata(c, f.shortcutDetails.targetId)
  const base = { id: f.id as string, name: f.name as string, mimeType: f.mimeType as string, link: f.webViewLink as string | undefined }
  const mime = String(f.mimeType)

  if (mime === MIME.folder) throw invalid(`${f.name} is a folder.`, 'List what is in it with search_files and folderId.')
  if (mime === MIME.doc) return { ...base, format: 'markdown', text: await (await exportAs(c, f.id, 'text/markdown')).text() }
  if (mime === MIME.slides) return { ...base, format: 'text', text: await (await exportAs(c, f.id, 'text/plain')).text() }
  if (mime === MIME.sheet) {
    // CSV export only carries the first tab. Parsing an .xlsx export gets them all.
    if (c.parse) {
      const xlsx = await (await exportAs(c, f.id, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).arrayBuffer()
      const md = await c.parse(xlsx, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(() => null)
      if (md !== null) return { ...base, format: 'markdown', text: md }
    }
    return { ...base, format: 'csv', note: 'CSV of the first tab only.', text: await (await exportAs(c, f.id, 'text/csv')).text() }
  }
  if (mime.startsWith('application/vnd.google-apps.')) {
    throw invalid(`Brainspace can't read ${typeName(mime)} files from Drive as text.`, base.link ? `Open it in Drive: ${base.link}` : undefined)
  }
  if (TEXT_MIME.test(mime)) {
    return { ...base, format: 'text', text: new TextDecoder().decode(await download(c, f, TEXT_DOWNLOAD_LIMIT)) }
  }
  const ext = PARSE_EXT[mime] ?? (String(f.name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '')
  if (Object.values(PARSE_EXT).includes(ext)) {
    if (!c.parse) {
      throw invalid(`Brainspace can't read ${ext.toUpperCase()} files without a file parser.`, 'Add a Context.dev connection with an API key to read PDFs and Office files.')
    }
    const bytes = await download(c, f, PARSE_DOWNLOAD_LIMIT)
    const md = await c.parse(bytes, ext, mime)
    if (md === null) {
      throw invalid(`Brainspace can't read ${ext.toUpperCase()} files without a file parser.`, 'Add a Context.dev connection with an API key to read PDFs and Office files.')
    }
    return { ...base, format: 'markdown', text: md }
  }
  throw invalid(`Brainspace can't read ${mime} files as text.`, base.link ? `Open it in Drive: ${base.link}` : undefined)
}

const AS_MIME: Record<string, string> = { doc: MIME.doc, sheet: MIME.sheet }

async function createFile(c: Ctx, a: Obj) {
  let data: ArrayBuffer
  let name = str(a.name)
  let mediaType: string
  const path = str(a.path)
  const as = str(a.as) ?? (path ? 'file' : 'doc')
  if (!['doc', 'sheet', 'file'].includes(as)) throw invalid('as must be doc, sheet or file.')
  if (path) {
    const file = await c.readFile(path)
    data = file.data
    name ??= file.name
    mediaType = file.mimeType || 'application/octet-stream'
    if (as === 'doc' && !/^text\/|officedocument\.wordprocessing|msword|rtf|opendocument\.text/.test(mediaType)) {
      throw invalid(`${file.name} can't be turned into a Google Doc.`, 'Pass as: "file" to copy it as it is.')
    }
    if (as === 'sheet' && !/csv|spreadsheet|ms-excel/.test(mediaType)) {
      throw invalid(`${file.name} can't be turned into a Google Sheet.`, 'Pass as: "file" to copy it as it is.')
    }
  } else if (typeof a.content === 'string' && a.content.length) {
    data = new TextEncoder().encode(a.content).buffer as ArrayBuffer
    mediaType = as === 'doc' ? 'text/markdown' : as === 'sheet' ? 'text/csv' : 'text/plain'
  } else {
    throw invalid('Pass content (the text) or path (a Brainspace file).')
  }
  if (!name) throw invalid('Pass name.')
  if (as === 'doc') name = name.replace(/\.(md|markdown|txt|docx?)$/i, '')
  if (as === 'sheet') name = name.replace(/\.(csv|xlsx?)$/i, '')
  if (data.byteLength > UPLOAD_LIMIT) throw new AppError('too_large', `That file is over ${UPLOAD_LIMIT / 1024 / 1024} MB.`)

  const meta: Obj = { name }
  if (AS_MIME[as]) meta.mimeType = AS_MIME[as]
  if (str(a.folderId)) meta.parents = [fileIdFrom(a.folderId)]
  if (str(a.description)) meta.description = str(a.description)

  // A resumable session works for any size, in two requests.
  const start = await call(c, `${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(LIST_FIELDS)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mediaType,
      'X-Upload-Content-Length': String(data.byteLength),
    },
    body: JSON.stringify(meta),
  })
  const session = start.headers.get('Location')
  if (!session) throw new AppError('upstream', "Google Drive didn't start the upload.")
  const put = await c.f(session, { method: 'PUT', headers: { 'Content-Type': mediaType }, body: data, signal: AbortSignal.timeout(300_000) })
  if (!put.ok) throw await apiError(put)
  const created = (await put.json()) as Obj
  return { ok: true, ...fileSummary(created) }
}

// A Map, so a tool name like "constructor" can't reach Object.prototype.
const RUNNERS = new Map<string, (c: Ctx, a: Obj) => Promise<unknown>>([
  ['search_files', searchFiles],
  ['list_recent_files', listRecent],
  ['get_file_metadata', getMetadata],
  ['read_file_content', readContent],
  ['create_file', createFile],
])

export async function runDriveTool(deps: DriveDeps, tool: string, args: Obj) {
  // Workers' fetch throws "Illegal invocation" when called as a method of another object.
  const c: Ctx = { ...deps, f: deps.fetch ?? ((input, init) => fetch(input, init)) }
  const run = RUNNERS.get(tool)
  if (!run) throw invalid(`Google Drive has no tool "${tool}".`, `Use one of: ${TOOLS.map((t) => t.name).join(', ')}.`)
  try {
    return await run(c, args ?? {})
  } catch (err) {
    throw driveFailure(err, deps.reconnectHint, str(args?.fileId))
  }
}
