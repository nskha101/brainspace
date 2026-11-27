import puppeteer from '@cloudflare/puppeteer'
import { getEnv } from '../env'
import { AppError, invalid } from '../errors'

/** Space files inside a page load from this host: https://space.local/team/brand/logo.svg */
export const SPACE_HOST = 'space.local'

const MAX_HTML = 8_000_000
const FORMATS = ['letter', 'legal', 'tabloid', 'a3', 'a4', 'a5'] as const
type Format = (typeof FORMATS)[number]

export type PdfOptions = {
  format?: string
  landscape?: boolean
  /** CSS lengths, like "12mm". Left out, the page's own @page margins apply. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string }
  /** Hosts the page may load from, as in uses.network. */
  allowHost: (host: string) => boolean
  /** A file in the space, or null when the flow may not read it or it isn't there. */
  loadFile: (path: string) => Promise<{ data: ArrayBuffer; mimeType: string | null } | null>
}

export type PdfResult = { data: ArrayBuffer; pages: number | null; blocked: string[] }

/**
 * Print HTML to a PDF in a headless browser. The page loads nothing except
 * data: URLs, hosts the caller allows, and space files under SPACE_HOST, so a
 * flow can't use a page to reach hosts outside its uses.network.
 */
export async function renderPdf(html: string, opts: PdfOptions): Promise<PdfResult> {
  if (typeof html !== 'string' || !html.trim()) throw invalid('brain.pdf needs the page as an HTML string.')
  if (html.length > MAX_HTML) throw new AppError('too_large', 'That page is over 8 MB of HTML.', { hint: 'Load big images from the space (https://space.local/team/...) instead of inlining them.' })
  const format = String(opts.format ?? 'letter').toLowerCase() as Format
  if (!FORMATS.includes(format)) throw invalid(`"${opts.format}" isn't a paper size.`, `Use one of ${FORMATS.join(', ')}.`)
  const binding = getEnv().BROWSER
  if (!binding) throw new AppError('upstream', 'PDF rendering is not available in this environment.')

  const blocked = new Set<string>()
  const browser = await puppeteer.launch(binding)
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      void (async () => {
        const raw = req.url()
        if (/^(data|blob|about):/i.test(raw)) return req.continue()
        let url: URL
        try {
          url = new URL(raw)
        } catch {
          return req.abort('blockedbyclient')
        }
        if (url.hostname === SPACE_HOST) {
          const file = await opts.loadFile(decodeURIComponent(url.pathname)).catch(() => null)
          if (!file) {
            blocked.add(`${SPACE_HOST}${url.pathname}`)
            return req.respond({ status: 404, body: 'Not found' })
          }
          return req.respond({
            status: 200,
            contentType: file.mimeType ?? 'application/octet-stream',
            // Fonts are fetched cross-origin from the blank page the HTML is set on.
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: Buffer.from(file.data),
          })
        }
        if (url.protocol === 'https:' && opts.allowHost(url.hostname.toLowerCase())) return req.continue()
        blocked.add(url.hostname)
        return req.abort('blockedbyclient')
      })().catch(() => {})
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 90_000 })
    // Fonts and images referenced from CSS start loading after `load`.
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 }).catch(() => {})
    await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    const pdf = await page.pdf({
      format,
      landscape: !!opts.landscape,
      printBackground: true,
      preferCSSPageSize: true,
      ...(opts.margin ? { margin: opts.margin } : {}),
    })
    const bytes = new Uint8Array(pdf)
    return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, pages: countPages(bytes), blocked: [...blocked].slice(0, 50) }
  } finally {
    await browser.close().catch(() => {})
  }
}

/** Chrome writes page objects uncompressed, so counting them is enough. Null if none are found. */
function countPages(bytes: Uint8Array) {
  const text = new TextDecoder('latin1').decode(bytes)
  const n = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0
  return n || null
}
