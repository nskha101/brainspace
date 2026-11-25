import { z } from 'zod'
import * as templates from '../services/templates'
import type { ToolDef } from './tools'

const templateRef = z.string().describe('Template name (e.g. "slack-reply-drafts"), title, or folder path like /team/templates/slack-reply-drafts.')

export const TEMPLATE_TOOLS: ToolDef[] = [
  {
    name: 'templates_list',
    title: 'List templates',
    description:
      'Templates are bots, with the flows around them, that a teammate packaged so others can set up their own copy, running with their own logins and secrets. Lists the team\'s templates and your private ones: what each does, its bots and flows, and the connections, secrets and personal docs it needs.',
    schema: z.object({}),
    readOnly: true,
    run: async (actor) => templates.listTemplates(actor),
  },
  {
    name: 'template_get',
    title: 'Get a template',
    description:
      'One template: its bots (with their instructions), flows, the fields to fill in, the setup guide, and `setup`, a checklist of where you are with it (which bots and flows you have, and whether each connection, secret, personal doc and trigger it needs is in place). Call it before template_use, and again afterwards to see what is left.',
    schema: z.object({ template: templateRef }),
    readOnly: true,
    run: async (actor, a) => templates.getTemplate(actor, a.template),
  },
  {
    name: 'template_use',
    title: 'Set up a template',
    description:
      'Make your own copy of a template: its bots become private bots of yours and its flows go to /me/flows, all running as you. {{name}}, {{first_name}} and {{email}} become yours; pass the template\'s other fields in fields (ask the user for any you can\'t find; ones left out stay as {{field}} to fill in later). Returns todo: what is left, like signing in to a connection, adding a personal secret or writing a doc such as /me/slack/voice.md. Work through it with the user following the guide, then run the bot once with bot_run.',
    schema: z.object({
      template: templateRef,
      fields: z.record(z.string(), z.string()).optional().describe('Values for the template\'s fields, by name, e.g. { "slack_user_id": "U0123ABC" }. template_get lists them.'),
    }),
    minRole: 'member',
    run: async (actor, a) => templates.useTemplate(actor, a.template, { fields: a.fields }),
  },
  {
    name: 'template_create',
    title: 'Make a template from a bot',
    description:
      'Package bots, and the flows that run them, as a template a teammate can set up for themselves. Writes TEMPLATE.md, bots/<bot>.md and flows/<flow>/ under /me/templates/<name> (or /team/templates with space "team" when the user asked to share it). Swaps the owner\'s name and email for {{name}}, {{first_name}} and {{email}}, and lists the connections, secrets and personal docs it needs. Then read the files and replace anything else that belongs to one person (Slack ids, channel ids, nicknames) with a {{field}} declared under fields in TEMPLATE.md, and write the setup guide in its body. Bot memory, webhook URLs and run history are never copied.',
    schema: z.object({
      bots: z.array(z.string()).min(1).max(5).describe('Bots to include, by name or id. Usually one.'),
      flows: z.array(z.string()).max(10).optional().describe('Flows to include, by id or name. Default: the flows that run these bots. [] for none.'),
      name: z.string().max(60).optional().describe('Folder name, like "slack-reply-drafts". Default: made from the title.'),
      title: z.string().max(80).optional().describe('What people see, like "Slack reply drafts". Default: the first bot\'s name.'),
      description: z.string().max(300).optional().describe('One line on what someone gets by setting it up.'),
      icon: z.string().max(16).nullable().optional().describe('One emoji. Default: the first bot\'s icon.'),
      space: z.enum(['me', 'team']).optional().describe('me (default) to review it first and share it with promote; team to share it right away.'),
    }),
    minRole: 'member',
    run: async (actor, a) => templates.createTemplate(actor, a),
  },
]
