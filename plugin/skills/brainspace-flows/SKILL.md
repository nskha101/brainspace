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
title: Competitor digest           # what people see in the app instead of the name
icon: "🔭"                         # one emoji shown next to the title
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
  read: [/team/research]           # paths it may read (prefixes), databases included
  write: [/team/research/digests]  # paths it may write
  network: []                      # hosts fetch() may reach; usually leave empty and use connections
  secrets: []                      # API keys it uses, e.g. [WEATHER_API_KEY]
  ai: true                         # may call ai.*
  flows: []                        # other flows it runs with flows.run(), by name
  bots: []                         # bots it runs with bots.run(), by name
---

# Competitor digest

Plain-English explanation for people: what it does, when to run it, good destinations.
```

Always set `title` and `icon`. The app shows them instead of the name, and a name like `returning-signups` on its own leaves people guessing what the flow does. `flow_create` takes both. The app also shows who made the flow (whoever first saved its FLOW.md).

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
- `db.query / exec / batch / insert / schema / create`: databases in the space (see Databases below).
- `connections.call(slug, tool, args)`: tools from connected services. Find tool names with `connection_tools`.
- `ai.write({ task, context, skill })`, `ai.extract({ input, schema })`, `ai.classify({ input, labels })`, `ai.chat(...)`. `ai.decide({ input, questions })` asks a decision model (typesafe-ai/jev by default) yes/no, choice or score questions and returns probabilities, not text: `{ worth: { type: 'yesno', ask: 'Does this need a reply?' } }` gives `answers.worth.probability`. It costs a fraction of a writing model, so use it to filter or route before a step that does real work. Models come from Vercel AI Gateway (`workspace_ai` shows the default).
- `approve({ title, summary, preview })`: waits for a person and returns `{ approved, by, note }`.
- `flows.run(name, inputs)`: runs another flow, waits for it, and returns its outputs (see Running other flows below).
- `bots.run(name, input)`: runs a bot, waits for it, and returns what it did (see Running bots below).
- `secret('NAME')`: a placeholder for an API key (see Secrets below).
- `log(message, data)`, and `run` (id, test flag, trigger).

## The rules that matter

Flows replay: when a run resumes after a sleep, an approval or a restart, the code runs again from the top. Completed steps return their saved result instantly instead of running again. So:

1. **Every brain, connection and AI call goes inside `step.do`.** Outside a step it throws. Code outside steps should only shape data.
2. **Step names are unique and stable.** In loops, put the item in the name: `` `news: ${c}` ``. Never put `Date.now()` or random values in a name.
3. **No randomness or clock reads outside steps.** If you need the time, get it inside a step and use its result.
4. **Step results are JSON** and must stay under 1 MB. Write big things to the space and return the path.
5. **Only `import { ... } from 'brainspace'`.** No npm packages, no other files. Plain TypeScript is fine; types are stripped.
6. **The sandbox has no secrets and no network**, except hosts in `uses.network`. Use connections for anything that needs a login.
7. **Errors that say "isn't allowed"** mean `uses` is missing something. Add the smallest path or slug that works, then retry. They aren't retried automatically.

## Databases

Flows often need data that outlives a run: the customers to loop over, which items were already handled, what the numbers were last week. Keep that in a database (a path ending in `.db`), not in a doc the flow rewrites. A database can sit in the flow's own folder when only that flow uses it (`/team/flows/renewals/state.db`), or in a shared folder when several flows and agents do (`/team/customers/customers.db`).

```ts
export default defineFlow(async ({ step, db, connections }) => {
  const DB = '/team/customers/customers.db'
  const deals = await step.do('load deals', () => connections.call('hubspot', 'search_crm_objects', { objectType: 'deals' }))
  await step.do('upsert customers', () =>
    db.insert(DB, 'customers', deals.results.map((d) => ({ domain: d.domain, company: d.name, plan: d.plan })), { upsertOn: ['domain'] }),
  )
  const stale = await step.do('find stale', () =>
    db.query(DB, 'SELECT company, owner FROM customers WHERE last_contact < date(?, ?)', ['now', '-30 days']),
  )
  return { stale }
})
```

- List the path under `uses.read` to query it and under `uses.write` to change it. A folder path covers every database in it.
- `db.query(path, sql, params)` returns rows as objects. It throws past 5000 rows or about 900 KB, so filter, aggregate or page in SQL.
- `db.insert(path, table, rows, { upsertOn })` adds up to 5000 rows a call and updates the ones whose key already exists. Runs repeat (schedules, retries), so prefer upserts and `ON CONFLICT` over plain inserts: a step that runs twice must not add the same rows twice.
- `db.exec(path, sql, params)` runs one change and `db.batch(path, statements)` runs several as one transaction.
- `db.create(path, { description, sql })` makes the database if it isn't there and is safe to call on every run. Usually it's better to create the database once with `db_create` while you build the flow, so you can look at it and test against it.
- Every call goes inside `step.do`, and values go through `params`.
- In a test run, queries are real, and changes run and are then rolled back: the flow gets real row counts and real SQL errors, and the changes show up under `captured` instead of being kept. A database the flow would create doesn't exist yet in a test run, so its queries come back empty.
- A database is also what an artifact (a dashboard or tracker page, see the `brainspace-artifacts` skill) shows. A flow that upserts into the database an artifact reads keeps that page current with no other step: open copies redraw when the rows change.
- Rows have no version history. Never have a flow delete or overwrite rows it can't rebuild without an `approve()` step in front.

## Running other flows

A flow can run another flow as one of its steps, so you can build small flows and wire them together:

```ts
export default defineFlow(async ({ inputs, step, flows, brain }) => {
  const { report } = await flows.run('competitor-digest', { competitors: inputs.competitors })
  await step.do('save', () => brain.write('/team/research/digests/latest.md', report))
  return { report }
})
```

- List each flow it runs under `uses.flows` in FLOW.md, by name. Saving flow.ts fails if a `flows.run("name")` isn't listed.
- Call `flows.run` on its own line, like `approve()`. Never put it inside `step.do`: it saves its own result, so on replay it returns the same outputs without running the flow again.
- It throws if the other flow fails or is cancelled. Catch the error if the parent should carry on without it.
- The other flow runs as the same person, in the same mode (a test run's subflows are test runs too), with no destinations of its own: its outputs come back to the caller. It may only touch what the caller's own `uses` allows, so copy any paths, connections, hosts, secrets and `ai` it needs into the caller's FLOW.md. The error message lists what's missing.
- Team flows can only run team flows. Flows nest at most 3 deep, and a flow can't run itself, directly or further down.
- Each subflow run has its own run page. `flow_run_get` on the parent lists them under `subflows`. In a test run, look there for `captured` changes, because they're recorded on the subflow's own run.
- Outputs pass back through a step, so keep them under about 900 KB. For anything bigger, write it to a doc and return the path.

To run independent flows at the same time, use `Promise.all([flows.run('a', ...), flows.run('b', ...)])`.

## Running bots

A flow's steps are fixed. When one step needs judgment (decide which parts of the brand kit a site change affects, then update them), hand that step to a bot with `bots.run`:

```ts
export default defineFlow(async ({ step, connections, bots }) => {
  const pages = await step.do('scrape the site', () =>
    connections.call('context', 'scrape', { url: 'https://acme.com', pages: ['/', '/pricing', '/about'] }),
  )
  const { summary } = await bots.run('Brand kit keeper', { pages })
  return { summary }
})
```

- List each bot under `uses.bots` in FLOW.md, by name. Saving flow.ts fails if a `bots.run("name")` isn't listed.
- Call `bots.run` on its own line, like `flows.run`. Never put it inside `step.do`.
- It returns `{ summary, runId }`: the bot's own account of what it did. It throws if the run fails or is cancelled.
- The bot acts as its owner with its own tools, paths and connections, not the flow's `uses`. The flow only decides when it runs and what it is handed.
- `input` (a string or any JSON, up to 100 KB) reaches the bot as data for that run. Only a flow that runs as the bot's owner may pass input; anyone else's run can start a team bot but hand it nothing.
- Team flows only run team bots. A private flow prefers its owner's own bot with that name.
- A bot does one run at a time. If it's busy, the step waits and retries.
- In a test run the call is recorded and the bot isn't started, so `summary` is a placeholder.
- When the flow run ends or is cancelled, a bot run it started is cancelled too.

Create the bot first with the `brainspace-bots` skill, and leave its `cron` out if only the flow should start it.

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

### Sending as different people

Some tokens act as a person: a Slack user token posts as that person. To let a flow send as one of a few people, give each person a team secret and pick one with an enum input:

```yaml
inputs:
  sender: { type: string, enum: [nith, farris], required: true }
