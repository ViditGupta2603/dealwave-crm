import { PLANS } from '../plans.js';
import { HttpError } from '../http.js';

export async function getPlan(c, tenantId) {
  const { rows } = await c.query('SELECT plan FROM tenants WHERE id=$1', [tenantId]);
  return PLANS[rows[0]?.plan || 'free'];
}

export async function usage(c, tenantId) {
  const { rows } = await c.query(
    `SELECT
      (SELECT count(*) FROM users WHERE tenant_id=$1 AND active) + (SELECT count(*) FROM invitations WHERE tenant_id=$1 AND accepted_at IS NULL AND expires_at > now()) AS users,
      (SELECT count(*) FROM leads WHERE tenant_id=$1) + (SELECT count(*) FROM contacts WHERE tenant_id=$1) +
      (SELECT count(*) FROM accounts WHERE tenant_id=$1) + (SELECT count(*) FROM deals WHERE tenant_id=$1) AS records,
      (SELECT count(*) FROM workflow_rules WHERE tenant_id=$1) AS workflows`,
    [tenantId],
  );
  return rows[0];
}

export async function assertWithinLimit(c, tenantId, kind, adding = 1) {
  const plan = await getPlan(c, tenantId);
  const max = plan.limits[kind];
  if (max === null) return;
  const u = await usage(c, tenantId);
  if (u[kind] + adding > max) {
    throw new HttpError(402, `Your ${plan.name} plan allows up to ${max.toLocaleString('en-IN')} ${kind}. Upgrade the plan to add more.`);
  }
}
