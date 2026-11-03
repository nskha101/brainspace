/** A file to upload and its path relative to the folder it's dropped into. */
export type UploadItem = { file: File; relPath: string }

export const MAX_UPLOAD_FILES = 1000

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*|\.git\/.*|__MACOSX\/.*|node_modules\/.*)$/

export const isJunk = (relPath: string) => JUNK.test(relPath)

type Entry = FileSystemEntry
type DirEntry = FileSystemDirectoryEntry
type FileEntry = FileSystemFileEntry

function readAllEntries(dir: DirEntry): Promise<Entry[]> {
  const reader = dir.createReader()
  const out: Entry[] = []
  return new Promise((resolve, reject) => {
    // readEntries returns results in batches (100 in Chrome) until it returns an empty array.
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(out)
        out.push(...batch)
        next()
      }, reject)
    next()
  })
}

const fileOf = (entry: FileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject))

async function walk(entry: Entry, prefix: string, items: UploadItem[], emptyDirs: string[]) {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name
  if (isJunk(rel)) return
  if (entry.isFile) {
    items.push({ file: await fileOf(entry as FileEntry), relPath: rel })
    return
  }
  if (entry.isDirectory) {
    const children = await readAllEntries(entry as DirEntry)
    const before = items.length
    for (const c of children) await walk(c, rel, items, emptyDirs)
    if (items.length === before && !children.some((c) => c.isDirectory)) emptyDirs.push(rel)
  }
}

/** Files and folders from a drop, keeping folder structure. */
export async function collectFromDrop(dt: DataTransfer): Promise<{ items: UploadItem[]; emptyDirs: string[] }> {
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is Entry => !!e)
  if (!entries.length) {
    return { items: Array.from(dt.files).map((file) => ({ file, relPath: file.name })), emptyDirs: [] }
  }
  const items: UploadItem[] = []
  const emptyDirs: string[] = []
  for (const e of entries) await walk(e, '', items, emptyDirs)
  return { items, emptyDirs }
}

/** Files from an <input type=file>, including folder picks (webkitdirectory). */
export function collectFromInput(files: FileList): UploadItem[] {
  return Array.from(files)
    .map((file) => ({ file, relPath: file.webkitRelativePath || file.name }))
    .filter((i) => !isJunk(i.relPath))
}

/** Upload four at a time. Missing folders are created server-side. */
export async function uploadItems(
  base: string,
  items: UploadItem[],
  onProgress: (done: number) => void,
  opts: { endpoint?: string } = {},
): Promise<{ failed: { path: string; message: string }[] }> {
  const endpoint = opts.endpoint ?? '/api/upload'
  const failed: { path: string; message: string }[] = []
  let done = 0
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++]!
      const fd = new FormData()
      fd.set('file', item.file)
      // The signed-in upload takes a full drive path; upload links take a path relative to their target.
      if (opts.endpoint) fd.set('relPath', item.relPath)
      else fd.set('path', `${base}/${item.relPath}`)
      try {
        const res = await fetch(endpoint, { method: 'POST', body: fd })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          failed.push({ path: item.relPath, message: body.message ?? res.statusText })
        }
      } catch (err) {
        failed.push({ path: item.relPath, message: String((err as Error)?.message ?? err) })
      }
      onProgress(++done)
    }
  }
  // Parallel uploads into the same new folder are safe: the server's ensureFolder
  // recovers from the unique-path race by re-reading the folder another request made.
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker))
  return { failed }
}