uses:
  secrets: [SLACK_TOKEN_NITH, SLACK_TOKEN_FARRIS]
  network: [slack.com]
```

```ts
const token = secret(inputs.sender === 'farris' ? 'SLACK_TOKEN_FARRIS' : 'SLACK_TOKEN_NITH')
```

Each person saves their own token as a team secret, restricted to the people who may send as them: `secret_set({ name: "SLACK_TOKEN_NITH", hosts: ["slack.com"], people: ["nith@example.com", "farris@example.com"] })`, or "Only runs by certain people" in Settings → Secrets. Runs by anyone else, admins included, can't use a restricted secret, even from a flow they write themselves. A run can't start unless the person it acts as can use every secret the flow declares, so put the flow in a folder restricted to the same people (`access_set`) to keep everyone else from seeing it. Only whoever added a secret can change its people list.

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
  - `kind: "webhook"` returns a URL, shown once. POSTed JSON becomes the inputs. For a service that posts its own shape (Slack, Stripe, GitHub), declare one input named `body` with `type: json` and the whole payload arrives as `inputs.body`. The URL also answers Slack's events URL check, so it can be a Slack app's event request URL. It also takes a form post with the JSON in a `payload` field, which is how Slack sends button clicks, so it can be the app's interactivity URL too. Set `verify` on it whenever the sender signs its requests (see Checking who calls a webhook below).
  - `kind: "manual"` saves inputs and destinations as a preset; run it with `flow_trigger_run`.
- Confirm the schedule, timezone and destinations with the user before saving a trigger.

## Checking who calls a webhook

A webhook URL is the only thing between the internet and a run: anyone who has it can POST any body, and the flow can't tell. So when the sender signs its requests, have the trigger check the signature. A request that fails gets a 401 and starts nothing, so the flow can trust `inputs.body`.

```json
{ "flow": "slack-send", "kind": "webhook", "verify": { "scheme": "slack", "secret": "SLACK_SIGNING_SECRET" } }
```

| `scheme` | What it checks | The secret |
| --- | --- | --- |
| `slack` | `X-Slack-Signature` over the timestamp and raw body. Requests over five minutes old are refused. | The Slack app's signing secret (Basic Information). |
| `github` | `X-Hub-Signature-256` over the raw body. | The secret typed when the webhook was added. |
| `stripe` | `Stripe-Signature` over the timestamp and raw body. Requests over five minutes old are refused. | The endpoint's signing secret (`whsec_...`). |
| `hmac` | An HMAC-SHA256 of the raw body in the header named by `header`, hex or base64, with or without `sha256=`. Covers Shopify, Linear, Intercom and most others. | Whatever the sender signs with. |
| `header` | The header named by `header` holds the secret itself (`Bearer` is allowed in front). | A token the sender sends as-is. Use only when it can't sign. |

1. Get the signing secret saved under a name. It is checked on the way in and never sent anywhere, so it takes no hosts: send the user to the `addInApp` link from `secrets_list` and tell them to leave hosts empty, or, if they already gave you the value, `secret_set({ name, value, hosts: [], scope: "me" })`. Don't list it under `uses.secrets`: the flow's code has no use for it.
2. `flow_trigger_set` with `verify`. `secret` is the name, never the value. Saving fails if the person the trigger runs as (whoever saves it) has no secret by that name. To add the check to a webhook that already exists, pass its `id`: the URL stays the same.
3. Have the sender fire once and look at the trigger in `flow_triggers_list`. A refused request shows as `lastStatus: "refused: ..."` with the reason. A wrong secret refuses everything, so check this before you tell the user it works.

`verify: null` turns the check off. `flow_run` and `flow_trigger_run` still start runs by hand, with whatever inputs the person gives, so a flow that must only act on real events should also be private to the people who may run it.

Where the sender can't sign or send a token at all, the flow has to treat the body as a claim: take only ids from it, read the real thing back from the service with a saved secret, and act on what comes back.

## Destinations

`deliver` is a list. Each output goes where you say:

```json
[
  { "to": "space", "path": "/team/research/digests/{date}.md" },
  { "to": "space", "path": "/team/research/digest-latest.md", "mode": "version" },
  { "to": "connection", "connection": "slack", "tool": "post_message", "args": { "channel": "#growth", "text": "New digest: {links.doc}" } },
  { "to": "email", "members": ["me"], "subject": "Competitor digest {date}" },
  { "to": "webhook", "url": "https://hooks.example.com/digest" }
]
```

- Slack destinations use the built-in Slack connection, which posts as the Brainspace app. `channel` takes an ID, `#name`, or a person's email for a DM. Use `markdown` instead of `text` to send an output as-is: `"args": { "channel": "#growth", "markdown": "{outputs.report}" }`. In flow code, the same tools work with `connections.call('slack', 'post_message', {...})`, with `slack` under `uses.connections`. Don't save Slack tokens as secrets for this.
- Space modes: `new` (a fresh doc per run, the default), `version` (a new version of one doc, so its history is the run history), `append`.
- Placeholders: `{date}`, `{time}`, `{run}`, `{flow}`, `{trigger}`, `{inputs.x}`, `{outputs.x}`, `{links.run}`, `{links.doc}` (the doc an earlier space destination wrote). An argument that is exactly `"{outputs.x}"` keeps its type.
- `output` picks which output to send when there are several; the default is the first.
- Every run's outputs also stay on its run page.

