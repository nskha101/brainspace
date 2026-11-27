import { defineFlow } from 'brainspace'

export default defineFlow(async ({ inputs, step, connections, ai }) => {
  const deals = await step.do('fetch open deals', { description: 'Pulls every open deal from HubSpot' }, () =>
    connections.call('hubspot', 'search_crm_objects', {
      objectType: 'deals',
      filterGroups: [{ filters: [{ propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' }] }],
      properties: ['dealname', 'amount', 'closedate', 'dealstage', 'hubspot_owner_id', 'notes_last_contacted', 'hs_lastmodifieddate'],
      limit: 100,
    }),
  )

  const report = await step.do('write review', { description: 'Picks out the stale and overdue deals and writes a review grouped by owner' }, () =>
    ai.write({
      task:
        `Find deals with no contact in ${inputs.stale_days}+ days or a close date already past. ` +
        'Group them by owner. For each: deal name, amount, stage, what is wrong, and one suggested next step. Finish with totals.',
      context: deals,
    }),
  )

  return { report }
})
