// The made-up sales pipeline the homepage demos share: the flow writes it, the database holds it, the artifact draws it.

export const STAGES = ['Lead', 'Proposal', 'Negotiation', 'Won'] as const
export type Stage = (typeof STAGES)[number]

/** `by` is who last changed the row. A flow or an agent there is marked as agent work. */
export type Deal = { company: string; stage: Stage; amount: number; by: string; agent?: boolean }

export const START_DEALS: Deal[] = [
  { company: 'Northwind', stage: 'Won', amount: 18000, by: 'weekly-pipeline', agent: true },
  { company: 'Tidewater', stage: 'Negotiation', amount: 24000, by: 'weekly-pipeline', agent: true },
  { company: 'Halcyon Labs', stage: 'Proposal', amount: 24000, by: 'weekly-pipeline', agent: true },
  { company: 'Brightwater', stage: 'Proposal', amount: 12500, by: 'Priya Nair' },
  { company: 'Osprey Health', stage: 'Lead', amount: 15000, by: 'Cursor for Dev', agent: true },
  { company: 'Kestrel & Co', stage: 'Lead', amount: 9000, by: 'Maya Chen' },
]

export const openDeals = (deals: Deal[]) => deals.filter((d) => d.stage !== 'Won')
export const wonDeals = (deals: Deal[]) => deals.filter((d) => d.stage === 'Won')
export const sum = (deals: Deal[]) => deals.reduce((n, d) => n + d.amount, 0)
export const money = (n: number) => `$${n.toLocaleString('en-US')}`
