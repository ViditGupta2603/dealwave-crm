import { badRequest } from '../http.js';

export async function loadFieldDefs(c, tenantId, entity) {
  const { rows } = await c.query(
    'SELECT key,label,type,options,required FROM field_definitions WHERE tenant_id=$1 AND entity=$2 ORDER BY position, created_at',
    [tenantId, entity],
  );
  return rows;
}

/**
 * Validates tenant-defined custom fields. Returns only known keys, coerced to their type.
 * null / '' clears a key. When `partial` is true, missing required fields are not an error (PATCH).
 */
export function validateCustom(defs, input, partial) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const errors = {};
  for (const d of defs) {
    if (!(d.key in src)) {
      if (d.required && !partial) errors[d.key] = `${d.label} is required`;
      continue;
    }
    const v = src[d.key];
    if (v === null || v === '' || v === undefined) {
      if (d.required) errors[d.key] = `${d.label} is required`;
      else out[d.key] = null;
      continue;
    }
    switch (d.type) {
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) errors[d.key] = `${d.label} must be a number`;
        else out[d.key] = n;
        break;
      }
      case 'date':
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) out[d.key] = v.slice(0, 10);
        else errors[d.key] = `${d.label} must be a date`;
        break;
      case 'boolean':
        out[d.key] = v === true || v === 'true';
        break;
      case 'select':
        if (d.options.includes(String(v))) out[d.key] = String(v);
        else errors[d.key] = `${d.label} must be one of: ${d.options.join(', ')}`;
        break;
      default:
        out[d.key] = String(v).slice(0, 500);
    }
  }
  if (Object.keys(errors).length) throw badRequest('Some custom fields are invalid', { custom_data: errors });
  return out;
}

/** Merge a validated patch into stored data; nulls remove keys. */
export function mergeCustom(existing, patch) {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  return merged;
}
