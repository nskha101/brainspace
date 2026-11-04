/**
 * The `brainspace` module that flow code imports. Flow code runs in a sandbox:
 * every call below goes back into Brainspace, limited to what FLOW.md declares
 * under `uses`. Brain, connection and AI calls must happen inside step.do().
 */
declare module 'brainspace' {
  export interface StepConfig {
    retries?: { limit: number; delay: string | number; backoff?: 'constant' | 'linear' | 'exponential' }
    timeout?: string | number
  }

  export interface Step {
    /** A durable step. Its result is saved and it never runs again once it succeeds. Names must be unique and stable. */
    do<T>(name: string, fn: () => Promise<T> | T): Promise<T>
    do<T>(name: string, config: StepConfig, fn: () => Promise<T> | T): Promise<T>
    /** Pause without using compute, e.g. "2 hours" or "3 days". */
    sleep(name: string, duration: string | number): Promise<void>
    sleepUntil(name: string, when: Date | string | number): Promise<void>
  }

  export interface Entry {
    id: string
    path: string
    name: string
    drive: 'team' | 'me'
    kind: 'folder' | 'doc' | 'file'
    mimeType: string | null
    size: number
    version: number
    description: string | null
    createdAt: number
    updatedAt: number
    updatedBy: string
  }

  export interface Doc extends Entry {
    /** Text docs. */
    content?: string
    currentVersion: number
    /** Binary files: a link valid for an hour. */
    downloadUrl?: string
    /** PDFs and Office files: the text Brainspace extracted. PDF pages are marked <!-- page N -->. */
    text?: { status: 'done' | 'pending' | 'failed'; content?: string; pages?: number | null; chars?: number; error?: string | null }
    /** Folders. */
    entries?: Entry[]
    error?: string
  }

  export interface SearchHit {
    id: string
    path: string
    name: string
    kind: 'folder' | 'doc' | 'file'
    drive: 'team' | 'me'
    version: number
    updatedAt: number
    snippet: string
    score: number
    matchedBy: ('keyword' | 'semantic')[]
  }

  export interface Brain {
    read(path: string, opts?: { version?: number; offset?: number; limit?: number }): Promise<Doc>
    /** Up to 50 paths. A path that fails comes back with `error` set instead of throwing. */
    readMany(paths: string[]): Promise<Doc[]>
    list(path: string, opts?: { depth?: number; limit?: number }): Promise<{ folder: Partial<Entry>; entries: Entry[]; truncated: boolean }>
    /** Hybrid keyword and meaning search, limited to the paths the flow may read. */
    search(query: string, opts?: { limit?: number; pathPrefix?: string; mode?: 'hybrid' | 'keyword' | 'semantic' }): Promise<SearchHit[]>
    /** Each write is a new version, credited to the flow and the person it runs as. */
    write(path: string, content: string, opts?: { message?: string; baseVersion?: number; description?: string }): Promise<{ path: string; version: number }>
    edit(
      path: string,
      edits: { oldText: string; newText: string; replaceAll?: boolean }[],
      opts?: { message?: string; baseVersion?: number },
    ): Promise<{ path: string; version: number }>
    append(path: string, text: string, opts?: { message?: string }): Promise<{ path: string; version: number }>
    /** data: base64 string or bytes. */
    upload(
      path: string,
      data: string | ArrayBuffer | Uint8Array,
      opts?: { mimeType?: string; description?: string; message?: string },
    ): Promise<{ path: string; version: number }>
    /** A team skill's instructions, e.g. brand-voice. */
    skill(name: string): Promise<{ name: string; description: string; content: string }>
  }

  export interface Connections {
    /** Call a connected service's tool. JSON results are parsed; otherwise you get the text. */
    call<T = any>(connection: string, tool: string, args?: Record<string, unknown>): Promise<T>
    /** Find a connection's tools by task. */
    tools(connection: string, query?: string): Promise<any>
  }

  export interface AiOptions {
    /** AI Gateway model id. Defaults to FLOW.md `model`, then the workspace default. */
    model?: string
    /** Extra system instructions. */
    system?: string
    /** Load a team skill as instructions, e.g. "brand-voice". */
    skill?: string
    /** Anything the model should see: objects are sent as JSON. */
    context?: unknown
    maxTokens?: number
    temperature?: number
  }

  export interface AI {
    /** Write text (markdown by default). */
    write(opts: AiOptions & { task: string; format?: 'markdown' | 'text' }): Promise<string>
    /** Structured extraction. `schema` is a JSON schema; the result matches it. */
    extract<T = any>(opts: AiOptions & { input: unknown; schema: Record<string, unknown>; task?: string }): Promise<T>
    /** Pick one label. */
    classify<L extends string>(opts: AiOptions & { input: unknown; labels: L[]; task?: string }): Promise<{ label: L; reason: string }>
    chat(opts: AiOptions & { prompt?: string; messages?: { role: 'user' | 'assistant'; content: string }[] }): Promise<{ text: string; model: string; tokens: number }>
  }

  export interface Approval {
    approved: boolean
    by: string | null
    note: string | null
    timedOut: boolean
  }

  export interface Log {
    (message: string, data?: unknown): void
    warn(message: string, data?: unknown): void
    error(message: string, data?: unknown): void
  }

  export interface RunInfo {
    id: string
    /** True for flow_test runs: writes and deliveries are recorded, not made. */
    test: boolean
    flow: string
    trigger: { id: string; name: string; kind: 'manual' | 'schedule' | 'webhook' } | null
    startedAt: number
  }

  export interface FlowContext<I = any> {
    inputs: I
    step: Step
    brain: Brain
    connections: Connections
    ai: AI
    /** Wait for a person to approve. Shows in the app and emails the person the run acts as. */
    approve(opts: { title: string; summary?: string; preview?: unknown; timeout?: string }): Promise<Approval>
    log: Log
    run: RunInfo
    /** Same as the exported secret(). */
    secret(name: string): string
  }

  /**
   * A placeholder for a secret declared in `uses.secrets`. Use it in a fetch URL,
   * header or body: Brainspace swaps in the real value on the way out, only for
   * the hosts the secret is bound to. Flow code never sees the value, and the
   * placeholder is useless anywhere else.
   *
   *   fetch(`https://api.example.com/v1/x?key=${secret('EXAMPLE_KEY')}`)
   *   fetch(url, { headers: { Authorization: `Bearer ${secret('EXAMPLE_KEY')}` } })
   */
  export function secret(name: string): string

  /** The flow's return value is its outputs: keys should match `outputs` in FLOW.md. */
  export function defineFlow<I = any>(fn: (ctx: FlowContext<I>) => Promise<Record<string, unknown> | void>): unknown
}
