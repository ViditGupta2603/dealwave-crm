import { notFound } from '../http.js';

import { ENTITY_TABLE } from './entities.js';

export const ENTITY_KEYS = ['lead', 'contact', 'account', 'deal'];

/**
 * Confirms the record exists in the caller's workspace and, for members, that they own it.
 * Returns 404 (not 403) so people cannot probe for ids they are not allowed to see.
 */
export async function assertRecordAccess(c, auth, entity, id) {
  const params = [auth.tenantId, id];
  let vis = '';
  if (auth.role === 'member') {
    params.push(auth.userId);
    vis = ' AND owner_id=$3';
  }
  const { rows } = await c.query(`SELECT * FROM ${ENTITY_TABLE[entity]} WHERE tenant_id=$1 AND id=$2${vis}`, params);
  if (!rows[0]) throw notFound('Record not found');
  return rows[0];
}
