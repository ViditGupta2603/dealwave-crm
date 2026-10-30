export const ENTITY_TABLE = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };
export const ENTITY_PATH = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };

/** Columns automations are allowed to change (never ids, stage or status). */
export const AUTOMATION_FIELDS = {
  lead: ['status', 'source', 'score', 'owner_id', 'title', 'city', 'notes'],
  contact: ['title', 'city', 'owner_id'],
  account: ['industry', 'city', 'state', 'owner_id', 'description'],
  deal: ['next_step', 'expected_close', 'owner_id', 'amount'],
};

export function recordName(entity, r) {
  if (entity === 'lead' || entity === 'contact') return [r.first_name, r.last_name].filter(Boolean).join(' ');
  return r.name || '';
}
