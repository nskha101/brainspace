# Flows: design

Status: proposal, not built yet. Date: 2026-11-04.

A flow is a small program that a team member's agent writes and Brainspace runs. Flows run when someone asks, on a schedule, or when a webhook calls them. Each run takes inputs and sends its results to places the team chooses: a doc in a drive, a connected tool like Slack or HubSpot, email, or a webhook.

Flows run on Cloudflare Workflows with Dynamic Workers (the `@cloudflare/dynamic-workflows` library). Every step is durable. A flow can sleep for days or wait for a person to approve something, and it picks up where it left off.

## Why build it this way

Brainspace already has the pieces a flow needs: the team's docs, search, connected tools, and agents that know how to use them. What's missing is a way to make that work repeat without someone opening a chat. "Every Monday, check what our competitors shipped and update the digest" should be something an agent sets up once.

Code flows suit this better than a drag-and-drop builder. Agents write code well, code covers loops and branches without a custom language, and Dynamic Workflows gives code-defined workflows durability for free. People still get a readable description of each flow, because every flow ships with a plain-English `FLOW.md`.

## Concepts

- **Flow.** A folder in a drive containing `FLOW.md` (what it does, its inputs, what it may touch) and `flow.ts` (the code). Flows are drive content, so they get versions, history, restore and promote like every other doc.
- **Trigger.** A saved way to start a flow: a manual preset, a schedule or a webhook. A trigger holds input values and the destinations for results. One flow can have many triggers. For example, the same digest flow can run weekly for competitor A into one folder, and daily for competitor B into Slack.
- **Run.** One execution, backed by one Workflow instance. A run records the exact code version it used, its inputs, each step, its outputs and where they were delivered.
- **Destination.** Where a run's outputs go. Destinations live on the trigger (or on a manual run request), not in the code, so the same flow can deliver to different places.

## Where flows live

Flows mirror skills. A skill is `/team/skills/<name>/SKILL.md`; a flow is `/team/flows/<name>/FLOW.md` plus `flow.ts`. Someone drafts a flow in `/me/flows/`, tests it, and promotes it to `/team/flows/` to share it. Editing a team flow creates a new version, and restoring an old version works the same way it does for docs.

```markdown
---
name: competitor-digest
description: Weekly summary of what competitors shipped, from their news and changelogs.
inputs:
  competitors:
    type: string[]
    description: Competitor domains, like linear.app
    required: true
  since_days:
    type: number
    default: 7
outputs:
  report:
    type: markdown
    description: The digest, one section per competitor
uses:
  connections: [context]
  read: [/team/research/competitors]
  write: [/team/research/digests]
  ai: true
---

# Competitor digest

Searches recent news for each competitor, reads our notes on them in
/team/research/competitors, and writes a digest in our brand voice.
```

```ts
import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, brain, connections, ai }) => {
  const findings = []
  for (const domain of inputs.competitors) {
    const news = await step.do(`news: ${domain}`, () =>
      connections.call('context', 'get-news-search', { query: domain, days: inputs.since_days }),
    )
    const notes = await step.do(`notes: ${domain}`, () =>
      brain.search(domain, { pathPrefix: '/team/research/competitors', limit: 3 }),
    )
    findings.push({ domain, news, notes })
  }
  const report = await step.do('write digest', () =>
    ai.write({ task: 'Write a competitor digest, one section per company.', context: findings, skill: 'brand-voice' }),
  )
  return { report }
})
```

`FLOW.md` frontmatter is YAML, parsed with the `yaml` package. The flat parser that skills use can't read nested inputs.

## What flow code can do

Flow code runs in a sandbox. It can't reach the internet or see any secret. Everything it does goes through the context passed to `defineFlow`:

| Name | What it does |
| --- | --- |
| `inputs` | The validated inputs for this run. |
| `step.do(name, fn, options?)` | A durable step: its result is saved and never runs twice. Retries and timeouts are configurable per step. This is the Workflows `step`. |
| `step.sleep(name, duration)` | Pause for minutes or days without using compute. |
| `approve({ title, summary, preview?, timeout? })` | Ask a person to approve before continuing. Built on `step.waitForEvent`. Returns `{ approved, by, note }`. |
| `brain.read / search / list` | Read the drives, limited to the paths in `uses.read`. |
| `brain.write / edit / append / upload` | Change docs, limited to `uses.write`. Each change is a new version, credited to the flow and the person it runs as. |
| `connections.call(slug, tool, args)` | Call a connected service's tool, limited to `uses.connections`. Credentials stay on the server. |
| `ai.write / ai.extract / ai.classify` | Model calls for writing, structured extraction and labeling. `skill` loads a team skill as instructions. |
| `fetch` | Only for hosts listed in `uses.network`. Everything else is blocked. |
| `log(message, data?)` | A line in the run log. |

