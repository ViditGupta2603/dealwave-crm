import { useQuery } from '@tanstack/react-query';
import { useChartTheme } from '../lib/theme';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { rupeesShort } from '../lib/format';
import { Avatar, Button, Panel, Skeleton, useToast } from '../components/ui';

export default function Reports() {
  const ch = useChartTheme();
  const axis = ch.axis;
  const tip = ch.tooltip;
  const q = useQuery({ queryKey: ['reports', 'sales'], queryFn: () => api('/reports/sales') });
  const d = q.data;
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const exportAs = async (f) => {
    setBusy(f);
    try {
      await downloadFile(`/reports/export?format=${f}`, `sales-report.${f}`);
      toast.success(f === 'xlsx' ? 'Excel report downloaded' : 'PDF report downloaded');
    } catch {
      toast.error('Could not create the report. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const maxLost = Math.max(1, ...(d?.lost_reasons.map((l) => l.count) ?? [1]));
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight">Reports</h1>
          <p className="mt-0.5 text-muted">How sales is performing, what is coming, and where deals are lost.</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Download className="h-4 w-4" />} loading={busy === 'xlsx'} onClick={() => exportAs('xlsx')}>
            Download Excel
          </Button>
          <Button icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} onClick={() => exportAs('pdf')}>
            Download PDF
          </Button>
        </div>
      </div>
      {!d ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel title="Won and lost value, last 12 months" className="lg:col-span-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.revenue_by_month} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke={ch.grid} strokeOpacity={0.22} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axis} />
                  <YAxis tickLine={false} axisLine={false} width={60} tick={axis} tickFormatter={(v) => rupeesShort(v)} />
                  <Tooltip
                    cursor={{ fill: ch.cursor }}
                    contentStyle={tip}
                    labelStyle={ch.tooltipLabel}
                    itemStyle={ch.tooltipItem}
                    formatter={(v) => rupeesShort(v)}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey="won" name="Won" fill={ch.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="lost" name="Lost" fill={ch.lost} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Forecast by expected close month" action={<span className="text-[13px] text-muted">Open deals only</span>}>
            {d.forecast.length === 0 ? (
              <p className="text-muted">Add expected close dates to open deals to see a forecast.</p>
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.forecast} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke={ch.grid} strokeOpacity={0.22} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axis} />
                    <YAxis tickLine={false} axisLine={false} width={60} tick={axis} tickFormatter={(v) => rupeesShort(v)} />
                    <Tooltip
                      cursor={{ fill: ch.cursor }}
                      contentStyle={tip}
                      labelStyle={ch.tooltipLabel}
                      itemStyle={ch.tooltipItem}
                      formatter={(v) => rupeesShort(v)}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="pipeline" name="Pipeline" fill={ch.soft} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="weighted" name="Weighted" fill={ch.accent} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel
            title="Win rate by seller"
            action={
              <span className="text-[13px] text-muted">
                Average sales cycle <span className="font-medium text-ink num">{d.avg_cycle_days} days</span>
              </span>
            }
            pad={false}
          >
            {d.by_owner.length === 0 ? (
              <p className="p-4 text-muted">No closed deals yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.by_owner.map((o) => {
                  const rate = o.won + o.lost ? Math.round((o.won / (o.won + o.lost)) * 100) : 0;
                  return (
                    <li key={o.name} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar name={o.name} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2">
                          <span className="truncate font-medium">{o.name}</span>
                          <span className="num">{rate}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${rate}%` }} />
                        </div>
                        <p className="mt-0.5 text-[12px] text-muted num">
                          {o.won} won, {o.lost} lost, {rupeesShort(o.won_value)} won
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Lead source quality" pad={false}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-[12.5px] text-muted">
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 text-right font-medium">Leads</th>
                  <th className="px-2 py-2 text-right font-medium">Converted</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {d.lead_sources.map((s) => (
                  <tr key={s.source} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{s.source}</td>
                    <td className="px-2 text-right num">{s.leads}</td>
                    <td className="px-2 text-right num">{s.converted}</td>
                    <td className="px-4 text-right font-medium num">{s.leads ? Math.round((s.converted / s.leads) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Why deals are lost">
            {d.lost_reasons.length === 0 ? (
              <p className="text-muted">No lost deals recorded.</p>
            ) : (
              <ul className="space-y-3">
                {d.lost_reasons.map((l) => (
                  <li key={l.reason}>
                    <div className="flex justify-between text-[13.5px]">
                      <span>{l.reason}</span>
                      <span className="text-muted num">
                        {l.count} deals, {rupeesShort(l.value)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-danger/70" style={{ width: `${(l.count / maxLost) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