## Approvals

When a run calls `approve()`, it shows as `waiting` (in `whoami`, `flows_list` and `flow_runs({ status: "waiting" })`), and the person it runs as gets an email. If the user asks you to handle it, show them the `pendingApproval` title, summary and preview from `flow_run_get` and get their decision. Then call `flow_run_approve`. Never approve on your own judgment.

## Sharing

Draft in `/me/flows`, test, then `promote` the folder to `/team/flows/<name>` (ask the user first). Promoting onto an existing team flow makes your files its next version.

Triggers run as the person who saved them. Anyone on the team can edit a team flow, and nobody has to approve the edit: the next run uses the new version, and the flow's creator and everyone with a trigger on it get an email saying who changed it and what new access it has. So tell the user whose schedules your edit will change before you save it.

One case still waits. If your edit makes the flow use something the user can't use themselves (a secret or connection kept to other people, or a folder they can't see), triggers that run as someone else pause until that person approves with `flow_trigger_approve`.

## Fixing a failed run

1. `flow_run_get`: read `error`, the failed step's `error`, and the log. If a subflow failed, the error names its run; call `flow_run_get` on that run too.
2. Fix `flow.ts` or `FLOW.md` with `edit`, run `flow_test` again, and tell the user what changed.
3. A delivery failure (Slack down, a bad path) doesn't redo the work. Fix the trigger's `deliver` with `flow_trigger_set` and run it again.
