// Starter flows. flow_create copies one into /me/flows/<name>.
const manifests = import.meta.glob('./templates/*/FLOW.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const codes = import.meta.glob('./templates/*/flow.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const META: Record<string, { title: string; needs: string[] }> = {
  blank: { title: 'Blank flow', needs: [] },
  'competitor-digest': { title: 'Competitor digest', needs: ['Context.dev connection', 'AI'] },
  'stale-doc-review': { title: 'Stale doc review', needs: ['AI'] },
  'meeting-actions': { title: 'Meeting notes to action items', needs: ['AI'] },
  'document-intake': { title: 'Document intake', needs: ['AI'] },
  'posthog-weekly': { title: 'PostHog weekly metrics', needs: ['PostHog connection', 'AI'] },
  'hubspot-pipeline': { title: 'HubSpot pipeline review', needs: ['HubSpot connection', 'AI'] },
}

export type FlowTemplate = { id: string; title: string; description: string; needs: string[]; manifest: string; code: string }

export const TEMPLATES: FlowTemplate[] = Object.keys(manifests)
  .map((key) => {
    const id = key.split('/')[2]!
    const manifest = manifests[key]!
    const code = codes[`./templates/${id}/flow.ts`] ?? ''
    const description = manifest.match(/^description: (.*)$/m)?.[1]?.trim() ?? ''
    return { id, title: META[id]?.title ?? id, needs: META[id]?.needs ?? [], description, manifest, code }
  })
  .sort((a, b) => (a.id === 'blank' ? -1 : b.id === 'blank' ? 1 : a.title.localeCompare(b.title)))
