import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { audit } from '../lib/audit.js';
import { withTenant } from '../db.js';
import { requireRole } from '../middleware.js';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', async (req, res) => {
  const { tenantId, userId, role } = req.auth;
  const scope = role === 'member' ? userId : null; // members only see their own numbers
  const p = [tenantId, scope];
  const out = await withTenant(tenantId, async (c) => {
    const [deals, leads, stages, sources, months, board, tasks, recent, leadStatus] = await Promise.all([
      c.query(
        `SELECT
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='open'),0) AS pipeline_value,
          COALESCE(SUM(d.amount * s.probability / 100.0) FILTER (WHERE d.status='open'),0) AS weighted_forecast,
          COUNT(*) FILTER (WHERE d.status='open') AS open_deals,
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='won' AND d.closed_at >= date_trunc('month', now())),0) AS won_month,
          COUNT(*) FILTER (WHERE d.status='won' AND d.closed_at >= date_trunc('month', now())) AS won_month_count,
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='won' AND d.closed_at >= date_trunc('month', now()) - interval '1 month' AND d.closed_at < date_trunc('month', now())),0) AS won_prev_month,
          COUNT(*) FILTER (WHERE d.status='won' AND d.closed_at > now() - interval '90 days') AS won_90,
          COUNT(*) FILTER (WHERE d.status='lost' AND d.closed_at > now() - interval '90 days') AS lost_90,
          COALESCE(AVG(d.amount) FILTER (WHERE d.status='won' AND d.closed_at > now() - interval '90 days'),0) AS avg_won_size
        FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id WHERE d.tenant_id=$1 AND ($2::uuid IS NULL OR d.owner_id=$2)`,
        p,
      ),
      c.query(
        `SELECT
          COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') AS new_30,
          COUNT(*) FILTER (WHERE created_at <= now() - interval '30 days' AND created_at > now() - interval '60 days') AS prev_30,
          COUNT(*) AS total, COUNT(*) FILTER (WHERE status='converted') AS converted
        FROM leads WHERE tenant_id=$1 AND ($2::uuid IS NULL OR owner_id=$2)`,
        p,
      ),
      c.query(
        `SELECT s.id, s.name, s.position, s.color, s.probability, s.is_won, s.is_lost, COUNT(d.id) AS count, COALESCE(SUM(d.amount),0) AS value
        FROM pipeline_stages s LEFT JOIN deals d ON d.stage_id=s.id AND ($2::uuid IS NULL OR d.owner_id=$2)
        WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY s.position`,
        p,
      ),
      c.query(
        `SELECT COALESCE(source,'Unknown') AS source, COUNT(*) AS count FROM leads WHERE tenant_id=$1 AND ($2::uuid IS NULL OR owner_id=$2)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        p,
      ),
      c.query(
        `SELECT to_char(m,'Mon') AS label, to_char(m,'YYYY-MM') AS month, COALESCE(SUM(d.amount),0) AS won, COUNT(d.id) AS count
        FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
        LEFT JOIN deals d ON d.tenant_id=$1 AND d.status='won' AND date_trunc('month', d.closed_at) = m AND ($2::uuid IS NULL OR d.owner_id=$2)
        GROUP BY m ORDER BY m`,
        p,
      ),
      c.query(
        `SELECT u.id, u.name, u.title,
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='won' AND d.closed_at >= date_trunc('quarter', now())),0) AS won_value,
          COUNT(d.id) FILTER (WHERE d.status='won' AND d.closed_at >= date_trunc('quarter', now())) AS won_count,
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='open'),0) AS open_value
        FROM users u LEFT JOIN deals d ON d.owner_id=u.id WHERE u.tenant_id=$1 AND u.active
        GROUP BY u.id ORDER BY won_value DESC, open_value DESC LIMIT 6`,
        [tenantId],
      ),
      c.query(
        `SELECT a.id, a.subject, a.type, a.priority, a.due_at, a.related_type, a.related_id
        FROM activities a WHERE a.tenant_id=$1 AND a.owner_id=$2 AND a.completed_at IS NULL AND a.type='task'
        ORDER BY a.due_at NULLS LAST LIMIT 6`,
        [tenantId, userId],
      ),
      c.query(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.label, a.created_at, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.user_id=$2) ORDER BY a.created_at DESC LIMIT 8`,
        p,
      ),
      c.query(`SELECT status, COUNT(*) AS count FROM leads WHERE tenant_id=$1 AND ($2::uuid IS NULL OR owner_id=$2) GROUP BY status`, p),
    ]);
    const d = deals.rows[0],
      l = leads.rows[0];
    const closed90 = d.won_90 + d.lost_90;
    return {
      scope: scope ? 'mine' : 'team',
      kpis: {
        pipeline_value: d.pipeline_value,
        weighted_forecast: d.weighted_forecast,
        open_deals: d.open_deals,
        won_month: d.won_month,
        won_month_count: d.won_month_count,
        won_prev_month: d.won_prev_month,
        win_rate: closed90 ? Math.round((d.won_90 / closed90) * 100) : null,
        avg_won_size: d.avg_won_size,
        new_leads_30: l.new_30,
        new_leads_prev_30: l.prev_30,
        total_leads: l.total,
        lead_conversion: l.total ? Math.round((l.converted / l.total) * 100) : null,
      },
      stages: stages.rows,
      lead_sources: sources.rows,
      revenue_by_month: months.rows,
      leaderboard: role === 'member' ? [] : board.rows,
      tasks: tasks.rows,
      recent_activity: recent.rows,
      lead_status: leadStatus.rows,
    };
  });
  res.json(out);
});