The code returns an object whose keys match `outputs`. Destinations deliver those outputs.

Workflows replays code from the top when a run resumes. The skill has to drill this in: side effects go inside `step.do`, step names must be stable from one replay to the next, and code outside steps must not depend on the current time or randomness.

## Runtime architecture

```
          MCP / web / cron / webhook
                     │
                     ▼
 ┌─────────────── Brainspace Worker (host) ─────────────────┐
 │ flows service: validate, create run, start instance      │
 │                                                          │
 │ FLOWS (Workflow binding, class FlowWorkflow)             │
 │   FlowWorkflow.run(event, step)                          │
 │     1. load code for (flowId, codeHash) via LOADER       │
 │     2. dispatchWorkflow → FlowRunner.run in sandbox      │
 │     3. step.do("deliver: …") for each destination        │
 │     4. step.do("finish") writes the run record           │
 │                                                          │
 │ FlowBrain (WorkerEntrypoint, props {workspaceId, flowId})│
 │   read/search/write, connections.call, ai, log, approve  │
 │ FlowOutbound (WorkerEntrypoint): fetch allowlist         │
 └──────────────────────────┬───────────────────────────────┘
                            │ LOADER.get(`flow:${flowId}:${codeHash}`)
                            ▼
 ┌──────── Dynamic Worker (one per flow code version) ─────┐
 │ modules: sdk.js (ours), flow.js (compiled flow.ts)      │
 │ env: { BRAIN: FlowBrain stub }                          │
 │ globalOutbound: FlowOutbound stub                       │
 │ limits: { cpuMs, subRequests }                          │
 │ export class FlowRunner extends WorkflowEntrypoint      │
 └─────────────────────────────────────────────────────────┘
```

Notes on the wiring:

- **One Workflow binding for every flow.** `wrangler.jsonc` gets `worker_loaders: [{ binding: "LOADER" }]` and one workflow, `brainspace-flows`, whose class is `FlowWorkflow`. We subclass `WorkflowEntrypoint` ourselves and call the library's `dispatchWorkflow`, rather than using `createDynamicWorkflowEntrypoint` as it ships. That lets the host run delivery and bookkeeping steps around the user's code, inside the same durable run.
- **The host starts runs, not the sandbox.** The flows service calls `wrapWorkflowBinding({ workspaceId, flowId, codeHash, runId })` and calls `.create({ id: runId, params })` on it. Sandboxed code never gets a Workflow binding, so a flow can't start other runs. Metadata holds routing ids only. The library persists it in the payload, where flow code can read it.
- **Code is pinned per run.** When a flow is saved, `flow.ts` is compiled (types stripped with `ts-blank-space`, and the `brainspace` import rewritten to the injected SDK). The result is stored in R2 at `flows/compiled/<sha256>.js`, which never changes. A run records the hash it started with. A run that sleeps for three days resumes on the code it started with, even if someone edited the flow in between. The Worker Loader id is `flow:<flowId>:<codeHash>`, so isolates are reused across runs of the same version.
- **Run identity uses a signed token.** The `FlowBrain` binding is fixed when the isolate loads, so it only knows the workspace and flow. Per-run context (run id, who it runs as, approved scope) travels in the payload as an HMAC-signed run token, which `FlowBrain` checks on every call. A flow can only act within its own run.
- **Status is reported best-effort.** The SDK wraps `step.do` to report step start and finish to `FlowBrain`, which writes `flow_run_step` rows and publishes a live event to the workspace's `WorkspaceLive` object. The UI then shows steps as they happen. Reports are keyed by step name, so replays don't duplicate rows.
- **Validation runs at save time.** Saving `FLOW.md` or `flow.ts` compiles the code and loads it once, to check that it exports a flow. The result is stored as the flow's status: `ok`, or `invalid` with the error. Agents see the error from `write`, and the UI shows it on the flow page.

## Triggers

| Kind | How it starts | Notes |
| --- | --- | --- |
| Manual | `flow_run` over MCP, or "Run" in the app | Inputs typed in or passed by the agent. Destinations are optional. |
| Schedule | Cron expression plus a timezone | Agents turn "weekdays at 9am Eastern" into `0 9 * * 1-5` and `America/New_York`. Minimum interval is 15 minutes. |
| Webhook | `POST /api/flows/hook/<token>` | The JSON body is validated against the inputs. The token is shown once and stored hashed, like upload links. |
| File event (phase 5) | A file lands in or changes under a folder | "When a PDF arrives in /team/contracts, summarize it." Hooks into the existing change events. |

