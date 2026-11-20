/**
 * Builds the document an artifact runs in. The page's own HTML goes inside a
 * frame with no origin, behind a policy that blocks every network request
 * except scripts, styles and fonts from a few public CDNs. So whatever the page
 * reads through `brain` can be shown to the person looking at it and nothing
 * else: there is nowhere to send it.
 */

/**
 * What makes an .html doc an artifact: this tag in the page. Without it the doc
 * is a plain HTML file (an email template, an export) and is shown as code.
 */
export const ARTIFACT_MARKER = '<meta name="brainspace" content="artifact">'

/** The value of one attribute in a tag's source, quoted or not. */
export const tagAttr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined)

export function isArtifactHtml(html: string | null | undefined) {
  if (!html) return false
  // The tag belongs in <head>, so the start of the page is enough to look at.
  return (html.slice(0, 20_000).match(/<meta\b[^>]*>/gi) ?? []).some(
    (tag) => tagAttr(tag, 'name')?.toLowerCase() === 'brainspace' && tagAttr(tag, 'content')?.toLowerCase() === 'artifact',
  )
}

/** Hosts a page may load libraries from. Keep in step with the brainspace-artifacts skill. */
export const ARTIFACT_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://esm.sh', 'https://cdn.tailwindcss.com']

const FONTS_CSS = 'https://fonts.googleapis.com'
const FONTS_FILES = 'https://fonts.gstatic.com'

const CSP = [
  "default-src 'none'",
  // 'unsafe-eval' is for libraries that compile templates or JSX in the page. The frame has no origin, so it gains nothing.
  `script-src 'unsafe-inline' 'unsafe-eval' ${ARTIFACT_CDNS.join(' ')}`,
  `style-src 'unsafe-inline' ${ARTIFACT_CDNS.join(' ')} ${FONTS_CSS}`,
  `font-src data: ${ARTIFACT_CDNS.join(' ')} ${FONTS_FILES}`,
  // No remote images: an image URL is the easiest way to send data out.
  'img-src data: blob:',
  'media-src data: blob:',
  // Only what the page already holds (a blob from brain.file(), a data: URL), never the network.
  'connect-src data: blob:',
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** What the frame may do. No same-origin, popups, top navigation or downloads. */
export const ARTIFACT_SANDBOX = 'allow-scripts allow-forms allow-modals'

const BASE_CSS = `:root{--brain-font:'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif;--brain-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;--brain-paper:#f6f5f8;--brain-sheet:#fff;--brain-ink:#1a1820;--brain-ink-2:#4a4655;--brain-ink-3:#807b8c;--brain-line:#e4e1ea;--brain-wash:#eeecf2;--brain-brand:#d6246e;--brain-brand-ink:#a8124f;--brain-brand-wash:#fbe8f0;--brain-agent:#0f7b83;--brain-danger:#c2341b;--brain-ok:#2f7d3b}
html{color-scheme:light}
body{font-family:var(--brain-font);color:var(--brain-ink);background:var(--brain-sheet);line-height:1.5}`

// Runs inside the frame before the page's own code. Plain ES5-style JavaScript, kept as a string.
const SDK = `(function(){
var host=window.parent,seq=0,waiting={},listeners=[];
function send(method,args){return new Promise(function(resolve,reject){var id=++seq;waiting[id]={resolve:resolve,reject:reject};host.postMessage({__brain:1,id:id,method:method,args:args||{}},'*')})}
window.addEventListener('message',function(e){
  if(e.source!==host)return;var m=e.data;if(!m||m.__brain!==1)return;
  if(m.event==='change'){listeners.slice().forEach(function(fn){try{fn(m.detail)}catch(err){console.error(err)}});return}
  var w=waiting[m.id];if(!w)return;delete waiting[m.id];
  if(m.ok)w.resolve(m.result);else w.reject(new Error(m.error))
});
function objects(r){return r.rows.map(function(row){var o={};r.columns.forEach(function(c,i){o[c]=row[i]});return o})}
var init=__INIT__;
window.brain={
  user:init.user,
  artifact:init.artifact,
  db:{
    query:function(path,sql,params){return send('db.query',{path:path,sql:sql,params:params}).then(objects)},
    exec:function(path,sql,params){return send('db.exec',{path:path,sql:sql,params:params})},
    batch:function(path,statements){return send('db.batch',{path:path,statements:statements})},
    insert:function(path,table,rows,opts){return send('db.insert',{path:path,table:table,rows:rows,opts:opts})},
    schema:function(path){return send('db.schema',{path:path})}
  },
  read:function(path){return send('read',{path:path})},
  file:function(path){return send('file',{path:path}).then(function(r){return URL.createObjectURL(r.blob)})},
  open:function(target){return send('open',{target:String(target)})},
  download:function(name,content,type){return send('download',{name:String(name),content:content,type:type})},
  onChange:function(fn){listeners.push(fn);return function(){listeners=listeners.filter(function(f){return f!==fn})}}
};
function report(message){try{host.postMessage({__brain:1,type:'error',message:String(message)},'*')}catch(e){}}
window.addEventListener('error',function(e){report(e.message||'Script error')});
window.addEventListener('unhandledrejection',function(e){report(e.reason&&e.reason.message||e.reason||'Unhandled promise rejection')});
document.addEventListener('click',function(e){
  if(e.defaultPrevented)return;
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;
  var href=a.getAttribute('href')||'';if(href.charAt(0)==='#')return;
  e.preventDefault();
  if(/^(https?:|mailto:)/i.test(href)||!/^[a-z][a-z0-9+.-]*:/i.test(href))window.brain.open(href).catch(function(err){report(err.message)});
});
})();`

export type ArtifactInit = {
  user: { name: string }
  artifact: { path: string; name: string; version: number }
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
/** JSON that can sit inside a <script> without ending it. */
const inScript = (v: unknown) =>
  JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

export function buildArtifactDocument(html: string, init: ArtifactInit) {
  // The policy has to come before anything the page brings. The page's own
  // <!doctype>, <html> and <head> tags after this point are merged in by the parser.
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${attr(CSP)}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<link rel="stylesheet" href="${FONTS_CSS}/css2?family=Hanken+Grotesk:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">` +
    `<style>${BASE_CSS}</style>` +
    `<script>${SDK.replace('__INIT__', () => inScript(init))}</script>\n` +
    html
  )
}
