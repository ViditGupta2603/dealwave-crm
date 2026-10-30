import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useChartTheme } from '../lib/theme';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Check, Handshake, Plus, Target, UserPlus, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cap, dateTime, greeting, rupeesShort, timeAgo } from '../lib/format';
import { Avatar, Badge, Button, Modal, Panel, Skeleton } from '../components/ui';
import { RecordForm } from '../components/RecordForm';

const PATHS = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };
const STATUS_ORDER = ['new', 'contacted', 'qualified', 'converted', 'unqualified'];

function delta(cur, prev) {
  if (!prev) return cur > 0 ? { pct: null, up: true } : null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct, up: pct >= 0 };
}

function Delta({ cur, prev, label }) {
  const d = delta(cur, prev);
  if (!d) return <span className="text-[13px] text-muted">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted">
      <span className={clsx('inline-flex items-center font-medium', d.up ? 'text-success' : 'text-danger')}>
        {d.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {d.pct === null ? 'New' : `${Math.abs(d.pct)}%`}
      </span>
      {label}
    </span>
  );
}

/** Signature element: open deal value as a chain of chevrons, each as wide as its share of the pipeline. */
function PipelineStrip({ stages }) {
  const nav = useNavigate();
  const open = stages.filter((s) => !s.is_won && !s.is_lost);
  const total = open.reduce((a, s) => a + s.value, 0) || 1;
  const raw = open.map((s) => Math.max(9, (s.value / total) * 100));
  const sum = raw.reduce((a, b) => a + b, 0);
  return (
    <div className="flex" role="list" aria-label="Open pipeline by stage">
      {open.map((s, i) => {
        const w = (raw[i] / sum) * 100;
        const first = i === 0,
          last = i === open.length - 1;
        const left = first ? '0 0, 0 100%' : '0 0, 16px 50%, 0 100%';
        const right = last ? '100% 100%, 100% 0' : 'calc(100% - 16px) 100%, 100% 50%, calc(100% - 16px) 0';
        return (
          <button
            key={s.id}
            role="listitem"
            onClick={() => nav('/deals')}
            style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
            className="group relative min-w-0 origin-left animate-grow text-left"
            title={`${s.name}: ${s.count} deals, ${rupeesShort(s.value)}`}
          >
            <div
              className="h-[76px] transition-[filter] group-hover:brightness-110"
              style={{
                background: s.color,
                marginLeft: first ? 0 : -1,
                clipPath: `polygon(${left}, ${right})`,
                borderRadius: first ? '10px 0 0 10px' : last ? '0 10px 10px 0' : 0,
              }}
            >
              <div className={clsx('flex h-full flex-col justify-center', first ? 'pl-4' : 'pl-7', last ? 'pr-3' : 'pr-5')}>
                <p className="truncate font-display text-[17px] font-semibold leading-tight text-white num">{rupeesShort(s.value)}</p>
              </div>
            </div>
            <div className={clsx('mt-2 pr-2', first ? 'pl-1' : 'pl-5')}>
              <p className="truncate text-[13.5px] font-medium">{s.name}</p>
              <p className="text-[12.5px] text-muted num">
                {s.count} deal{s.count === 1 ? '' : 's'} - {s.probability}%
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[27px] font-semibold leading-none num">{value}</p>
      <div className="mt-1.5">{sub}</div>
    </div>
  );
}

function TasksWidget({ tasks }) {
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: (id) => api(`/activities/${id}`, { method: 'PATCH', body: { completed_at: new Date().toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  return (
    <Panel
      title="Your next tasks"
      action={
        <Link to="/tasks" className="text-[13px] font-medium text-primary hover:underline">
          See all
        </Link>
      }
      pad={false}
    >
      {tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted">No open tasks. Nice and clear.</p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => {
            const overdue = t.due_at && new Date(t.due_at) < new Date();
            return (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                <button
                  aria-label={`Mark "${t.subject}" done`}
                  onClick={() => done.mutate(t.id)}
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-transparent transition-colors hover:border-success hover:bg-success-soft hover:text-success"
                >
                  <Check className="h-3 w-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.subject}</p>
                  <p className={clsx('text-[12.5px]', overdue ? 'font-medium text-danger' : 'text-muted')}>
                    {t.due_at ? `${overdue ? 'Overdue - ' : 'Due '}${dateTime(t.due_at)}` : 'No due date'}
                  </p>
                </div>
                {t.priority === 'high' && <Badge tone="danger">High</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function GetStarted() {
  const { can } = useAuth();
  const steps = [
    { to: '/leads', icon: Target, title: 'Add your first lead', text: 'Type one in, or import a CSV from your sheet.' },
    { to: '/deals', icon: Handshake, title: 'Create a deal', text: 'Track value and stage from first call to signature.' },
    ...(can('admin')
      ? [
          {
            to: '/settings/team',
            icon: UserPlus,
            title: 'Invite your team',
            text: 'Owners, managers and sales executives each see the right things.',
          },
          { to: '/automations', icon: Workflow, title: 'Turn on automations', text: 'Let the CRM create follow-ups for you.' },
        ]
      : []),
  ];
  return (
    <Panel title="Get your workspace going">
      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="flex gap-3 rounded-panel border border-line p-3.5 transition-colors hover:border-primary hover:bg-primary-soft/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <s.icon className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block font-medium">{s.title}</span>
              <span className="block text-muted">{s.text}</span>
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

export default function Dashboard() {
  const ch = useChartTheme();
  const STATUS_COLORS = ch.statusColors;
  const { user } = useAuth();
  const [creating, setCreating] = useState(null);
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/reports/dashboard') });
  const d = q.data;
  const k = d?.kpis;
  const empty = d && (k.total_leads ?? 0) === 0 && (k.open_deals ?? 0) === 0;
  const maxWon = Math.max(1, ...(d?.leaderboard.map((l) => l.won_value) ?? [1]));
  const maxSrc = Math.max(1, ...(d?.lead_sources.map((s) => s.count) ?? [1]));
  const statusTotal = d?.lead_status.reduce((a, s) => a + s.count, 0) || 1;
  const first = user?.name.split(' ')[0];

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight">
            {greeting()}, {first}
          </h1>
          {k ? (
            <p className="mt-1 text-[15px] text-muted">
              {d.scope === 'mine' ? 'You have' : 'The team has'}{' '}
              <span className="font-medium text-ink num">{rupeesShort(k.pipeline_value)}</span> open across{' '}
              <span className="font-medium text-ink num">{k.open_deals}</span> deals, and closed{' '}
              <span className="font-medium text-ink num">{rupeesShort(k.won_month)}</span> this month.
            </p>
          ) : (
            <Skeleton className="mt-2 h-5 w-96 max-w-full" />
          )}
        </div>
        <div className="flex gap-2">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('lead')}>
            New lead
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('deal')}>
            New deal
          </Button>
        </div>
      </div>

      {!d ? (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <section className="mt-6 rounded-panel border border-line bg-surface p-5" aria-label="Pipeline">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-[17px] font-semibold">Where the money sits</h2>
              <p className="text-[13.5px] text-muted">
                Weighted forecast <span className="font-semibold text-ink num">{rupeesShort(k.weighted_forecast)}</span> by stage
                probability
              </p>
            </div>
            {d.stages.filter((s) => !s.is_won && !s.is_lost).some((s) => s.count > 0) ? (
              <PipelineStrip stages={d.stages} />
            ) : (
              <div className="rounded-control bg-sunken px-4 py-6 text-center text-muted">
                No open deals yet.{' '}
                <button className="font-medium text-primary hover:underline" onClick={() => setCreating('deal')}>
                  Create the first one
                </button>{' '}
                and it will appear here.
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[13.5px] text-muted">
              {d.stages
                .filter((s) => s.is_won || s.is_lost)
                .map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.name}: <span className="font-medium text-ink num">{s.count}</span> deals,{' '}
                    <span className="num">{rupeesShort(s.value)}</span>
                  </span>
                ))}
            </div>
          </section>

          <section
            className="mt-4 grid divide-y divide-line rounded-panel border border-line bg-surface sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x"
            aria-label="Key numbers"
          >
            <Stat
              label="Won this month"
              value={rupeesShort(k.won_month)}
              sub={<Delta cur={k.won_month ?? 0} prev={k.won_prev_month ?? 0} label="vs last month" />}
            />
            <Stat
              label="Win rate, last 90 days"
              value={k.win_rate === null ? '-' : `${k.win_rate}%`}
              sub={<span className="text-[13px] text-muted">{k.won_month_count} deals won this month</span>}
            />
            <Stat
              label="New leads, last 30 days"
              value={k.new_leads_30}
              sub={<Delta cur={k.new_leads_30 ?? 0} prev={k.new_leads_prev_30 ?? 0} label="vs previous 30 days" />}
            />
            <Stat
              label="Average deal won"
              value={rupeesShort(k.avg_won_size)}
              sub={
                <span className="text-[13px] text-muted">
                  {k.lead_conversion === null ? 'No leads yet' : `${k.lead_conversion}% of leads convert`}
                </span>
              }
            />
          </section>

          {empty && (
            <div className="mt-4">
              <GetStarted />
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Panel title="Revenue won, last 6 months">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.revenue_by_month} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
                      <CartesianGrid vertical={false} stroke={ch.grid} strokeOpacity={0.22} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ ...ch.axis, fontSize: 12.5 }} />
                      <YAxis tickLine={false} axisLine={false} width={58} tick={ch.axis} tickFormatter={(v) => rupeesShort(v)} />
                      <Tooltip
                        cursor={{ fill: ch.cursor }}
                        contentStyle={ch.tooltip}
                        labelStyle={ch.tooltipLabel}
                        itemStyle={ch.tooltipItem}
                        formatter={(v, _n, p) => [`${rupeesShort(v)} (${p.payload.count} deals)`, 'Won']}
                      />
                      <Bar dataKey="won" radius={[5, 5, 0, 0]}>
                        {d.revenue_by_month.map((m, i) => (
                          <Cell key={m.month} fill={i === d.revenue_by_month.length - 1 ? ch.accent : ch.primary} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="Where leads come from">
                  {d.lead_sources.length === 0 ? (
                    <p className="text-muted">No leads yet.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {d.lead_sources.map((s) => (
                        <li key={s.source}>
                          <div className="flex justify-between text-[13.5px]">
                            <span>{s.source}</span>
                            <span className="text-muted num">{s.count}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / maxSrc) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="Lead status">
                  <div className="flex h-3 overflow-hidden rounded-full bg-sunken">
                    {STATUS_ORDER.map((st, i) => {
                      const c = d.lead_status.find((x) => x.status === st)?.count ?? 0;
                      return c ? (
                        <div
                          key={st}
                          title={`${cap(st)}: ${c}`}
                          style={{ width: `${(c / statusTotal) * 100}%`, background: STATUS_COLORS[i] }}
                        />
                      ) : null;
                    })}
                  </div>
                  <ul className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2">
                    {STATUS_ORDER.map((st, i) => (
                      <li key={st} className="flex items-center justify-between text-[13.5px]">
                        <button className="inline-flex items-center gap-2 hover:text-primary" onClick={() => nav('/leads')}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[i] }} />
                          {cap(st)}
                        </button>
                        <span className="text-muted num">{d.lead_status.find((x) => x.status === st)?.count ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </div>

            <div className="space-y-4">
              <TasksWidget tasks={d.tasks} />
              {d.leaderboard.length > 0 && (
                <Panel title="Top sellers this quarter" pad={false}>
                  <ol className="divide-y divide-line">
                    {d.leaderboard.slice(0, 5).map((l, i) => (
                      <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="w-4 text-center text-[13px] text-muted num">{i + 1}</span>
                        <Avatar name={l.name} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2">
                            <span className="truncate font-medium">{l.name}</span>
                            <span className="num">{rupeesShort(l.won_value)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${(l.won_value / maxWon) * 100}%` }} />
                          </div>
                          <p className="mt-0.5 text-[12px] text-muted num">
                            {l.won_count} won, {rupeesShort(l.open_value)} open
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Panel>
              )}
              <Panel title="Recent activity" pad={false}>
                {d.recent_activity.length === 0 ? (
                  <p className="px-4 py-6 text-center text-muted">Activity will show up here as your team works.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.recent_activity.map((a) => {
                      const path = PATHS[a.entity];
                      const inner = (
                        <>
                          <span className="font-medium">{a.user_name || 'Someone'}</span> {a.action} {a.entity}{' '}
                          {a.label && <span className="text-muted">{a.label}</span>}
                          <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                            <CalendarClock className="h-3 w-3" />
                            {timeAgo(a.created_at)}
                          </span>
                        </>
                      );
                      return (
                        <li key={a.id} className="px-4 py-2.5 text-[13.5px]">
                          {path && a.entity_id && a.action !== 'deleted' ? (
                            <Link to={`/${path}?open=${a.entity_id}`} className="block hover:text-primary">
                              {inner}
                            </Link>
                          ) : (
                            <div>{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}

      <Modal open={!!creating} onClose={() => setCreating(null)} title={creating === 'deal' ? 'New deal' : 'New lead'} width={640}>
        {creating && (
          <RecordForm
            entity={creating}
            onCancel={() => setCreating(null)}
            onSaved={(r) => {
              const c = creating;
              setCreating(null);
              nav(`/${c}s?open=${r.id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
