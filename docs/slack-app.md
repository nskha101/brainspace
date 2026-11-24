# The Brainspace Slack app

Slack is a built-in connection (`src/server/services/slack.ts`). A workspace adds it from Connections with "Add to Slack", picks their Slack workspace and approves the app. Brainspace keeps the bot token, encrypted like any other connection credential, and agents and flows get these tools:

| Tool | What it does |
| --- | --- |
| `post_message` | Post to a channel (ID or `#name`) or DM someone (user ID or email). Takes standard Markdown (`markdown`) or Slack mrkdwn (`text`), plus optional Block Kit, thread, and a custom name and icon per post. |
| `update_message` | Edit a message the app posted. |
| `upload_file` | Share a Brainspace file or doc, or some text, as a file. |
| `list_channels` | Find channels and their IDs. |
| `find_user` | Look someone up by email or name. |

Posts come from the app. It can post in any public channel without joining. Private and Slack Connect channels need the app invited first (`/invite @Brainspace`).

A workspace that can't use Add to Slack can paste a bot token from its own Slack app instead.

Removing the connection deletes the token from Brainspace but leaves the app installed in Slack, because every install of the app in one Slack workspace shares a bot token and revoking it would cut off the others. To take the app out of Slack entirely, remove it under Slack's workspace settings → Manage apps.

## Setting up the app

One Slack app serves every Brainspace workspace. To create it:

1. Go to https://api.slack.com/apps, choose **Create New App → From a manifest**, pick any Slack workspace you admin (it only owns the app), and paste the manifest below. Change the redirect URL if you run your own copy.
2. Under **Basic Information**, upload the icon (`public/icon.svg` exported as a PNG, at least 512×512).
3. Under **Manage Distribution**, turn on public distribution so other Slack workspaces can install it. This doesn't list it in the Slack Marketplace.
4. Copy the **Client ID** and **Client Secret** from **Basic Information** into the Worker:
   ```sh
   wrangler secret put SLACK_CLIENT_ID
   wrangler secret put SLACK_CLIENT_SECRET
   ```

Until both are set, the Slack connection only accepts bot tokens.

```yaml
display_information:
  name: Brainspace
  description: Posts from your team's Brainspace flows and agents.
  long_description: Brainspace is a shared brain for a team's AI agents. This app lets the flows and agents in your Brainspace workspace post messages and files to your Slack channels and DMs. It posts in public channels, and in private or Slack Connect channels only after someone invites it. It doesn't read messages.
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
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

The scopes have to match `SLACK_BOT_SCOPES` in `src/server/services/slack.ts`. Adding a scope later means every workspace has to reinstall (Reinstall in Slack on the connection) before tools that need it work.

Slack only redirects to the URLs listed in the manifest, so local development (`http://localhost:...`) can't finish an install. Test locally with a bot token instead.
