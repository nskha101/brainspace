type SeedDoc = { path: string; folder?: boolean; content?: string; description?: string }

/**
 * Deliberately thin. Agents build the brain out (see the brainspace-setup
 * skill), so this is only enough to show the conventions.
 */
export const SEED_DOCS: SeedDoc[] = [
  {
    path: '/team/README.md',
    description: 'How this brain is organized. Read this first.',
    content: `# Team brain

Shared with everyone in the workspace. Every change is versioned.

- \`/team/company/\` covers what we do and who we sell to.
- \`/team/brand/\` holds the brand kit, voice guide and assets.
- \`/team/skills/<name>/SKILL.md\` holds team playbooks for agents.

Add folders as you need them. Private drafts go in \`/me/\` until they're ready to promote.
`,
  },
  { path: '/team/company', folder: true },
  { path: '/team/brand', folder: true },
  { path: '/team/skills', folder: true },
]
