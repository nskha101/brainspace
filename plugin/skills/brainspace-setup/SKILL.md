---
name: brainspace-setup
description: Use when someone has just connected their agent to Brainspace, when a workspace is new or mostly empty, or when the user says "set up our brain", "set up Brainspace from our website", "fill in Brainspace", "walk me through Brainspace", "onboard me" or "onboard our company". Runs the person through first-time setup: what Brainspace is, connecting their tools, the company overview, brand kit and voice guide, first skills, a first flow, and inviting the team.
---

# Run someone through setting up Brainspace

You're the person's guide for their first session. You do the work; they answer questions and approve. Take one stage at a time: say what it's for in a sentence, do it, say what's next. They can skip any stage, and you don't need to show them the whole plan up front.

## 0. Look at what's there

1. `whoami` for the workspace, your role, the skills, connections, flows and bots. You need the member or admin role to write.
2. `list` with `path: "/team", depth: 3`. People may have uploaded folders of docs or brand assets already.
3. Pick the route:
   - New workspace (the team space is nearly empty, or `whoami` returns a `suggestion` saying so) and you're a member or admin: do every stage below.
   - The person joined a workspace their team already set up: give them the tour (stage 1) using what's actually in it, sign them in to any connection that shows `needs_auth` (`connection_authorize`, then give them the link), and offer to bring in what they already know with the `brainspace-import` skill. Skip the rest.
   - Read-only role: the tour only. They can read and search, not write.

## 1. Explain Brainspace in a minute

Most people arrive not knowing what the parts are. Explain them in plain words, in about ten lines, not a feature list. Once you know their company, use one of their own examples. The parts:

- Spaces. `/team` is shared with everyone and `/me` is private. Every save is a version that records the person and the agent who made it.
- Skills. Playbooks saved in the workspace, like how the team writes release notes. Every connected agent loads the same one.
- Connections. A tool such as Slack, HubSpot or Linear, connected once for the workspace. Every agent, flow and bot uses its tools through Brainspace, and the keys never leave the server. A connection either uses one shared account or has each person sign in.
- Flows. Automations that you (the agent) write and Brainspace runs on demand, on a schedule or from a webhook. A step can call any connected tool, use an AI model, update docs and databases, post to Slack, send email or wait for someone's approval.
- Databases and artifacts. Records that change (customers, deals, feedback) live in a database. An artifact is a page built on top of one, such as a dashboard or a tracker.
- Bots. Agents with a standing job and their own schedule, for work that needs judgment, like a morning brief.
- Sharing and permissions. Drafts start in `/me` and get promoted to `/team`. Admins can limit a team folder to certain people. Roles are admin, member and read-only, and an agent gets exactly the role of the person it acts for.

If they'd like to see it, the welcome page in the app has a walkthrough with examples: `<app>/welcome`, using the `app` URL from `whoami`.

## 2. Connect their tools

Ask which tools the team uses day to day. Then suggest the ones that pay off first, based on what they said:

| If they | Suggest | Why |
| --- | --- | --- |
| want the brand kit filled in from their site | Context.dev | brand data, logos, colors and fonts, plus text search inside uploaded PDFs |
| use Slack | Slack | flows and bots can post digests, alerts and approval requests |
| use Google Workspace | Google Drive | agents read Docs, Sheets and PDFs; each person connects their own Drive |
| keep a wiki in Notion | Notion | agents read existing pages while the important ones move into the brain |
| track work in Linear, GitHub or Sentry | that tool | issues, PRs and errors for agents, bots and release notes |
| sell with HubSpot | HubSpot | deals and contacts for agents and a pipeline review flow |
| measure with PostHog or bill with Stripe | that tool | metrics and revenue for reports and dashboards |

Connect two or three now, not everything. Follow the `brainspace-connections` skill. OAuth services (Slack, Linear, Notion, Sentry) need nothing up front: call `connection_add` and give the person the `authorizeUrl`. For services that take an API key, point them to `<app>/app/connections` so the key goes straight into Brainspace rather than into this chat. If they'd rather paste it to you, that works too. Run `connection_test` on each one, and add short `instructions` saying when agents should use it.

## 3. Fill in the company docs

Ask for the company's website if you don't have it. Then:

- With Context.dev connected, use its brand and scrape tools on the domain for the description, logos, colors, fonts and social links.
- Otherwise read the site with whatever web tools you have.
- Ask the short list of things a website rarely says: who they sell to, why customers pick them over alternatives, and anything they never want said.

Write down only what a source or the person actually told you. Leave a visible `TODO:` line for anything you couldn't confirm. If real content already exists, build on it, and ask before replacing anything a person wrote.

Create these with `write` (or `edit` if they exist), each with a `description` and a clear `message`:

- `/team/company/overview.md` covers what the company does, who it serves, why people pick it, and what never to say.
- `/team/brand/brand-kit.md` gets real hex values and fonts. Upload logos with `upload` into `/team/brand/assets/` and `describe` each one. See the `brainspace-brand-kit` skill for asset naming.
- `/team/brand/voice.md` describes the tone from the site's real copy, with two or three short examples quoted from it.

Keep each doc short. A page an agent can read in one call beats a long one. Give `/team/company` and `/team/brand` folder notes with `folder_notes`: which doc to read first, where assets go, and how to name new files.

## 4. First skills

Ask for the two or three jobs their team asks agents to do most (weekly report, sales follow-up, release notes and so on). Draft one skill per job in `/me/skills/<name>/SKILL.md` following the `brainspace-skills` skill. Promote each one once they approve it, and explain that every agent on the team now follows it.

## 5. A first automation

Suggest one thing that runs without them, built on what they connected. Pick the one that fits best and explain it in a sentence:

- PostHog: a weekly metrics flow posted to Slack (`flow_templates` has `posthog-weekly`).
- HubSpot: a pipeline review flow that flags quiet deals (`hubspot-pipeline`), or a dashboard artifact of open deals.
- Slack with Linear or GitHub: a bot that DMs them a morning brief of what's blocked.
- They take meeting notes: a flow that turns notes into action items after they approve them (`meeting-actions`).
- They watch competitors: a weekly digest (`competitor-digest`).
- Nothing connected yet: a flow that summarizes new files dropped into a folder (`document-intake`) or flags stale docs (`stale-doc-review`).

Build it only once they say yes. Load `brainspace-flows`, `brainspace-bots` or `brainspace-artifacts` with `skill_get` and follow it, test it before switching on a schedule, and keep it in `/me` until they want to share it.

## 6. Bring in the team

- Offer to invite teammates with `member_invite`. Ask which role each person gets: admin (everything, including deleting team files and managing people), member (everything except destructive actions) or read-only.
- If something in `/team` should stay with a few people, like finance or hiring, offer to restrict that folder with `access_set` after checking the list of names with them.
- Each teammate connects their own agent, which works with their role. The app's welcome page walks them through it.

## 7. Wrap up

Tell them what you set up, with full paths, and list every `TODO:` you left so they can answer them. Say what's still pending, such as a sign-in they haven't finished. Don't claim anything is done that you skipped or that failed. End with two or three things to try next, based on what they now have, such as a prompt that uses a new skill or a connected tool.
