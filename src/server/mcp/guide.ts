const files = import.meta.glob('../../../skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Agent skills that ship with Brainspace, keyed by folder name (packaged by scripts/build-skills.mjs). */
export const AGENT_SKILLS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, content]) => [path.split('/').at(-2)!, content]),
)

export { default as FLOW_SDK_TYPES } from '../flows/sdk.d.ts?raw'

const core = AGENT_SKILLS['brainspace']!
const connections = AGENT_SKILLS['brainspace-connections']!
const teamSkills = AGENT_SKILLS['brainspace-skills']!
const admin = AGENT_SKILLS['brainspace-admin']!
const flows = AGENT_SKILLS['brainspace-flows']!

export function skillDescription(md: string) {
  return md.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
}

const strip = (md: string) => md.replace(/^---[\s\S]*?---\s*/, '')

export const GUIDE = [core, connections, teamSkills, flows, admin].map(strip).join('\n\n---\n\n')

export const INSTRUCTIONS = `Brainspace is this team's shared brain: versioned docs and files in two spaces, team skills, and tools from connected services.

- Call whoami first. It returns your role, the skills and the connections.
- Paths start with a space: /team/... (shared with everyone) or /me/... (private to you).
- Search before creating docs. Read before writing. Prefer edit for changes, pass baseVersion with write, and always include a short commit message.
- Draft in /me and use promote to share with /team (ask the user first).
- If a team skill in skills_list matches the task, load it with skill_get and follow it.
- Tools from connected services appear as <slug>__<tool>. Big connections are left out of the list: find their tools with connection_tools (search by task), read schemas with connection_describe, run them with connection_call.
- Flows are team automations that run on demand, on a schedule or from a webhook. To build, run or schedule one, load the brainspace-flows skill (skill_get) and follow it.
- Errors include a hint. Follow it. "forbidden" means your role can't do it: tell the user.
- Call guide for the full manual.`
