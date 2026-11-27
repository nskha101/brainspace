/**
 * The `brainspace` module that flow code imports. Flow code runs in a sandbox:
 * every call below goes back into Brainspace, limited to what FLOW.md declares
 * under `uses`. Brain, connection and AI calls must happen inside step.do().
 */
declare module 'brainspace' {
  export interface StepConfig {
    /**
     * One plain sentence on what the step does and why, shown under its name in the app:
     * "Pulls every open deal from HubSpot". Write it as a plain string or template literal
     * in the call itself, so the app can read it from the code.
     */
    description?: string
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
    space: 'team' | 'me'
    kind: 'folder' | 'doc' | 'file' | 'database'
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
    kind: 'folder' | 'doc' | 'file' | 'database'
    space: 'team' | 'me'
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
    /**
     * Print an HTML page to a PDF in a headless browser and save it at `path`
     * (must end in .pdf, under `uses.write`). Backgrounds print, and the page's
     * own `@page` size and margins win over `format` and `margin`.
     *
     * The page can only load data: URLs, https hosts listed in `uses.network`,
     * and files in the space, as `https://space.local/team/brand/logo.svg`
     * (paths the flow may read). Anything else is skipped and listed in
     * `blocked`. A test run renders the page but doesn't save the file.
     */
    pdf(
      path: string,
      html: string,
      opts?: {
        format?: 'letter' | 'legal' | 'tabloid' | 'a3' | 'a4' | 'a5'
        landscape?: boolean
        /** CSS lengths, like "12mm". */
        margin?: { top?: string; right?: string; bottom?: string; left?: string }
        description?: string
        message?: string
      },
    ): Promise<{ path: string; version?: number; pages: number | null; bytes: number; blocked: string[] }>
    /** A team skill's instructions, e.g. brand-voice. */
    skill(name: string): Promise<{ name: string; description: string; content: string }>
  }

  export type DbRow = Record<string, string | number | null>

  /**
   * Databases in the space: SQLite databases at paths ending in .db, for data
   * that runs build up or keep current (customers, what was already processed,
   * a queue). Reads need the path under `uses.read`, writes under `uses.write`.
   * Pass values through `params`, never by building them into the SQL.
   */
  export interface Db {
    /** One SELECT. Returns the rows as objects. Throws if it matches more than 5000 rows: filter, aggregate or page in SQL. */
    query<T = DbRow>(path: string, sql: string, params?: unknown[]): Promise<T[]>
    /** One statement that changes data or the schema. `rows` holds what a RETURNING clause gives back. */
    exec(path: string, sql: string, params?: unknown[]): Promise<{ changes: number; rows: DbRow[] }>
    /** Several statements as one transaction: all apply, or none do. */
    batch(path: string, statements: { sql: string; params?: unknown[] }[]): Promise<{ changes: number; rows: DbRow[] }>
    /**
     * Add rows from objects keyed by column name, up to 5000 a call. With `upsertOn`
     * (key columns with a PRIMARY KEY or UNIQUE constraint), rows that exist are updated.
     */
    insert(
      path: string,
      table: string,
      rows: Record<string, unknown>[],
      opts?: { upsertOn?: string[]; onConflict?: 'error' | 'ignore' },
    ): Promise<{ changes: number; rows: number | null }>
    /** Tables, columns and row counts. */
    schema(path: string): Promise<{
      path: string
      tables: { name: string; rows: number | null; columns: { name: string; type: string; primaryKey?: boolean; notNull?: boolean }[] }[]
    }>
    /** Make the database if it isn't there yet (and run `sql` to set up its tables). Safe to call on every run. */
    create(path: string, opts?: { description?: string; sql?: string }): Promise<{ path: string; created: boolean }>
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

  export type DecisionQuestion =
    | { type: 'yesno'; ask: string }
    /** `choices` is a list of values, or a record of value to what it means. */
    | { type: 'choice'; ask: string; choices: string[] | Record<string, string> }
    /** `levels` are ordered labels, lowest first. */
    | { type: 'score'; ask: string; levels: string[] }

  export interface DecisionAnswer {
    /** yesno: how likely the answer is yes, 0 to 1. */
    probability?: number
    /** choice: the value picked. */
    choice?: string
    /** choice and score: how sure the model is, 0 to 1. */
    confidence?: number
    /** score: where it lands on the levels. */
    score?: number
    [key: string]: unknown
  }

  export interface AI {
    /** Write text (markdown by default). */
    write(opts: AiOptions & { task: string; format?: 'markdown' | 'text' }): Promise<string>
    /** Structured extraction. `schema` is a JSON schema; the result matches it. */
    extract<T = any>(opts: AiOptions & { input: unknown; schema: Record<string, unknown>; task?: string }): Promise<T>
    /** Pick one label. */
    classify<L extends string>(opts: AiOptions & { input: unknown; labels: L[]; task?: string }): Promise<{ label: L; reason: string }>
    /**
     * Ask a decision model typed questions about some input. It doesn't write: each answer is a
     * probability (yesno), a pick with its confidence (choice) or a score. Fast and far cheaper
     * than a model that writes, so use it to route, filter or check before doing real work.
     * `model` defaults to typesafe-ai/jev, whatever the flow's own model is.
     *
     *   const a = await ai.decide({ input: message, questions: { urgent: { type: 'yesno', ask: 'Is this urgent?' } } })
     *   if (a.urgent.probability > 0.7) ...
     */
    decide<Q extends Record<string, DecisionQuestion>>(opts: {
      model?: string
      input: unknown
      context?: unknown
      questions: Q
    }): Promise<{ [K in keyof Q]: DecisionAnswer }>
    chat(opts: AiOptions & { prompt?: string; messages?: { role: 'user' | 'assistant'; content: string }[] }): Promise<{ text: string; model: string; tokens: number }>
  }

  export interface Approval {
    approved: boolean
    by: string | null
    note: string | null
    timedOut: boolean
  }

  export interface Flows {
    /**
     * Run another flow and wait for it to finish. Returns its outputs; throws if it
     * fails or is cancelled. Durable like approve(): call it on its own, never
     * inside step.do(). List the flow under `uses.flows` in FLOW.md. It runs as the
     * same person, in the same mode (a test run's subflows are test runs too), and
     * it may only touch what this flow's own `uses` allows.
     */
    run<O = Record<string, any>>(name: string, inputs?: Record<string, unknown>): Promise<O>
  }

  export interface Bots {
    /**
     * Run a bot and wait for it to finish. Returns what the bot said it did; throws
     * if the run fails or is cancelled. Durable like flows.run(): call it on its own,
     * never inside step.do(). List the bot under `uses.bots` in FLOW.md. The bot acts
     * as its owner, with its own tools and access, not this flow's. `input` is handed
     * to it as data for this run (what changed, what to look at), and only when the
     * flow runs as the bot's owner. A test run records the call without starting the bot.
     */
    run(name: string, input?: unknown): Promise<{ summary: string; runId: string | null; test?: boolean }>
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
    db: Db
    connections: Connections
    ai: AI
    /** Wait for a person to approve. Shows in the app and emails the person the run acts as. */
    approve(opts: { title: string; summary?: string; preview?: unknown; timeout?: string }): Promise<Approval>
    /** Run other flows as steps of this one. */
    flows: Flows
    /** Run bots as steps of this one: an agent where the job needs judgment. */
    bots: Bots
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
