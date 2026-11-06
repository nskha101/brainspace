import { z } from 'zod'
import * as flows from '../services/flows'
import { getAiSettings, listModels, setAiSettings } from '../services/ai'
import { listSecrets, removeSecret, setSecret } from '../services/secrets'
import { appUrl } from '../env'
import type { ToolDef } from './tools'

const flowRef = z.string().describe('Flow name (e.g. "competitor-digest"), id, or folder path like /team/flows/competitor-digest.')

// Destinations saved before the drive -> space rename used to: "drive".
const destination = z.preprocess((d) => (d && typeof d === 'object' && (d as { to?: unknown }).to === 'drive' ? { ...d, to: 'space' } : d), z.union([
  z.object({
    to: z.literal('space'),
    path: z.string().describe('Doc path. Placeholders: {date}, {time}, {run}, {flow}, {trigger}, {inputs.x}.'),
    output: z.string().optional().describe('Which output to save. Defaults to the first one.'),
    mode: z.enum(['new', 'version', 'append']).optional().describe('new: a fresh doc each run (default). version: a new version of the same doc. append: add to the end.'),
  }),
  z.object({
    to: z.literal('connection'),
    connection: z.string().describe('Connection slug, e.g. "slack".'),
    tool: z.string(),
    args: z.record(z.string(), z.any()).describe('Tool arguments. Strings can use {outputs.x}, {links.run}, {links.doc}, {date}...; a value that is exactly "{outputs.x}" keeps its type.'),
  }),
  z.object({
    to: z.literal('email'),
    members: z.array(z.string()).describe('"me", "team", or member emails/names.'),
    output: z.string().optional(),
    subject: z.string().optional(),
  }),
  z.object({
    to: z.literal('webhook'),
    url: z.string().url().describe('https URL. Gets a signed JSON POST with the outputs.'),
    headers: z.record(z.string(), z.string()).optional().describe('Extra headers. Values can use {secrets.NAME}; the secret must be bound to the URL\'s host.'),
  }),
]))

