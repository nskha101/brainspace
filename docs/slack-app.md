# The Brainspace Slack app

Slack is a built-in connection (`src/server/services/slack.ts`). A workspace adds it from Connections with "Add to Slack", picks their Slack workspace and approves the app. Brainspace keeps the bot token, encrypted like any other connection credential, and agents and flows get these tools:

| Tool | What it does |
| --- | --- |
| `post_message` | Post to a channel (ID or `#name`) or DM someone (user ID or email). Takes standard Markdown (`markdown`) or Slack mrkdwn (`text`), plus optional Block Kit, thread, and a custom name and icon per post. |
| `update_message` | Edit a message the app posted. |
| `upload_file` | Share a Brainspace file or doc, or some text, as a file. |
| `list_channels` | Find channels and their IDs. |
| `find_user` | Look someone up by email or name. |

Three more tools, `read_messages`, `search_messages` and `view_file`, read Slack as a person instead of as the app. `view_file` opens a shared file by its id: an image comes back as an image, which an agent or a bot whose model has vision can look at, and a text file comes back as text. They work for someone who has saved their own Slack user token (`xoxp-...`) as a personal secret named `SLACK_USER_TOKEN`, bound to `slack.com`. The token comes from a Slack app of their own with user scopes (`channels:history`, `groups:history`, `im:history`, `mpim:history`, the matching `:read` scopes, `users:read`, `search:read` for search, and `files:read` for `view_file`). Only that person's own agents and private bots can use them: a team bot's runs are open to everyone, and a flow can run for other people. The same app can post its events to a flow's webhook, which is how a flow reacts to someone's DMs and mentions. Save that app's signing secret as a secret with no hosts and set `verify: { scheme: "slack", secret: "<its name>" }` on the webhook trigger, so only requests Slack signed start a run.

Posts come from the app. It can post in any public channel without joining. Private and Slack Connect channels need the app invited first (`/invite @Brainspace`).

A workspace that can't use Add to Slack can paste a bot token from its own Slack app instead.

## Bots in Slack

A bot's owner can turn Slack on for it (the Slack card on the bot's page, or `slack: true` on `bot_create` / `bot_update`). The bot then gets an @handle in Slack, which is a Slack user group the app creates, like `@monday-digest`. Someone mentions it in a channel, the bot runs with the request and the conversation around it, and its answer is posted in the thread under the bot's name. The person who asked can reply in that thread without mentioning the bot again, for a week.

- The app only sees channels it is in. Public or private, someone has to `/invite @Brainspace` first.
- A bot acts with its owner's access, so the app matches the Slack user's email to a member of the bot's Brainspace workspace before running it. A team bot answers any member or admin; a private bot answers only its owner. Anyone else gets a message only they can see, saying why.
- A team bot's runs are open to the whole Brainspace workspace, so when it's asked in a private channel it only gets the asker's own messages and the bots' answers from that thread, not what other people said there.
- User groups need a paid Slack plan, and a workspace can stop members creating them. Where the app can't create one, the bot still works as `@Brainspace <bot name> ...`. That form also works for bots that have a handle.
- Each request is one run. Requests that arrive while the bot is busy wait their turn, and a bot takes at most 120 Slack requests an hour.

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
  long_description: Brainspace is a shared brain for a team's AI agents. This app lets the flows and agents in your Brainspace workspace post messages and files to your Slack channels and DMs, and lets your team ask Brainspace bots things by mentioning them. It posts in public channels, and in private or Slack Connect channels only after someone invites it. It reads messages only in channels it has been added to, to answer the ones that mention a bot.
  background_color: "#D6246E"
features:
  bot_user:
    display_name: Brainspace
    always_online: false
oauth_config:
  redirect_urls:
    - https://usebrain.space/api/connections/callback
  scopes:
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
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

The scopes have to match `SLACK_BOT_SCOPES` in `src/server/services/slack.ts`. Adding a scope later means every workspace has to reinstall (Reinstall in Slack on the connection) before tools that need it work.

Slack only redirects to the URLs listed in the manifest, so local development (`http://localhost:...`) can't finish an install. Test locally with a bot token instead.
