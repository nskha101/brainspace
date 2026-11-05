// Packages skills/ for every way agents install them, into public/:
//   /.well-known/agent-skills/index.json + <name>.zip   `npx skills add https://usebrain.space`
//   /marketplace.json + /plugin/brainspace-<hash>.zip   Claude Code plugin (skills + MCP server)
//   /brainspace.plugin                                  same plugin, uploaded into Claude Cowork
//   /skills/<name>/...                                  raw files, read by install.sh
//   /install.sh                                         curl | sh installer
// Zips are deterministic (fixed mtimes, sorted entries) so digests only change with content.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'

const APP = 'https://usebrain.space'
const SRC = 'skills'
const OUT = 'public'
const MTIME = new Date('2026-01-01T00:00:00Z')
const VERSION_FILE = join(SRC, '.plugin-version.json')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function walk(dir) {
  return readdirSync(dir)
    .flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
    .sort()
}

function zip(entries) {
  const files = {}
  for (const [path, data] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    files[path] = [data, { mtime: MTIME, level: 9 }]
  }
  return Buffer.from(zipSync(files))
}

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/)
  const data = {}
  for (const line of m?.[1].split('\n') ?? []) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (kv) data[kv[1]] = kv[2].trim()
  }
  return data
}

const skills = readdirSync(SRC)
  .filter((d) => existsSync(join(SRC, d, 'SKILL.md')))
  .sort((a, b) => (a === 'brainspace' ? -1 : b === 'brainspace' ? 1 : a.localeCompare(b)))
  .map((name) => {
    const dir = join(SRC, name)
    const files = Object.fromEntries(walk(dir).map((p) => [relative(dir, p), readFileSync(p)]))
    const fm = frontmatter(files['SKILL.md'].toString())
    if (fm.name !== name) throw new Error(`${name}/SKILL.md frontmatter name is "${fm.name}"`)
    if (!fm.description) throw new Error(`${name}/SKILL.md has no description`)
    // Claude's plugin upload rejects any description containing XML tags, e.g. "<website>".
    if (/[<>]/.test(fm.description)) throw new Error(`${name}/SKILL.md description contains < or >, which Claude rejects as XML tags`)
    return { name, description: fm.description, files }
  })

for (const p of ['.well-known/agent-skills', 'plugin', 'skills']) rmSync(join(OUT, p), { recursive: true, force: true })
mkdirSync(join(OUT, '.well-known/agent-skills'), { recursive: true })
mkdirSync(join(OUT, 'plugin'), { recursive: true })

// 1. Agent Skills discovery index (skills.sh and other installers)
const index = { $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills: [] }
for (const s of skills) {
  const buf = zip(s.files)
  writeFileSync(join(OUT, '.well-known/agent-skills', `${s.name}.zip`), buf)
  index.skills.push({ name: s.name, description: s.description, type: 'archive', url: `${s.name}.zip`, digest: `sha256:${sha256(buf)}` })
  for (const [rel, data] of Object.entries(s.files)) {
    const target = join(OUT, 'skills', s.name, rel)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, data)
  }
}
writeFileSync(join(OUT, '.well-known/agent-skills/index.json'), JSON.stringify(index, null, 2))

// 2. Claude Code plugin: the skills plus the MCP server, in one install
const contentHash = sha256(Buffer.concat(skills.flatMap((s) => Object.entries(s.files).flatMap(([p, d]) => [Buffer.from(s.name + '/' + p), d]))))
let versionInfo = existsSync(VERSION_FILE) ? JSON.parse(readFileSync(VERSION_FILE, 'utf8')) : { version: '1.0.0', hash: '' }
if (versionInfo.hash !== contentHash) {
  const [maj, min, patch] = versionInfo.version.split('.').map(Number)
  versionInfo = { version: versionInfo.hash ? `${maj}.${min}.${patch + 1}` : versionInfo.version, hash: contentHash }
  writeFileSync(VERSION_FILE, JSON.stringify(versionInfo, null, 2) + '\n')
}
const description = "Connects your agent to your team's Brainspace: versioned docs, brand kit, team skills and connected tools, plus skills that teach the agent how to use them."
const pluginFiles = {
  '.claude-plugin/plugin.json': Buffer.from(
    JSON.stringify(
      { name: 'brainspace', version: versionInfo.version, description, author: { name: 'Brainspace', email: 'hello@usebrain.space' }, homepage: APP },
      null,
      2,
    ),
  ),
  '.mcp.json': Buffer.from(JSON.stringify({ mcpServers: { brainspace: { type: 'http', url: `${APP}/mcp` } } }, null, 2)),
  'README.md': Buffer.from(
    `# Brainspace plugin\n\nAdds the Brainspace MCP server (${APP}/mcp) and these skills:\n\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}\n\nAfter installing, run /mcp and sign in to brainspace.\n`,
  ),
}
for (const s of skills) for (const [rel, data] of Object.entries(s.files)) pluginFiles[`skills/${s.name}/${rel}`] = data
const pluginZip = zip(pluginFiles)
const pluginName = `brainspace-${versionInfo.version}-${sha256(pluginZip).slice(0, 8)}.zip`
writeFileSync(join(OUT, 'plugin', pluginName), pluginZip)
// Claude Cowork installs the same package from a file: Customize > Plugins > Upload plugin.
writeFileSync(join(OUT, 'brainspace.plugin'), pluginZip)
writeFileSync(
  join(OUT, 'marketplace.json'),
  JSON.stringify(
    {
      name: 'brainspace',
      owner: { name: 'Brainspace', email: 'hello@usebrain.space' },
      metadata: { description: 'Brainspace for Claude Code' },
      plugins: [
        {
          name: 'brainspace',
          description,
          version: versionInfo.version,
          homepage: APP,
          source: { source: 'archive', url: `${APP}/plugin/${pluginName}`, sha256: sha256(pluginZip) },
        },
      ],
    },
    null,
    2,
  ),
)

// 3. curl | sh installer
const fileList = skills.flatMap((s) => Object.keys(s.files).map((rel) => `${s.name}/${rel}`))
writeFileSync(
  join(OUT, 'install.sh'),
  `#!/bin/sh
# Installs the Brainspace agent skills (v${versionInfo.version}). Re-run any time to update.
#   curl -fsSL ${APP}/install.sh | sh
# Installs into ~/.claude/skills (Claude Code) and ~/.agents/skills (Codex, Cursor,
# Gemini CLI and other agents that read the shared directory).
# Set BRAINSPACE_SKILLS_DIR to install into one directory instead.
set -e
if [ -n "$BRAINSPACE_SKILLS_DIR" ]; then
  DIRS="$BRAINSPACE_SKILLS_DIR"
else
  DIRS="$HOME/.claude/skills $HOME/.agents/skills"
fi
for DEST in $DIRS; do
  for f in ${fileList.join(' ')}; do
    mkdir -p "$DEST/$(dirname "$f")"
    curl -fsSL "${APP}/skills/$f" -o "$DEST/$f"
  done
  echo "Installed ${skills.length} Brainspace skills into $DEST"
done
echo ""
echo "Next, connect the MCP server. For Claude Code:"
echo "  claude mcp add --transport http --scope user brainspace ${APP}/mcp"
echo "For Codex:"
echo "  codex mcp add brainspace --url ${APP}/mcp && codex mcp login brainspace"
`,
)

console.log(`skills: ${skills.map((s) => s.name).join(', ')}`)
console.log(`plugin ${versionInfo.version} -> public/plugin/${pluginName}`)
