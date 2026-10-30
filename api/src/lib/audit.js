export async function audit(c, tenantId, userId, action, entity, entityId, label, changes) {
  await c.query(`INSERT INTO audit_logs (tenant_id,user_id,action,entity,entity_id,label,changes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    tenantId,
    userId,
    action,
    entity,
    entityId,
    label,
    changes ? JSON.stringify(changes) : null,
  ]);
}

export function diff(before, after, keys) {
  const out = {};
  for (const k of keys) {
    const a = before[k],
      b = after[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}
