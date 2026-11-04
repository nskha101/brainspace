---
name: brainspace-flows
description: Use when the user wants something in Brainspace to happen automatically or repeatedly, such as "every Monday", "when a webhook fires", "turn this into a flow", "automate this" or "schedule a report". Also use to run, test, approve, debug or share an existing flow. Covers writing flow code, testing it, scheduling it and choosing where results go.
---

# Flows in Brainspace

A flow is a small program that Brainspace runs for the team: on demand, on a schedule or from a webhook. You write it; Brainspace runs it durably in a sandbox. Each step's result is saved, so a flow can sleep for days, wait for a person to approve something, and pick up where it left off.

A flow is a folder: `/me/flows/<name>/` (private) or `/team/flows/<name>/` (shared), holding:

- `FLOW.md`: what it does, its inputs and outputs, and what it may touch (`uses`).
- `flow.ts`: the code.

Both are normal versioned docs, so `history`, `diff`, `restore_version` and `promote` work on them.

## Before you build one

1. `flows_list`. If a flow already does this, run it or improve it instead of making another.
2. `flow_templates`. Start from the closest template with `flow_create({ name, template })`. It lands in `/me/flows/<name>`.
3. Agree on three things with the user: the inputs, what the output should look like, and where it goes (a doc, Slack, email...). Ask; don't assume a destination.

## FLOW.md

```markdown
---
name: competitor-digest            # lowercase-with-dashes, matches the folder
description: Weekly digest of what competitors shipped.
model: google/gemini-4-argon       # optional; else the workspace default
inputs:
  competitors:
    type: string[]                 # string, number, boolean, string[], number[], markdown, json
    description: Domains, like linear.app
    required: true
  since_days:
    type: number
    default: 7
outputs:
  report:
    type: markdown                 # markdown, string, json, number, boolean
    description: One section per competitor
uses:
  connections: [context]           # connection slugs it may call
  read: [/team/research]           # paths it may read (prefixes)
  write: [/team/research/digests]  # paths it may write
  network: []                      # hosts fetch() may reach; usually leave empty and use connections
  secrets: []                      # API keys it uses, e.g. [WEATHER_API_KEY]
  ai: true                         # may call ai.*
---

# Competitor digest

Plain-English explanation for people: what it does, when to run it, good destinations.
```

Ask for as little as the flow needs. Narrow `read` and `write` to the folders it really uses. Team flows (in `/team/flows`) can only use `/team` paths.

## flow.ts

```ts
import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, brain, connections, ai, approve, log }) => {
  const findings: unknown[] = []
  for (const c of inputs.competitors) {
    const news = await step.do(`news: ${c}`, () =>
      connections.call('context', 'get-news-search', { query: c, days: inputs.since_days }),
    )
    findings.push({ c, news })
  }
  const report = await step.do('write digest', () =>
    ai.write({ task: 'Write a competitor digest, one section per company.', context: findings, skill: 'brand-voice' }),
  )
  return { report } // keys match `outputs`
})
```

The full API is in `references/sdk.d.ts`. In short:

- `step.do(name, fn)`: a durable step. `step.sleep(name, '2 hours')` pauses without cost.
- `brain.read / readMany / list / search / write / edit / append / upload / skill`.
- `connections.call(slug, tool, args)`: tools from connected services. Find tool names with `connection_tools`.
- `ai.write({ task, context, skill })`, `ai.extract({ input, schema })`, `ai.classify({ input, labels })`, `ai.chat(...)`. Models come from Vercel AI Gateway (`workspace_ai` shows the default).
- `approve({ title, summary, preview })`: waits for a person and returns `{ approved, by, note }`.
- `secret('NAME')`: a placeholder for an API key (see Secrets below).
- `log(message, data)`, and `run` (id, test flag, trigger).

## The rules that matter

Flows replay: when a run resumes after a sleep, an approval or a restart, the code runs again from the top. Completed steps return their saved result instantly instead of running again. So:

1. **Every brain, connection and AI call goes inside `step.do`.** Outside a step it throws. Code outside steps should only shape data.
2. **Step names are unique and stable.** In loops, put the item in the name: `` `news: ${c}` ``. Never put `Date.now()` or random values in a name.
3. **No randomness or clock reads outside steps.** If you need the time, get it inside a step and use its result.
4. **Step results are JSON** and must stay under 1 MB. Write big things to the drive and return the path.
5. **Only `import { ... } from 'brainspace'`.** No npm packages, no other files. Plain TypeScript is fine; types are stripped.
6. **The sandbox has no secrets and no network**, except hosts in `uses.network`. Use connections for anything that needs a login.
7. **Errors that say "isn't allowed"** mean `uses` is missing something. Add the smallest path or slug that works, then retry. They aren't retried automatically.

## Secrets (API keys)

Prefer a connection when the service has one. When a flow needs to call an API directly with a key:

