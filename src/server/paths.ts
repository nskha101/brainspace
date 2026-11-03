import type { Actor } from './actor'
import { TEAM } from './actor'
import { invalid } from './errors'

export type DriveAlias = 'team' | 'me'

export type ParsedPath = {
  alias: DriveAlias
  driveId: string
  /** Path inside the drive, always starting with "/". "/" is the drive root. */
  path: string
}

const ALIASES: Record<string, DriveAlias> = {
  team: 'team',
  shared: 'team',
  me: 'me',
  private: 'me',
  my: 'me',
}

/**
 * Brainspace paths start with the drive: "/team/brand/voice.md" for the
 * shared team drive, "/me/notes/todo.md" for your private drive.
 */
export function parsePath(actor: Actor, input: string): ParsedPath {
  let raw = (input ?? '').trim()
  const colon = raw.match(/^(team|me|shared|private):\/?(.*)$/i)
  if (colon) raw = `/${colon[1]}/${colon[2]}`
  if (!raw.startsWith('/')) raw = `/${raw}`
  const parts = raw.split('/').filter(Boolean)
  const first = parts.shift()?.toLowerCase()
  const alias = first ? ALIASES[first] : undefined
  if (!alias) {
    throw invalid(
      `Path "${input}" doesn't start with a drive.`,
      'Start paths with /team/ for the shared team drive or /me/ for your private drive, e.g. /team/brand/voice.md.',
    )
  }
  for (const p of parts) validateName(p)
  return {
    alias,
    driveId: alias === 'team' ? TEAM : actor.userId,
    path: '/' + parts.join('/'),
  }
}

export function validateName(name: string) {
  if (name === '.' || name === '..') throw invalid(`"${name}" is not allowed in a path.`)
  if (name.length > 200) throw invalid('File and folder names must be 200 characters or fewer.')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(name)) throw invalid(`"${name}" contains characters that aren't allowed.`)
}

export function displayPath(actor: Pick<Actor, 'userId'>, driveId: string, path: string) {
  const prefix = driveId === TEAM ? '/team' : driveId === actor.userId ? '/me' : `/user:${driveId}`
  return path === '/' ? prefix : `${prefix}${path}`
}

export function parentOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function joinPath(dir: string, name: string) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

const TEXT_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  jsonl: 'application/jsonl',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  sql: 'text/plain',
  xml: 'application/xml',
  ini: 'text/plain',
  log: 'text/plain',
}

const BINARY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  key: 'application/x-iwork-keynote-sffkey',
  fig: 'application/octet-stream',
}

export function extOf(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** Text docs live in D1 and are editable/versioned as text. Everything else goes to R2. */
export function textMimeFor(name: string): string | undefined {
  const ext = extOf(name)
  if (!ext) return 'text/markdown'
  return TEXT_EXT[ext]
}

export function mimeFor(name: string): string {
  const ext = extOf(name)
  return textMimeFor(name) ?? BINARY_EXT[ext] ?? 'application/octet-stream'
}

export function isTextMime(mime: string) {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/jsonl' ||
    mime === 'application/xml'
  )
}
