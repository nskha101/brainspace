import { z } from 'zod'
import * as bots from '../services/bots'
import * as inbox from '../services/slack-inbox'
import { appUrl } from '../env'
import type { ToolDef } from './tools'

const botRef = z.string().describe('Bot name (e.g. "Monday competitor digest") or id.')

const settings = {
  description: z.string().max(300).optional().describe('One line on what it does, for the list of bots.'),
  model: z
    .string()
    .nullable()
    .optional()
    .describe('AI Gateway model id, like anthropic/claude-sonnet-5.5. It has to support tool calling. Omit (or null) for the workspace default; workspace_ai with listModels shows what there is.'),
  cron: z
    .string()
    .nullable()
    .optional()
    .describe('When it runs: five cron fields, e.g. "0 9 * * 1" = Mondays 09:00. At most every 15 minutes. Null for a bot that only runs when asked.'),
  timezone: z.string().optional().describe('IANA name for the schedule, e.g. America/New_York. Use the user\'s own. Default UTC.'),
  tools: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Limit the bot to these tools, e.g. ["read","search","db_query","append"]. Null (default) gives it every bot tool; bot_get lists them under allTools.'),
  connections: z.array(z.string()).nullable().optional().describe('Limit the bot to these connections (slugs), or [] for none. Null (default): every connection you can use.'),
  webhook: z
    .boolean()
    .optional()
    .describe('true gives the bot a webhook URL (replacing any old one), returned once as webhookUrl: a POST to it wakes the bot, and the body reaches the run as data. false removes it. Use it when something outside should trigger the bot, like a monitor, a form or another system. A bot can have a schedule and a webhook.'),
  paths: z
    .object({
      read: z.array(z.string()).optional().describe('Folders or files it may read, e.g. ["/team/research"].'),
      write: z.array(z.string()).optional().describe('Folders or files it may change, e.g. ["/team/research/digests"]. It may read these too.'),
    })
    .nullable()
    .optional()
    .describe('Limit what it may touch. Default: all of /team, plus your /me for a private bot. Give a bot only what its job needs.'),
}