export const FLOW_TOOLS: ToolDef[] = [
  {
    name: 'flows_list',
    title: 'List flows',
    description:
      'Flows are small programs the team runs on demand, on a schedule or from a webhook. Lists team flows and your private ones, with their status, last run, next scheduled run and runs waiting for approval.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => flows.listFlows(actor),
  },
  {
    name: 'flow_get',
    title: 'Get a flow',
    description: 'A flow\'s description, inputs, outputs, what it may touch, its code, diagram, triggers and recent runs.',
    schema: z.object({ flow: flowRef, includeCode: z.boolean().optional().describe('Include flow.ts source. Default true.') }),
    readOnly: true,
    run: async (actor, a) => {
      const f = await flows.getFlow(actor, a.flow)
      return a.includeCode === false ? { ...f, code: undefined } : f
    },
  },
  {
    name: 'flow_templates',
    title: 'Flow templates',
    description: 'Starter flows you can copy with flow_create({ template }). Read the brainspace-flows skill before writing flow code.',
    schema: z.object({}),
    readOnly: true,
    run: async () => flows.listTemplates(),
  },
  {
    name: 'flow_create',
    title: 'Create a flow',
    description:
      'Create a flow folder at /me/flows/<name> with FLOW.md (description, inputs, outputs, uses) and flow.ts (the code), blank or from a template. Then edit those files with write/edit, check with flow_test, and share with promote.',
    schema: z.object({
      name: z.string().describe('Lowercase with dashes, e.g. "weekly-metrics".'),
      template: z.string().optional().describe('Template id from flow_templates.'),
      description: z.string().max(300).optional(),
      space: z.enum(['me', 'team']).optional().describe('Default "me". Draft privately, then promote.'),
    }),
    minRole: 'member',
    run: async (actor, a) => flows.createFlow(actor, a),
  },
  {
    name: 'flow_test',
    title: 'Test a flow',
    description:
      'Run a flow in test mode: real reads and AI calls, but writes, deliveries and non-read-only connection calls are recorded instead of made. Returns the run id; check it with flow_run_get. Always test before scheduling or promoting.',
    schema: z.object({
      flow: flowRef,
      inputs: z.record(z.string(), z.any()).optional(),
      deliver: z.array(destination).optional().describe('Destinations to preview.'),
      secrets: z
        .record(z.string(), z.string())
        .optional()
        .describe('Secret values for this run only, for secrets the flow declares but nobody has saved. Prefer saved secrets (secret_set or the app) so keys stay out of chats.'),
    }),
    minRole: 'member',
    run: async (actor, a) => ({ ...(await flows.runFlow(actor, a.flow, { inputs: a.inputs, deliver: a.deliver, secrets: a.secrets, test: true })), next: 'Call flow_run_get with this runId to see steps, logs, outputs and what would have been written.' }),
  },
  {
    name: 'flow_run',
    title: 'Run a flow',
    description:
      'Start a real run now, as you. Pass inputs and, optionally, where to deliver the outputs. Returns the run id; follow it with flow_run_get. Runs can take minutes; they keep going after you return.',
    schema: z.object({
      flow: flowRef,
      inputs: z.record(z.string(), z.any()).optional(),
      deliver: z.array(destination).optional(),
      secrets: z
        .record(z.string(), z.string())
        .optional()
        .describe('Secret values for this run only, for secrets the flow declares but nobody has saved. Prefer saved secrets (secret_set or the app) so keys stay out of chats.'),
    }),
    minRole: 'member',
    run: async (actor, a) => flows.runFlow(actor, a.flow, { inputs: a.inputs, deliver: a.deliver, secrets: a.secrets }),
  },
  {
    name: 'flow_runs',
    title: 'Flow runs',
    description: 'Recent runs, newest first. Filter by flow or status (waiting = needs an approval).',
    schema: z.object({
      flow: flowRef.optional(),
      status: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnly: true,
    run: async (actor, a) => flows.listRuns(actor, a),
  },
  {
    name: 'flow_run_get',
    title: 'Get a run',
    description: 'One run: status, each step, logs, outputs, deliveries, captured writes (test runs) and any pending approval.',
    schema: z.object({ runId: z.string() }),
    readOnly: true,
    run: async (actor, a) => {
      const r = await flows.getRun(actor, a.runId)
      return { ...r, diagram: undefined }
    },
  },
  {
    name: 'flow_run_cancel',
    title: 'Cancel a run',
    description: 'Stop a queued, running or waiting run.',
    schema: z.object({ runId: z.string() }),
    minRole: 'member',
    run: async (actor, a) => flows.cancelRun(actor, a.runId),
  },
  {
    name: 'flow_run_approve',
    title: 'Approve a run',
    description: 'Answer a run that is waiting on approve(). Show the user the request (title, summary, preview from flow_run_get) and get their decision first.',
    schema: z.object({ runId: z.string(), approved: z.boolean(), note: z.string().max(1000).optional() }),
    minRole: 'member',
    run: async (actor, a) => flows.approveRun(actor, a.runId, a),
  },
  {
    name: 'flow_trigger_set',
    title: 'Schedule or save a flow',
    description:
      'Create or update a trigger: a schedule (cron + IANA timezone, at most every 15 minutes), a webhook, or a saved manual run. A trigger holds input values and destinations. It runs as you, and you approve the flow\'s current access; if the flow later asks for more, the trigger pauses until you approve again. Confirm the schedule and destinations with the user first.',
    schema: z.object({
      flow: flowRef,
      id: z.string().optional().describe('Trigger id to update. Omit to create.'),
      kind: z.enum(['schedule', 'webhook', 'manual']).optional(),
      name: z.string().max(100).optional(),
      cron: z.string().optional().describe('Five fields, e.g. "0 9 * * 1-5" = weekdays 09:00.'),
      timezone: z.string().optional().describe('IANA name, e.g. America/New_York. Default UTC.'),
      inputs: z.record(z.string(), z.any()).optional(),
      deliver: z.array(destination).optional(),
      enabled: z.boolean().optional(),
    }),
    minRole: 'member',
    run: async (actor, a) => flows.setTrigger(actor, a),
  },
  {
    name: 'flow_triggers_list',
    title: 'List triggers',
    description: "A flow's schedules, webhooks and saved runs.",
    schema: z.object({ flow: flowRef }),
    readOnly: true,
    run: async (actor, a) => flows.listTriggers(actor, a.flow),
  },
  {
    name: 'flow_trigger_run',
    title: 'Run a trigger now',
    description: "Run a saved trigger right away, with its inputs and destinations, as you.",
    schema: z.object({ id: z.string() }),
    minRole: 'member',
    run: async (actor, a) => flows.runTrigger(actor, a.id),
  },
  {
    name: 'flow_trigger_approve',
    title: 'Approve new flow access',
    description: 'Re-approve a paused trigger after its flow asked for more access. Only the person the trigger runs as can do this; tell them what the flow now touches first.',
    schema: z.object({ id: z.string() }),
    minRole: 'member',
    run: async (actor, a) => flows.approveTriggerScope(actor, a.id),
  },
  {
    name: 'flow_trigger_remove',
    title: 'Remove a trigger',
    description: 'Delete a schedule, webhook or saved run. Yours, or anyone\'s if you are an admin.',
    schema: z.object({ id: z.string() }),
    minRole: 'member',
    run: async (actor, a) => flows.removeTrigger(actor, a.id),
  },
  {
    name: 'secrets_list',
    title: 'List secrets',
    description:
      'API keys that flows can use: team secrets and your personal ones, with the hosts each may be sent to. Values are never returned. Your personal secret wins over a team secret with the same name in runs that act as you.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => ({ secrets: await listSecrets(actor), addInApp: `${appUrl()}/app/settings#secrets` }),
  },
  {
    name: 'secret_set',
    title: 'Save a secret',
    description:
      'Save or replace an API key for flows. hosts are the only hosts the value will ever be sent to. Flow code uses it as secret("NAME") and never sees the value. Rather than asking the user to paste a key into the chat, point them to the addInApp link from secrets_list; use this when they have already given you the key or asked you to save it.',
    schema: z.object({
      name: z.string().describe('UPPER_SNAKE_CASE, e.g. WEATHER_API_KEY.'),
      value: z.string().optional().describe('The key. Omit to change only hosts or description.'),
      hosts: z.array(z.string()).optional().describe('Hosts it may be sent to, e.g. ["api.openweathermap.org"]. Required for a new secret.'),
      scope: z.enum(['team', 'me']).optional().describe('team (default): any run can use it. me: only runs that act as you.'),
      description: z.string().max(300).optional(),
    }),
    minRole: 'member',
    run: async (actor, a) => setSecret(actor, a),
  },
  {
    name: 'secret_remove',
    title: 'Remove a secret',
    description: 'Delete a saved secret. Team secrets: whoever added it, or an admin.',
    schema: z.object({ name: z.string(), scope: z.enum(['team', 'me']).optional() }),
    minRole: 'member',
    destructive: true,
    run: async (actor, a) => removeSecret(actor, a),
  },
  {
    name: 'workspace_ai',
    title: 'AI settings',
    description:
      'The model flows use for ai.* calls and whether AI is set up. Admins can set the Vercel AI Gateway key and the default model (an AI Gateway id like google/gemini-4-argon). Pass listModels to see available ids.',
    schema: z.object({
      key: z.string().nullable().optional().describe('Admins: a Vercel AI Gateway API key, or null to remove it.'),
      model: z.string().nullable().optional().describe('Admins: default model id, or null for the Brainspace default.'),
      listModels: z.boolean().optional(),
    }),
    minRole: 'member',
    run: async (actor, a) => {
      const settings = a.key !== undefined || a.model !== undefined ? await setAiSettings(actor, a) : await getAiSettings(actor)
      return a.listModels ? { ...settings, models: (await listModels()).map((m) => m.id) } : settings
    },
  },
]
