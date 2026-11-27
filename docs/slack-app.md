# The Brainspace Slack app

Slack is a built-in connection (`src/server/services/slack.ts`). A workspace adds it from Connections with "Add to Slack", picks their Slack workspace and approves the app. Brainspace keeps the bot token, encrypted like any other connection credential, and agents and flows get these tools:

| Tool | What it does |
| --- | --- |
| `post_message` | Post to a channel (ID or `#name`) or DM someone (user ID or email). Takes standard Markdown (`markdown`) or Slack mrkdwn (`text`), plus optional Block Kit, thread, and a custom name and icon per post. |
| `update_message` | Edit a message the app posted. |
| `upload_file` | Share a Brainspace file or doc, or some text, as a file. |
| `list_channels` | Find channels and their IDs. |
| `find_user` | Look someone up by email or name. |

Three more tools, `read_messages`, `search_messages` and `view_file`, read Slack as a person instead of as the app. `view_file` opens a shared file by its id: an image comes back as an image, which an agent or a bot whose model has vision can look at, and a text file comes back as text. They work for someone who has connected their own Slack account (below). Only that person's own agents and private bots can use them: a team bot's runs are open to everyone, and a flow can run for other people.

## A person's own Slack account

Under the Slack connection, each person can connect their own Slack account ("Connect my Slack account", or the `slack_account` tool, which returns the link). They approve the app's user scopes in Slack, and Brainspace keeps their user token, encrypted, in `slack_account`. It is only ever used for that person:

- It stands in for a personal secret named `SLACK_USER_TOKEN`, bound to `slack.com`. Their flows use it with `secret('SLACK_USER_TOKEN')` to read Slack and post as them, and the three read tools above use it. A secret they saved under that name themselves still wins.
- Slack posts every message any connected person can see to `POST /api/slack/events`. Brainspace starts the Slack triggers (`flow_trigger_set` with `kind: "slack"` and `slack: { messages: true }`) of each connected person who is in that conversation. Slack names only one install per event, so for everyone else Brainspace asks Slack whether they are in the conversation, with their own token, and remembers the answer for ten minutes.
- When a flow or bot has the app post a message with buttons, Brainspace notes who it was posted for (`slack_post`: the channel, the message ts and the person). A click arrives at `POST /api/slack/interactions` and starts that person's Slack triggers that list the button's `action_id` under `slack.actions`. A card someone else had the app post never reaches them.

Brainspace keeps nothing from an event or a click itself. The payload is handed to the runs it starts, as their `body` input, or dropped. A run keeps its inputs like any other, which is why a trigger on messages only goes on a private flow. Disconnecting revokes the token in Slack and deletes the row.

Before this, each person made a Slack app of their own, saved its tokens as secrets and pointed its event and interactivity URLs at flow webhooks. That still works (a webhook trigger with `verify: { scheme: "slack", ... }`), and a saved `SLACK_USER_TOKEN` secret still comes first.

Code: `src/server/services/slack-account.ts`.

Posts come from the app. It can post in any public channel without joining. Private and Slack Connect channels need the app invited first (`/invite @Brainspace`).

A workspace that can't use Add to Slack can paste a bot token from its own Slack app instead.

## Bots in Slack

A bot's owner can turn Slack on for it (the Slack card on the bot's page, or `slack: true` on `bot_create` / `bot_update`). The bot then gets an @handle in Slack, which is a Slack user group the app creates, like `@monday-digest`. Someone mentions it in a channel, the bot runs with the request and the conversation around it, and its answer is posted in the thread under the bot's name. The person who asked can reply in that thread without mentioning the bot again, for a week.

- The app only sees channels it is in. Public or private, someone has to `/invite @Brainspace` first.
- A bot acts with its owner's access, so the app matches the Slack user's email to a member of the bot's Brainspace workspace before running it. A team bot answers any member or admin; a private bot answers only its owner. Anyone else gets a message only they can see, saying why.
- A team bot's runs are open to the whole Brainspace workspace, so when it's asked in a private channel it doesn't get the channel messages from before the request. Asked in a thread, it gets that thread, including what other people said in it, because asking there is asking about the thread.
- User groups need a paid Slack plan, and a workspace can stop members creating them. Where the app can't create one, the bot still works as `@Brainspace <bot name> ...`. That form also works for bots that have a handle. `@Brainspace` followed by anything else goes to the workspace's own bot.
- Each request is one run. Requests that arrive while the bot is busy wait their turn, and a bot takes at most 120 Slack requests an hour.

