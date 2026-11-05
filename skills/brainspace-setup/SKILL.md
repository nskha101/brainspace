---
name: brainspace-setup
description: Use when a Brainspace workspace is new or mostly empty, or when the user says "set up our brain", "set up Brainspace from our website", "fill in Brainspace" or "onboard our company". Builds the company overview, brand kit, voice guide and first skills from the company's website and the user's answers, then helps invite the team and connect tools.
---

# Set up a team brain

A new workspace has only `/team/README.md` and empty `company/`, `brand/` and `skills/` folders. You create the docs. Fill them with real, specific content in one session, without inventing facts.

## 1. Look at what's there

1. `whoami` for the workspace, your role and which connections exist. You need the member or admin role to write.
2. `list` with `path: "/team", depth: 3` to see what exists. People may have uploaded folders of docs or brand assets already.
3. `read` anything relevant that's there, and `search` for the company name, "brand" and "voice".

If real content already exists, build on it. Ask the user before replacing anything a person wrote.

## 2. Gather facts

Ask the user for the company's website if you don't have it. Then:

- If a Context.dev connection exists, use its brand and scrape tools on the domain for the description, logos, colors, fonts and social links.
- Otherwise read the site with whatever web tools you have.
- Ask the user the short list of things a website rarely says: who they sell to, why customers pick them over alternatives, and anything they never want said.

Write down only what a source or the user actually told you. Leave a visible `TODO:` line for anything you couldn't confirm.

## 3. Write the docs

Create these with `write` (or `edit` if they exist), each with a `description` and a clear `message`:

- `/team/company/overview.md` covers what the company does, who it serves, why people pick it, and what to never say.
- `/team/brand/brand-kit.md` gets real hex values and fonts. Upload logos with `upload` into `/team/brand/assets/` and `describe` each one. See the `brainspace-brand-kit` skill for asset naming.
- `/team/brand/voice.md` describes the tone from the site's real copy, with two or three short examples quoted from it.

Keep each doc short. A page an agent can read in one call beats a long one.

## 4. First skills

Ask the user for the two or three jobs their team asks agents to do most (weekly report, sales follow-up, release notes and so on). Draft one skill per job in `/me/skills/<name>/SKILL.md` following the `brainspace-skills` skill. Promote each one once the user approves it.

## 5. People and tools

- Offer to invite teammates with `member_invite`. Ask which role each person gets: admin, member or viewer.
- Offer to connect the tools they use with `connection_add`. See the `brainspace-connections` skill. For OAuth services, give the user the `authorizeUrl` to open.

## 6. Wrap up

Tell the user what you filled in, with full paths, and list every `TODO:` you left so they can answer them. Don't claim anything is done that you skipped.
