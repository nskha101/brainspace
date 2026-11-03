type SeedDoc = { path: string; folder?: boolean; content?: string; description?: string }

export const SEED_DOCS: SeedDoc[] = [
  {
    path: '/team/README.md',
    description: 'How this brain is organized. Read this first.',
    content: `# Team brain

This is the shared drive. Everyone in the workspace can read it, and any member can edit it. Every change is versioned, so nothing is lost when someone (or some agent) rewrites a page.

## Layout

- \`/team/company/\` covers what we do, who we sell to and how we talk about it.
- \`/team/brand/\` is the brand kit: voice, colors, type, logos and other assets.
- \`/team/skills/\` holds agent skills. Each one is a folder with a \`SKILL.md\`.
- \`/team/projects/\` has one folder per project for briefs, decisions and notes.

Your private drive lives at \`/me/\`. Draft there, then promote to \`/team/\` when it's ready.

## House rules for agents

1. Read before you write. Use \`search\` or \`list\` to find the existing page instead of creating a near-duplicate.
2. Prefer \`edit\` over \`write\` for changes to existing docs, and always leave a short commit message.
3. Keep one topic per doc. Link related docs with their full path, e.g. \`/team/brand/voice.md\`.
4. Never paste secrets (API keys, passwords) into docs. Connections hold credentials.
`,
  },
  {
    path: '/team/company/overview.md',
    description: 'One-page company overview: product, customers, positioning.',
    content: `# Company overview

> Fill this in. Agents read it before writing anything customer-facing.

## What we do

## Who we sell to

## Why people pick us

## What we never say
`,
  },
  {
    path: '/team/brand/brand-kit.md',
    description: 'Brand kit: logo usage, colors, typography. Assets live in /team/brand/assets/.',
    content: `# Brand kit

## Logo

Files live in \`/team/brand/assets/\`. Describe each one with \`describe\` so agents know which to use where.

## Colors

| Name | Hex | Use |
| --- | --- | --- |
| Primary | #000000 | Buttons, links |
| Background | #FFFFFF | Page background |

## Typography

- Headings:
- Body:
`,
  },
  {
    path: '/team/brand/voice.md',
    description: 'How we write: tone, words we use and avoid, examples.',
    content: `# Voice

## Tone

Plain, direct, specific. Write like a smart colleague explaining something over coffee.

## Do

- Lead with the point.
- Use concrete numbers and names.
- Keep sentences short when the idea is simple.

## Don't

- Use filler like "in today's fast-paced world".
- Stack adjectives ("powerful, seamless, innovative").
- Use em dashes. Use a period or a comma.
`,
  },
  { path: '/team/brand/assets', folder: true },
  {
    path: '/team/skills/README.md',
    description: 'How team skills work and how to add one.',
    content: `# Skills

A skill is a folder with a \`SKILL.md\` file that teaches an agent how to do one job the way this team does it.

\`\`\`
/team/skills/<skill-name>/SKILL.md
/team/skills/<skill-name>/examples.md   (optional supporting files)
\`\`\`

\`SKILL.md\` starts with frontmatter:

\`\`\`markdown
---
name: brand-voice
description: Use when writing anything customer-facing. Applies our tone and word list.
---

Instructions go here.
\`\`\`

Agents find skills with \`skills_list\` and load one with \`skill_get\`. Skills in \`/me/skills/\` are private to you.
`,
  },
  {
    path: '/team/skills/brand-voice/SKILL.md',
    description: 'Write in the team voice. Use for any customer-facing copy.',
    content: `---
name: brand-voice
description: Use when writing or editing anything customer-facing (emails, landing pages, posts, docs). Applies the team's voice and checks the draft against the brand kit.
---

# Brand voice

1. Read \`/team/brand/voice.md\` and \`/team/company/overview.md\`.
2. Draft the copy.
3. Check the draft against every "Don't" in the voice doc and fix what you find.
4. If you invented a fact about the company, flag it to the user instead of shipping it.
`,
  },
  { path: '/team/projects', folder: true },
]