Scheduling uses one cron trigger on the Worker (`* * * * *`). Each minute it selects triggers with `next_run_at <= now`, starts a run for each one and computes the next time with `croner`. The instance id is `run_<triggerId>_<slot>`, and Workflows rejects duplicate ids, so a slot can't fire twice even if the cron overlaps. After downtime, a trigger runs once to catch up instead of once for every missed slot.

## Destinations

A trigger's `deliver` list says where each output goes:

```json
[
  { "to": "drive", "output": "report", "path": "/team/research/digests/{date}.md", "mode": "new" },
  { "to": "drive", "output": "report", "path": "/team/research/digest-latest.md", "mode": "version" },
  { "to": "connection", "connection": "slack", "tool": "post_message", "args": { "channel": "#growth", "text": "{outputs.report.summary}\n{links.report}" } },
  { "to": "email", "members": ["owner"], "output": "report" },
  { "to": "webhook", "url": "https://hooks.example.com/digest" }
]
```

- **Drive** has three modes: `new` (a fresh file per run), `version` (a new version of one doc, so the doc's history becomes the history of runs) and `append`. Paths accept `{date}`, `{run}`, `{trigger}` and `{inputs.x}`.
- **Connection** calls any connected tool with arguments filled in from outputs and links.
- **Email** goes to workspace members through Resend.
- **Webhook** posts the outputs as JSON, signed with an HMAC header.

Each delivery is its own durable step, so a Slack outage retries that delivery without re-running the flow. Destinations are checked when the trigger is saved: the trigger owner needs write access to drive targets and use of any connection. Every run also keeps its outputs on the run page, whether or not it has destinations.

## Permissions and safety

The model is "a flow can do less than the person it runs as, never more."

- **Runs act as a person.** Scheduled and webhook runs act as the trigger's owner; manual runs act as the person who started them. Activity shows both, for example "competitor-digest (flow), run as Nith". Viewers can see flows and runs but can't start runs or create triggers.
- **Scope comes from `uses`.** `FlowBrain` rejects any read, write, connection or host the flow didn't declare, and its error says what to add to `uses`. Flows can't delete, purge, manage members or change connections in this version.
- **Team flows can't see private drives.** A flow in `/team/flows` can read and write `/team` only. A flow in someone's `/me/flows` runs only for that person and can use their `/me`.
- **Wider scope needs consent again.** A trigger stores a hash of the scope its owner approved. If a later edit widens `uses`, every trigger owned by someone other than the editor pauses, and the owner sees "This flow now asks for HubSpot access" with an approve button. Edits that stay inside the approved scope go through, and each run records which version it used. Without this, a member could edit a flow that an admin scheduled and act with the admin's access.
- **Secrets never enter the sandbox.** Connection credentials, API keys and the run token's signing key all stay on the host. `globalOutbound` sends all `fetch` calls through `FlowOutbound`, which allows only `uses.network` hosts and logs every request.
- **Resource limits.** The defaults are 30 seconds of CPU per step, 200 subrequests per step and 500 steps per run, plus 5 concurrent runs and 2,000 runs a month per workspace. Admins can raise the workspace limits. A run that hits a limit fails with a message saying which one.
- **Test runs.** `flow_test` runs the real code with real reads. Writes and deliveries are captured and shown instead of performed. Connection calls are allowed only for tools the connection marks read-only. Agents test this way before promoting a flow or scheduling it.

## Data model (D1)

```
flow             id, workspace_id, drive_id, folder_path, name, description,
                 manifest_json, code_node_id, code_version, code_hash,
                 status (ok | invalid), error, updated_at
flow_trigger     id, workspace_id, flow_id, kind (manual | schedule | webhook | file),
                 name, cron, timezone, next_run_at, inputs_json, deliver_json,
                 run_as_user_id, approved_scope_hash, enabled, paused_reason,
                 webhook_token_hash, last_run_id, last_status, created_by, created_at
flow_run         id (= Workflow instance id), workspace_id, flow_id, trigger_id,
                 code_hash, flow_version, run_as_user_id, started_by, inputs_json,
                 status (queued | running | waiting | succeeded | failed | cancelled),
                 outputs_json (capped, larger in R2), deliveries_json, error,
                 step_count, started_at, finished_at
flow_run_step    run_id, name, status, attempt, started_at, finished_at, error, preview
flow_run_log     run_id, at, level, message, data_json   (capped per run)
```

The `flow` table is an index. It is rebuilt whenever `FLOW.md` or `flow.ts` changes in a flows folder, the way `node_fts` is kept in step with docs today. Workflow instance state is kept for 7 days (`default_retention`). D1 keeps the long-term run history.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `flows_list` | Team and private flows, their status, last run and next run. |
| `flow_get` | The manifest, triggers, recent runs and validation status. |
| `flow_create` | Creates `FLOW.md` and `flow.ts` in `/me/flows/<name>`, blank or from a template. |
| `flow_templates` | The starter gallery. |
| `flow_test` | A test run with captured side effects. Returns steps, logs, outputs and what would have been delivered. |
| `flow_run` | Starts a run with inputs and optional destinations. Returns the run id. |
| `flow_runs` / `flow_run_get` | Run history, and one run with steps, logs and outputs. |
| `flow_run_cancel` | Stops a running or waiting run. |
| `flow_run_approve` | Approves or rejects a run waiting on `approve()`. |
| `flow_trigger_set` | Creates or updates a schedule, webhook or saved manual preset, with inputs and destinations. |
| `flow_triggers_list` / `flow_trigger_remove` | Manages triggers. |

Editing code uses the existing `write` and `edit` tools. Sharing uses `promote`. Version history uses `history` and `restore_version`. `whoami` gains a short `flows` summary, and runs waiting on the caller's approval show up there too.

## App

- **Flows page** (`/app/flows`). Team and private flows, each with its last run, next run and a Run button. A run opens a form generated from `inputs`.
- **Flow page.** The `FLOW.md` body, scope shown in plain words ("Reads /team/research/competitors, writes /team/research/digests, uses Context.dev"), triggers with a schedule picker and destination editor, and a runs table built on the existing TanStack Table. `flow.ts` opens read-only with syntax highlighting, since agents do most of the editing.
- **Run page.** A live step timeline over the existing WebSocket, plus logs, outputs, deliveries with links to what was written, and an approval panel when the run is waiting.
- **Sidebar and activity.** A "Flows" entry, with a badge for runs waiting on you. Runs and failures show up in the activity feed.

## Skills

- **`brainspace-flows`** (new). How to write a flow: the SDK, the replay rules, `uses` scope, testing with `flow_test`, turning plain-English schedules into cron, choosing destinations, and asking the user before scheduling or promoting. `references/sdk.md` is generated from the SDK types, the same way `tools.md` is generated today.
- **Templates.** A starter gallery that ships with the skill and is available through `flow_create({ template })`:
  - competitor digest (Context.dev)
  - weekly product metrics write-up (PostHog)
  - CRM hygiene report (HubSpot)
  - contract intake: summarize new PDFs in a folder (file trigger)
  - stale doc review: flag team docs untouched for 90 days
  - meeting notes to action items
- **Existing skills.** `brainspace` gets a short Flows section pointing to the new skill. `brainspace-admin` covers pausing triggers, reviewing scope requests and the workspace limits.

## Cost

Workers Paid is already on the account. Dynamic Workers bill per unique (id, code) pair per day, with 1,000 included each month and then $0.002 each. A workspace with 20 flows that each run daily uses about 600 a month. Workflows bill CPU, requests, steps and stored state. Most flow time is spent waiting on APIs and models, which isn't CPU time. Setting retention to 7 days keeps stored state small. Model calls are likely to be the largest cost, which is why `ai` usage is metered per workspace.

## Build phases

1. **Spike (1 day).** Confirm locally that Worker Loader and Workflows work together under `wrangler dev`: passing `step` over RPC through `dispatchWorkflow`, a sleep and resume on pinned code, and `globalOutbound` blocking `fetch`.
2. **Engine.** Bindings, compile and pin, `FlowWorkflow`, `FlowBrain` (read, search, write, connections, ai, log), manual runs over MCP, run records and the flow index.
3. **Triggers and destinations.** Cron scheduler, webhooks, drive, connection, email and webhook destinations, and input validation.
4. **App.** Flows, flow and run pages, live steps, and the run form.
5. **Safety and approvals.** Scope consent, test runs, `approve()`, outbound allowlist, limits and quotas.
6. **Skills, templates and file-event triggers.** Docs and the `install` bundles update automatically through `build-skills`.

## Decisions for Nith

1. **Code flows, or a no-code step list?** I recommend code (the design above), since agents write it and `FLOW.md` keeps it readable. A step list would be easier for people to edit by hand, but it would need its own expression language, and it gets less from Dynamic Workflows.
2. **Which model powers `ai`?** I recommend Claude when a workspace connects an Anthropic key, and Workers AI otherwise. The alternative is Workers AI only, which needs no setup but writes noticeably worse.
3. **Who can schedule team flows?** I recommend members, with the scope consent rule above. Admin-only is safer but slower for teams.