export const BOT_TOOLS: ToolDef[] = [
  {
    name: 'bots_list',
    title: 'List bots',
    description:
      'Bots are agents that work on their own schedule: each has instructions, a model, tools, and the part of the brain it may touch. Lists the team\'s bots and your private ones, with their schedule, next run and last run.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => bots.listBots(actor),
  },
  {
    name: 'bot_get',
    title: 'Get a bot',
    description: 'One bot: its instructions, schedule, model, tools, connections, paths and recent runs. Your own bots also show their memory, the notes a bot keeps between runs.',
    schema: z.object({ bot: botRef }),
    readOnly: true,
    run: async (actor, a) => bots.getBot(actor, a.bot),
  },
  {
    name: 'bot_create',
    title: 'Create a bot',
    description:
      'Set up a bot that does a job on a schedule, as you, without anyone opening a chat. Write instructions the way you would brief a colleague: what to check, where to write the result, what to skip. You choose the schedule from what the user asked for ("every Monday morning" is cron "0 9 * * 1" in their timezone; "keep an eye on" is usually hourly or daily, not every 15 minutes). A bot reads and changes docs and databases, calls connections, runs flows and can hand work to subagents; every change is versioned and shows in the activity log under the bot\'s name. Besides a schedule, a bot can be woken by a webhook (webhook: true) or run as a step of a flow (bots.run in flow code). Private by default; visibility "team" shares it and limits it to /team. Tell the user the schedule and what it may touch, then run it once with bot_run to check it.',
    schema: z.object({
      name: z.string().max(60).describe('A name people will recognize in a list, e.g. "Monday competitor digest".'),
      instructions: z.string().describe('What to do on every run. The bot sees nothing else from this conversation.'),
      visibility: z.enum(['private', 'team']).optional().describe('private (default): only you see it, and it can use /team and your /me. team: everyone sees it and its runs, and it works in /team only.'),
      ...settings,
    }),
    minRole: 'member',
    run: async (actor, a) => bots.createBot(actor, a),
  },
  {
    name: 'bot_update',
    title: 'Change a bot',
    description:
      'Change a bot you own: its instructions, schedule, model, tools, connections, paths, name or visibility. Pass only what changes. enabled false pauses it and true resumes it (an admin can pause any team bot). Sharing a private bot with the team takes it out of your /me space.',
    schema: z.object({
      bot: botRef,
      name: z.string().max(60).optional(),
      instructions: z.string().optional(),
      visibility: z.enum(['private', 'team']).optional(),
      enabled: z.boolean().optional(),
      ...settings,
    }),
    minRole: 'member',
    run: async (actor, { bot, ...input }) => bots.updateBot(actor, bot, input),
  },
  {
    name: 'bot_run',
    title: 'Run a bot now',
    description:
      'Start a run now, without waiting for the schedule. Returns the run id; follow it with bot_run_get. Runs act as the bot\'s owner. The owner can add a request for this one run (prompt), e.g. "only look at last week".',
    schema: z.object({ bot: botRef, prompt: z.string().max(4000).optional().describe('An extra request for this run only. Owner only.') }),
    minRole: 'member',
    run: async (actor, a) => bots.runBot(actor, a.bot, a),
  },
  {
    name: 'bot_runs',
    title: 'Bot runs',
    description: 'Recent runs, newest first, with what each bot said it did and what started each one (schedule, a person, a webhook or a flow). Filter by bot or status.',
    schema: z.object({
      bot: botRef.optional(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnly: true,
    run: async (actor, a) => bots.listRuns(actor, a),
  },
  {
    name: 'bot_run_get',
    title: 'Get a bot run',
    description: 'One run step by step: what the bot said, each tool it called with the result, its subagents, and how it ended.',
    schema: z.object({ runId: z.string() }),
    readOnly: true,
    run: async (actor, a) => bots.getRun(actor, a.runId),
  },
  {
    name: 'bot_run_cancel',
    title: 'Cancel a bot run',
    description: 'Stop a run that is queued or running. Changes it already made stay; undo them with restore_version if needed.',
    schema: z.object({ runId: z.string() }),
    minRole: 'member',
    run: async (actor, a) => bots.cancelRun(actor, a.runId),
  },
  {
    name: 'slack_inbox',
    title: 'Slack inbox',
    description:
      'The user\'s Slack inbox: when someone DMs them or @mentions them in Slack, one of their private bots is woken with the message and the conversation around it, and can DM them a draft reply. Call with no arguments for the current setup. Connecting their Slack account happens in the browser: give them setupUrl. Once connected you can pick the bot (botId, one of their private bots), make the starter bot (createBot: true), or switch DMs, mentions or the whole thing on and off. The slack connection\'s read_messages and search_messages tools read Slack as that person once they are connected.',
    schema: z.object({
      botId: z.string().nullable().optional().describe('The private bot that gets their messages, or null for none.'),
      createBot: z.boolean().optional().describe('Create the starter bot (drafts a reply, DMs it to them) and use it.'),
      dms: z.boolean().optional(),
      mentions: z.boolean().optional(),
      enabled: z.boolean().optional().describe('false pauses the inbox without disconnecting.'),
    }),
    minRole: 'member',
    run: async (actor, { createBot, ...input }) => {
      if (createBot) await inbox.createInboxBot(actor)
      const changed = Object.values(input).some((x) => x !== undefined)
      const status = changed ? await inbox.updateInbox(actor, input) : await inbox.inboxStatus(actor)
      return { ...status, setupUrl: `${appUrl()}/app/bots#slack-inbox` }
    },
  },
  {
    name: 'bot_delete',
    title: 'Delete a bot',
    description: 'Delete a bot, its schedule, its memory and its run history. What it wrote stays. Your own bots, or any team bot if you are an admin. Confirm with the user first; to stop a bot for a while, pause it with bot_update instead.',
    schema: z.object({ bot: botRef }),
    minRole: 'member',
    destructive: true,
    run: async (actor, a) => bots.deleteBot(actor, a.bot),
  },
]
