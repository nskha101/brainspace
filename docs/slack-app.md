# The Brainspace Slack app

Slack is a built-in connection (`src/server/services/slack.ts`). A workspace adds it from Connections with "Add to Slack", picks their Slack workspace and approves the app. Brainspace keeps the bot token, encrypted like any other connection credential, and agents and flows get these tools:

| Tool | What it does |
| --- | --- |
| `post_message` | Post to a channel (ID or `#name`) or DM someone (user ID or email). Takes standard Markdown (`markdown`) or Slack mrkdwn (`text`), plus optional Block Kit, thread, and a custom name and icon per post. |
| `update_message` | Edit a message the app posted. |
| `upload_file` | Share a Brainspace file or doc, or some text, as a file. |
| `list_channels` | Find channels and their IDs. |
| `find_user` | Look someone up by email or name. |

People can also connect their own Slack account (the Slack inbox, on the Bots page). That gives two more tools, `read_messages` and `search_messages`, which read Slack as that person, and lets a private bot of theirs be woken by the DMs and @mentions they get. See "The Slack inbox" below.

Posts come from the app. It can post in any public channel without joining. Private and Slack Connect channels need the app invited first (`/invite @Brainspace`).

A workspace that can't use Add to Slack can paste a bot token from its own Slack app instead.

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

Until the first two are set, the Slack connection only accepts bot tokens. Until the signing secret is set, the Slack inbox is unavailable.

```yaml
display_information:
  name: Brainspace
  description: Posts from your team's Brainspace flows and agents.
  long_description: Brainspace is a shared brain for a team's AI agents. This app lets the flows and agents in your Brainspace workspace post messages and files to your Slack channels and DMs. It posts in public channels, and in private or Slack Connect channels only after someone invites it. The app itself doesn't read messages. A person can separately connect their own account, so a private bot of theirs is told about the DMs and mentions they get and can draft replies for them.
  background_color: "#D6246E"
features:
  bot_user:
    display_name: Brainspace
    always_online: false
oauth_config:
  redirect_urls:
    - https://usebrain.space/api/connections/callback
    - https://usebrain.space/api/slack/inbox/callback
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
settings:
  event_subscriptions:
    request_url: https://usebrain.space/api/slack/events
    user_events:
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

The bot scopes have to match `SLACK_BOT_SCOPES` in `src/server/services/slack.ts`, and the user scopes `SLACK_USER_SCOPES`. User scopes are only asked for when a person connects their own account, so adding them doesn't make workspaces reinstall. Adding a scope later means every workspace has to reinstall (Reinstall in Slack on the connection) before tools that need it work.

Slack only redirects to the URLs listed in the manifest, so local development (`http://localhost:...`) can't finish an install. Test locally with a bot token instead.

## The Slack inbox

A person connects their own Slack account from the Bots page (`src/server/services/slack-inbox.ts`). Slack asks them for the user scopes above, and Brainspace keeps their user token, encrypted, in `slack_inbox`. Their account has to be in the same Slack workspace as the Brainspace workspace's Slack connection, because drafts are sent through that app.

With user events turned on, Slack posts every message a connected person can see to `POST /api/slack/events`. The endpoint checks Slack's signature, answers straight away, and then works out whether the message is for someone:

- A direct message wakes the bot of the person it was sent to, if they have direct messages on.
- Any other message wakes the bot of each connected person it @mentions, if they have mentions on.
- A person's own messages, edits, deletes and anything an app posted are ignored.

Everything else is dropped without being stored. The only thing kept from an event is its id, for a day, so a redelivered event doesn't wake a bot twice.

The bot gets the message with the conversation around it (the thread, or the messages just before), read with that person's token, so forwarded messages and private channels are included. It can read further with `read_messages` and `search_messages`. Those two tools and the events only ever work for the person's own private bots and agents: a team bot's runs are open to everyone, and a flow can run for other people, so neither can read Slack as a person.

"Create one for me" on the Bots page makes a starter bot that is read-only, works out an answer, and DMs the person a draft in their voice. It never replies to anyone itself.