export async function salesData(tenantId, scope) {
  const p = [tenantId, scope];
  return withTenant(tenantId, async (c) => {
    const [months, owners, sources, lost, cycle, forecast] = await Promise.all([
      c.query(
        `SELECT to_char(m,'Mon YY') AS label, COALESCE(SUM(d.amount) FILTER (WHERE d.status='won'),0) AS won,
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='lost'),0) AS lost, COUNT(d.id) FILTER (WHERE d.status='won') AS won_count
        FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
        LEFT JOIN deals d ON d.tenant_id=$1 AND d.status IN ('won','lost') AND date_trunc('month', d.closed_at) = m AND ($2::uuid IS NULL OR d.owner_id=$2)
        GROUP BY m ORDER BY m`,
        p,
      ),
      c.query(
        `SELECT u.name, COUNT(d.id) FILTER (WHERE d.status='won') AS won, COUNT(d.id) FILTER (WHERE d.status='lost') AS lost,
          COALESCE(SUM(d.amount) FILTER (WHERE d.status='won'),0) AS won_value
        FROM users u LEFT JOIN deals d ON d.owner_id=u.id AND d.status IN ('won','lost') WHERE u.tenant_id=$1 AND u.active AND ($2::uuid IS NULL OR u.id=$2)
        GROUP BY u.id HAVING COUNT(d.id) > 0 ORDER BY won_value DESC`,
        p,
      ),
      c.query(
        `SELECT COALESCE(source,'Unknown') AS source, COUNT(*) AS leads, COUNT(*) FILTER (WHERE status='converted') AS converted
        FROM leads WHERE tenant_id=$1 AND ($2::uuid IS NULL OR owner_id=$2) GROUP BY 1 ORDER BY 2 DESC`,
        p,
      ),
      c.query(
        `SELECT COALESCE(lost_reason,'Not recorded') AS reason, COUNT(*) AS count, COALESCE(SUM(amount),0) AS value
        FROM deals WHERE tenant_id=$1 AND status='lost' AND ($2::uuid IS NULL OR owner_id=$2) GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
        p,
      ),
      c.query(
        `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400),0) AS avg_days
        FROM deals WHERE tenant_id=$1 AND status='won' AND ($2::uuid IS NULL OR owner_id=$2)`,
        p,
      ),
      c.query(
        `SELECT to_char(date_trunc('month', d.expected_close),'Mon YY') AS label, date_trunc('month', d.expected_close) AS m,
          COALESCE(SUM(d.amount),0) AS pipeline, COALESCE(SUM(d.amount * s.probability / 100.0),0) AS weighted
        FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id
        WHERE d.tenant_id=$1 AND d.status='open' AND d.expected_close IS NOT NULL AND ($2::uuid IS NULL OR d.owner_id=$2)
        GROUP BY 1,2 ORDER BY 2 LIMIT 8`,
        p,
      ),
    ]);
    return {
      revenue_by_month: months.rows,
      by_owner: owners.rows,
      lead_sources: sources.rows,
      lost_reasons: lost.rows,
      avg_cycle_days: Math.round(cycle.rows[0].avg_days),
      forecast: forecast.rows.map(({ m, ...r }) => r),
    };
  });
}

reportsRouter.get('/sales', requireRole('member'), async (req, res) => {
  const { tenantId, userId, role } = req.auth;
  res.json(await salesData(tenantId, role === 'member' ? userId : null));
});

// ---- Export: Excel or PDF of the same numbers as the Reports page ----
const num = (v) => Number(v ?? 0);
const money = (v) => 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num(v));

async function buildXlsx(d, title, res) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dealwave CRM';
  wb.created = new Date();
  const sheet = (name, cols, rows) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
    rows.forEach((r) => ws.addRow(r));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6B5C' } };
    return ws;
  };
  const inr = '"₹"#,##,##0';
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 34 }, { width: 24 }];
  summary.addRow([title]).font = { bold: true, size: 14 };
  summary.addRow(['Generated', new Date().toLocaleString('en-IN')]);
  summary.addRow([]);
  summary.addRow(['Average sales cycle (days)', d.avg_cycle_days]);
  summary.addRow(['Won, last 12 months', d.revenue_by_month.reduce((a, m) => a + num(m.won), 0)]).getCell(2).numFmt = inr;
  summary.addRow(['Lost, last 12 months', d.revenue_by_month.reduce((a, m) => a + num(m.lost), 0)]).getCell(2).numFmt = inr;
  sheet(
    'Monthly',
    [
      { header: 'Month', key: 'label', width: 14 },
      { header: 'Won value', key: 'won', width: 18, fmt: inr },
      { header: 'Lost value', key: 'lost', width: 18, fmt: inr },
      { header: 'Deals won', key: 'won_count', width: 12 },
    ],
    d.revenue_by_month.map((m) => ({ ...m, won: num(m.won), lost: num(m.lost), won_count: num(m.won_count) })),
  );
  sheet(
    'Sellers',
    [
      { header: 'Seller', key: 'name', width: 26 },
      { header: 'Won', key: 'won', width: 10 },
      { header: 'Lost', key: 'lost', width: 10 },
      { header: 'Win rate %', key: 'rate', width: 12 },
      { header: 'Won value', key: 'won_value', width: 18, fmt: inr },
    ],
    d.by_owner.map((o) => ({
      name: o.name,
      won: num(o.won),
      lost: num(o.lost),
      rate: num(o.won) + num(o.lost) ? Math.round((num(o.won) / (num(o.won) + num(o.lost))) * 100) : 0,
      won_value: num(o.won_value),
    })),
  );
  sheet(
    'Lead sources',
    [
      { header: 'Source', key: 'source', width: 22 },
      { header: 'Leads', key: 'leads', width: 10 },
      { header: 'Converted', key: 'converted', width: 12 },
      { header: 'Rate %', key: 'rate', width: 10 },
    ],
    d.lead_sources.map((s) => ({
      source: s.source,
      leads: num(s.leads),
      converted: num(s.converted),
      rate: num(s.leads) ? Math.round((num(s.converted) / num(s.leads)) * 100) : 0,
    })),
  );
  sheet(
    'Lost reasons',
    [
      { header: 'Reason', key: 'reason', width: 34 },
      { header: 'Deals', key: 'count', width: 10 },
      { header: 'Value lost', key: 'value', width: 18, fmt: inr },
    ],
    d.lost_reasons.map((l) => ({ reason: l.reason, count: num(l.count), value: num(l.value) })),
  );
  sheet(
    'Forecast',
    [
      { header: 'Expected close', key: 'label', width: 16 },
      { header: 'Pipeline', key: 'pipeline', width: 18, fmt: inr },
      { header: 'Weighted', key: 'weighted', width: 18, fmt: inr },
    ],
    d.forecast.map((f) => ({ label: f.label, pipeline: num(f.pipeline), weighted: num(f.weighted) })),
  );
  await wb.xlsx.write(res);
  res.end();
}

function buildPdf(d, title, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Author: 'Dealwave CRM' } });
  doc.pipe(res);
  const green = '#0F6B5C';
  doc.fillColor(green).fontSize(20).text(title);
  doc
    .fillColor('#6b7a76')
    .fontSize(10)
    .text(`Generated ${new Date().toLocaleString('en-IN')}`)
    .moveDown(1);
  const table = (heading, cols, rows) => {
    if (doc.y > 700) doc.addPage();
    doc.fillColor('#14201e').fontSize(13).text(heading).moveDown(0.3);
    const x0 = doc.page.margins.left;
    const line = (cells, bold = false) => {
      if (doc.y > 760) doc.addPage();
      let x = x0;
      const y = doc.y;
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9.5)
        .fillColor(bold ? green : '#14201e');
      cells.forEach((cell, i) => {
        doc.text(cell, x, y, { width: cols[i].w - 6, align: cols[i].r ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += cols[i].w;
      });
      doc.y = y + 15;
      doc
        .moveTo(x0, doc.y - 2)
        .lineTo(x0 + cols.reduce((a, c) => a + c.w, 0), doc.y - 2)
        .strokeColor('#e1e5e0')
        .lineWidth(0.5)
        .stroke();
    };
    line(
      cols.map((c) => c.h),
      true,
    );
    if (!rows.length) line(['No data yet', ...cols.slice(1).map(() => '')]);
    rows.forEach((r) => line(r));
    doc.moveDown(1).font('Helvetica');
  };
  table(
    'Won and lost by month',
    [
      { h: 'Month', w: 100 },
      { h: 'Won', w: 150, r: true },
      { h: 'Lost', w: 150, r: true },
      { h: 'Deals won', w: 90, r: true },
    ],
    d.revenue_by_month.map((m) => [m.label, money(m.won), money(m.lost), String(num(m.won_count))]),
  );
  table(
    'Sellers',
    [
      { h: 'Seller', w: 180 },
      { h: 'Won', w: 60, r: true },
      { h: 'Lost', w: 60, r: true },
      { h: 'Win rate', w: 70, r: true },
      { h: 'Won value', w: 130, r: true },
    ],
    d.by_owner.map((o) => [
      o.name,
      String(num(o.won)),
      String(num(o.lost)),
      `${num(o.won) + num(o.lost) ? Math.round((num(o.won) / (num(o.won) + num(o.lost))) * 100) : 0}%`,
      money(o.won_value),
    ]),
  );
  table(
    'Lead sources',
    [
      { h: 'Source', w: 200 },
      { h: 'Leads', w: 90, r: true },
      { h: 'Converted', w: 100, r: true },
      { h: 'Rate', w: 90, r: true },
    ],
    d.lead_sources.map((s) => [
      s.source,
      String(num(s.leads)),
      String(num(s.converted)),
      `${num(s.leads) ? Math.round((num(s.converted) / num(s.leads)) * 100) : 0}%`,
    ]),
  );
  table(
    'Why deals are lost',
    [
      { h: 'Reason', w: 230 },
      { h: 'Deals', w: 80, r: true },
      { h: 'Value lost', w: 170, r: true },
    ],
    d.lost_reasons.map((l) => [l.reason, String(num(l.count)), money(l.value)]),
  );
  table(
    'Forecast by expected close month',
    [
      { h: 'Month', w: 140 },
      { h: 'Pipeline', w: 170, r: true },
      { h: 'Weighted', w: 170, r: true },
    ],
    d.forecast.map((f) => [f.label, money(f.pipeline), money(f.weighted)]),
  );
  doc.fillColor('#6b7a76').fontSize(9).text(`Average sales cycle: ${d.avg_cycle_days} days`);
  doc.end();
}

reportsRouter.get('/export', requireRole('member'), async (req, res) => {
  const { tenantId, userId, role } = req.auth;
  const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
  const scope = role === 'member' ? userId : null;
  const [data, tenantName] = await Promise.all([
    salesData(tenantId, scope),
    withTenant(tenantId, async (c) => (await c.query('SELECT name FROM tenants WHERE id=$1', [tenantId])).rows[0].name),
  ]);
  await withTenant(tenantId, (c) => audit(c, tenantId, userId, 'exported', 'report', null, `Sales report (${format})`));
  const title = `${tenantName}: sales report${scope ? ' (my deals)' : ''}`;
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'pdf') {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="sales-report-${stamp}.pdf"` });
    buildPdf(data, title, res);
  } else {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sales-report-${stamp}.xlsx"`,
    });
    await buildXlsx(data, title, res);
  }
});