1. Declare it: `uses.secrets: [WEATHER_API_KEY]` and the host in `uses.network`.
2. Use the placeholder in `fetch`. Flow code never sees the value; Brainspace swaps it in on the way out, only for hosts the secret is bound to, and scrubs it from responses:

   ```ts
   import { defineFlow, secret } from 'brainspace'
   const res = await step.do('forecast', async () => {
     const r = await fetch(`https://api.openweathermap.org/data/3.0/onecall?lat=43.6&lon=-79.4&appid=${secret('WEATHER_API_KEY')}`)
     return r.json()
   })
   // or a header: { Authorization: `Bearer ${secret('GITHUB_TOKEN')}` }
   ```

3. Get the value saved. `secrets_list` shows what exists and an `addInApp` link. Send the user to that link to paste the key themselves, so it stays out of the chat. If they've already given you the key, save it with `secret_set({ name, value, hosts: ["api.openweathermap.org"] })`. `scope: "me"` saves a personal key that only their runs use (it wins over a team key with the same name).
4. For a single run, `flow_run` and `flow_test` accept `secrets: { NAME: "value" }`. Schedules and webhooks need saved secrets.

Never put a key in FLOW.md, flow.ts, inputs or a doc. A request that sends a secret to a host it isn't bound to is blocked, and the run log says why. Webhook destinations can send a saved secret in a header: `"headers": { "Authorization": "Bearer {secrets.HOOK_TOKEN}" }`.

## Checking your work

1. After every `write` or `edit` to `FLOW.md` or `flow.ts`, the response includes `flow.status`. If it's `invalid`, fix the `error` before going on.
2. `flow_test({ flow, inputs })` does a test run: real reads and AI calls, but writes, deliveries and connection calls that change data are recorded, not made.
3. `flow_run_get({ runId })` shows each step, logs, outputs and `captured` (what a real run would have changed). Runs take seconds to minutes; check again if it's still `running`.
4. Show the user the output and the captured changes. Fix and test again until they're happy.

## Running and scheduling

- `flow_run({ flow, inputs, deliver })` runs it now, as the user.
- `flow_trigger_set` saves a trigger. It holds inputs and destinations and runs as whoever saves it:
  - `kind: "schedule"` with `cron` (5 fields) and an IANA `timezone`. "Weekdays at 9am Eastern" is `0 9 * * 1-5` with `America/New_York`. The fastest allowed is every 15 minutes.
  - `kind: "webhook"` returns a URL, shown once. POSTed JSON becomes the inputs.
  - `kind: "manual"` saves inputs and destinations as a preset; run it with `flow_trigger_run`.
- Confirm the schedule, timezone and destinations with the user before saving a trigger.

## Destinations

`deliver` is a list. Each output goes where you say:

```json
[
  { "to": "drive", "path": "/team/research/digests/{date}.md" },
  { "to": "drive", "path": "/team/research/digest-latest.md", "mode": "version" },
  { "to": "connection", "connection": "slack", "tool": "post_message", "args": { "channel": "#growth", "text": "New digest: {links.doc}" } },
  { "to": "email", "members": ["me"], "subject": "Competitor digest {date}" },
  { "to": "webhook", "url": "https://hooks.example.com/digest" }
]
```

- Drive modes: `new` (a fresh doc per run, the default), `version` (a new version of one doc, so its history is the run history), `append`.
- Placeholders: `{date}`, `{time}`, `{run}`, `{flow}`, `{trigger}`, `{inputs.x}`, `{outputs.x}`, `{links.run}`, `{links.doc}` (the doc an earlier drive destination wrote). An argument that is exactly `"{outputs.x}"` keeps its type.
- `output` picks which output to send when there are several; the default is the first.
- Every run's outputs also stay on its run page.

## Approvals

When a run calls `approve()`, it shows as `waiting` (in `whoami`, `flows_list` and `flow_runs({ status: "waiting" })`), and the person it runs as gets an email. If the user asks you to handle it, show them the `pendingApproval` title, summary and preview from `flow_run_get` and get their decision. Then call `flow_run_approve`. Never approve on your own judgment.

## Sharing

Draft in `/me/flows`, test, then `promote` the folder to `/team/flows/<name>` (ask the user first). Promoting onto an existing team flow makes your files its next version.

Triggers run as the person who saved them. If someone edits a flow so it asks for more access (a new path, connection or host), triggers owned by other people pause until the owner approves with `flow_trigger_approve`. Tell the user when your edit will do this.

## Fixing a failed run

1. `flow_run_get`: read `error`, the failed step's `error`, and the log.
2. Fix `flow.ts` or `FLOW.md` with `edit`, run `flow_test` again, and tell the user what changed.
3. A delivery failure (Slack down, a bad path) doesn't redo the work. Fix the trigger's `deliver` with `flow_trigger_set` and run it again.
