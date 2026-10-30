import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { aiRateLimit, requireRole } from '../middleware.js';
import { parseId } from '../resource.js';
import { audit } from '../lib/audit.js';
import { ENTITY_KEYS, assertRecordAccess } from '../lib/access.js';
import { LlmError, llmConfigured } from '../lib/llm.js';
import { loadTouches, scoreLead } from '../lib/scoring.js';
import { describeSpec, loadContext, parseQuery, parseWithAi, runSpec } from '../lib/nlsearch.js';
import { aiDraft, aiSummary, autoSummary, loadFacts, templateDraft } from '../lib/aiText.js';
import { logger } from '../logger.js';

export const aiRouter = Router();

const tenantAi = async (c, tenantId) =>
  (await c.query('SELECT ai_enabled FROM tenants WHERE id=$1', [tenantId])).rows[0]?.ai_enabled === true;

aiRouter.get('/status', async (req, res) => {
  const enabled = await withTenant(req.auth.tenantId, (c) => tenantAi(c, req.auth.tenantId));
  res.json({ llm_configured: llmConfigured(), enabled, ai_active: llmConfigured() && enabled });
});

aiRouter.patch('/settings', requireRole('admin'), async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const { tenantId, userId } = req.auth;
  await withTenant(tenantId, async (c) => {
    await c.query('UPDATE tenants SET ai_enabled=$2 WHERE id=$1', [tenantId, enabled]);
    await audit(c, tenantId, userId, enabled ? 'turned on' : 'turned off', 'workspace', tenantId, 'AI assistant');
  });
  res.json({ enabled });
});

// ---- Lead score: explainable, never leaves the server ----
aiRouter.get('/lead-score/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { tenantId } = req.auth;
  const out = await withTenant(tenantId, async (c) => {
    const lead = await assertRecordAccess(c, req.auth, 'lead', id);
    const touches = (await loadTouches(c, tenantId, [id])).get(id) ?? 0;
    return { current: lead.score, ...scoreLead(lead, touches) };
  });
  res.json(out);
});

aiRouter.post('/rescore', requireRole('admin'), async (req, res) => {
  const { tenantId, userId } = req.auth;
  const out = await withTenant(tenantId, async (c) => {
    const leads = (await c.query(`SELECT * FROM leads WHERE tenant_id=$1 AND status NOT IN ('converted')`, [tenantId])).rows;
    const touches = await loadTouches(
      c,
      tenantId,
      leads.map((l) => l.id),
    );
    let changed = 0;
    for (const l of leads) {
      const { score } = scoreLead(l, touches.get(l.id) ?? 0);
      if (score !== l.score) {
        await c.query('UPDATE leads SET score=$3 WHERE tenant_id=$1 AND id=$2', [tenantId, l.id, score]);
        changed++;
      }
    }
    await audit(c, tenantId, userId, 'rescored', 'lead', null, `${changed} of ${leads.length} leads`);
    return { checked: leads.length, changed };
  });
  res.json(out);
});

// ---- Summary ----
const recordRef = z.object({ entity: z.enum(ENTITY_KEYS), id: z.string().uuid() });

aiRouter.post('/summary', aiRateLimit, async (req, res) => {
  const b = recordRef.parse(req.body);
  const { tenantId } = req.auth;
  const { facts, useAi } = await withTenant(tenantId, async (c) => ({
    facts: await loadFacts(c, req.auth, b.entity, b.id),
    useAi: llmConfigured() && (await tenantAi(c, tenantId)),
  }));
  if (useAi) {
    try {
      return res.json({ mode: 'ai', text: await aiSummary(facts) });
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      logger.info({ err: e.message }, 'AI summary fell back to the built-in one');
    }
  }
  res.json({ mode: 'auto', text: autoSummary(facts) });
});

// ---- Email draft ----
aiRouter.post('/email-draft', aiRateLimit, async (req, res) => {
  const b = recordRef.extend({ goal: z.string().trim().max(300).optional() }).parse(req.body);
  const { tenantId, name } = req.auth;
  const goal = b.goal ?? '';
  const { facts, templates, tenantName, useAi } = await withTenant(tenantId, async (c) => ({
    facts: await loadFacts(c, req.auth, b.entity, b.id),
    templates: (await c.query('SELECT name,subject,body FROM email_templates WHERE tenant_id=$1', [tenantId])).rows,
    tenantName: (await c.query('SELECT name FROM tenants WHERE id=$1', [tenantId])).rows[0]?.name ?? '',
    useAi: llmConfigured() && (await tenantAi(c, tenantId)),
  }));
  if (useAi) {
    try {
      return res.json({ mode: 'ai', ...(await aiDraft(facts, name, tenantName, goal)) });
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      logger.info({ err: e.message }, 'AI draft fell back to a template');
    }
  }
  res.json({ mode: 'template', ...templateDraft(facts, name, goal, templates) });
});

// ---- Search in plain English ----
aiRouter.post('/search', aiRateLimit, async (req, res) => {
  const { query } = z.object({ query: z.string().trim().min(2, 'Type a question').max(300) }).parse(req.body);
  const { tenantId, role } = req.auth;
  const out = await withTenant(tenantId, async (c) => {
    const useAi = llmConfigured() && (await tenantAi(c, tenantId));
    const ctx = await loadContext(c, tenantId, true);
    const aiCtx = role === 'member' ? { ...ctx, people: [] } : ctx; // members never send teammates' names to the AI
    let spec;
    let mode = 'rules';
    if (useAi) {
      try {
        spec = await parseWithAi(query, aiCtx, role !== 'member');
        mode = 'ai';
      } catch (e) {
        if (!(e instanceof LlmError)) throw e;
        logger.info({ err: e.message }, 'AI search fell back to rules');
      }
    }
    spec ??= parseQuery(query, ctx);
    const result = await runSpec(c, req.auth, spec, ctx);
    return { mode, entity: spec.entity, interpretation: describeSpec(spec), notes: result.ignored, total: result.total, rows: result.rows };
  });
  res.json(out);
});