### The workspace's own bot

Every Brainspace workspace has one bot that needs no handle, because it is the app: `@Brainspace what changed in pricing this week?` goes to it whenever the words after the mention aren't another bot's name. It is on in Slack as soon as the workspace has a Slack connection that gets channel messages, and anyone can turn it off from its page.

It runs as the person who asked, in the team space, so there is no owner whose access it borrows. It can build flows, bots and artifacts for them, and change its own name and instructions when asked. If someone gives it a handle from its page, it gets a user group like any other bot and answers to both. When one Slack workspace is connected to several Brainspace workspaces someone belongs to, they have to start with the bot's name.

Code: `src/server/services/slack-bots.ts`. Events arrive at `POST /api/slack/events`.

Removing the connection deletes the token from Brainspace but leaves the app installed in Slack, because every install of the app in one Slack workspace shares a bot token and revoking it would cut off the others. To take the app out of Slack entirely, remove it under Slack's workspace settings → Manage apps.

## Setting up the app

One Slack app serves every Brainspace workspace. To create it:

1. Go to https://api.slack.com/apps, choose **Create New App → From a manifest**, pick any Slack workspace you admin (it only owns the app), and paste the manifest below. Change the redirect URL if you run your own copy.
2. Under **Basic Information**, upload the icon (`public/icon.svg` exported as a PNG, at least 512×512).
3. Under **Manage Distribution**, turn on public distribution so other Slack workspaces can install it. This doesn't list it in the Slack Marketplace.
4. Copy the **Client ID**, **Client Secret** and **Signing Secret** from **Basic Information** into the Worker:
   ```sh
   wrangler secret put SLACK_CLIENT_ID
   wrangler secret put SLACK_CLIENT_SECRET
   wrangler secret put SLACK_SIGNING_SECRET
   ```
5. Under **Event Subscriptions**, check that the request URL shows as verified. Slack checks it once the signing secret is in place.

Until the client ID and secret are set, the Slack connection only accepts bot tokens. Until the signing secret is set, bots can't be asked things in Slack.

```yaml
display_information:
  name: Brainspace
  description: Posts from your team's Brainspace flows and agents.
  long_description: Brainspace is a shared brain for a team's AI agents. This app lets the flows and agents in your Brainspace workspace post messages and files to your Slack channels and DMs, and lets your team ask Brainspace bots things by mentioning them. It posts in public channels, and in private or Slack Connect channels only after someone invites it. The app itself reads messages only in channels it has been added to, to answer the ones that mention a bot. A person can separately connect their own account, so their own automations can read the conversations they are in and draft or send replies as them.
  background_color: "#D6246E"
features:
  bot_user:
    display_name: Brainspace
    always_online: false
oauth_config:
  redirect_urls:
    - https://usebrain.space/api/connections/callback
    - https://usebrain.space/api/slack/account/callback
  scopes:
    user:
      - channels:history
      - groups:history
      - im:history
      - mpim:history
      - channels:read
      - groups:read
      - im:read
      - mpim:read
      - users:read
      - search:read
      - files:read
      - chat:write
    bot:
      - chat:write
      - chat:write.public
      - chat:write.customize
      - files:write
      - channels:read
      - groups:read
      - channels:join
      - im:write
      - users:read
      - users:read.email
      - usergroups:write
      - usergroups:read
      - channels:history
      - groups:history
settings:
  event_subscriptions:
    request_url: https://usebrain.space/api/slack/events
    bot_events:
      - message.channels
      - message.groups
    user_events:
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    is_enabled: true
    request_url: https://usebrain.space/api/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

The scopes have to match `SLACK_BOT_SCOPES` and `SLACK_USER_SCOPES` in `src/server/services/slack.ts`. The user scopes and user events are only used for people who connect their own account; nobody is asked for them when the app is added to a workspace. Adding a scope later means every workspace has to reinstall (Reinstall in Slack on the connection) before tools that need it work.

Slack only redirects to the URLs listed in the manifest, so local development (`http://localhost:...`) can't finish an install. Test locally with a bot token instead.
