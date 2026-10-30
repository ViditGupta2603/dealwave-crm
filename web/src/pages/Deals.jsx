import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarDays, KanbanSquare, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LOST_REASONS } from '../lib/entities';
import { useOwners, useStages } from '../lib/hooks';
import { dateShort, rupees, rupeesShort } from '../lib/format';
import { Avatar, Badge, Button, EmptyState, Field, Input, Modal, Select, Skeleton, ViewToggle, useToast } from '../components/ui';
import { EntityPage } from '../components/EntityPage';
import { RecordForm } from '../components/RecordForm';
import { RecordDrawer } from '../components/RecordDrawer';

function closeChip(d, open) {
  if (!d || !open) return null;
  const days = Math.round((new Date(d).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const tone = days < 0 ? 'text-danger' : days <= 7 ? 'text-warn' : 'text-muted';
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[12.5px]', tone)}>
      <CalendarDays className="h-3 w-3" />
      {days < 0 ? `${-days}d overdue` : days === 0 ? 'Today' : dateShort(d)}
    </span>
  );
}

function Board({ view, setView }) {
  const { user } = useAuth();
  const stages = useStages();
  const owners = useOwners();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [lostFor, setLostFor] = useState(null);
  const [reason, setReason] = useState(LOST_REASONS[0]);
  const openId = sp.get('open');
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = { limit: 500, sort: 'updated_at', dir: 'desc', q: dq, owner_id: owner };
  const key = ['list', 'deals', 'board', params];
  const deals = useQuery({ queryKey: key, queryFn: () => api('/deals', { params }) });

  const byStage = useMemo(() => {
    const m = {};
    for (const d of deals.data?.data ?? []) (m[d.stage_id] ||= []).push(d);
    return m;
  }, [deals.data]);

  const move = useMutation({
    mutationFn: ({ id, stageId, lost }) =>
      api(`/deals/${id}`, { method: 'PATCH', body: { stage_id: stageId, ...(lost ? { lost_reason: lost } : {}) } }),
    onMutate: async ({ id, stageId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      const st = stages.data?.find((s) => s.id === stageId);
      if (prev && st)
        qc.setQueryData(key, {
          ...prev,
          data: prev.data.map((d) =>
            d.id === id ? { ...d, stage_id: stageId, stage_name: st.name, status: st.is_won ? 'won' : st.is_lost ? 'lost' : 'open' } : d,
          ),
        });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, v) => {
      toast.success(`Moved to ${stages.data?.find((s) => s.id === v.stageId)?.name}`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['list', 'deals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const drop = (stage) => {
    setOverStage(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const deal = deals.data?.data.find((d) => d.id === id);
    if (!deal || deal.stage_id === stage.id) return;
    if (stage.is_lost) {
      setLostFor({ id, stageId: stage.id });
      setReason(LOST_REASONS[0]);
    } else move.mutate({ id, stageId: stage.id });
  };

  const openTotal = (deals.data?.data ?? []).filter((d) => d.status === 'open').reduce((a, d) => a + d.amount, 0);
  const setOpen = (id) => {
    const n = new URLSearchParams(sp);
    if (id) n.set('open', id);
    else n.delete('open');
    setSp(n, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-6 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-tight">Deals</h1>
            <p className="mt-0.5 text-muted">
              Drag a deal to a new stage to move it. <span className="num">{rupees(openTotal)}</span> open.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ViewToggle view={view} onChange={setView} />
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New deal
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder="Search deals or companies"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search deals"
            />
          </div>
          {user?.role !== 'member' && (
            <div className="min-w-[150px]">
              <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
                <option value="">All owners</option>
                <option value="me">Mine</option>
                {owners.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      <div className="scroll-thin mt-4 flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-6 sm:px-7">
        {(!stages.data || deals.isLoading) &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 w-[290px] shrink-0" />)}
        {stages.data &&
          deals.data &&
          stages.data.map((s) => {
            const items = byStage[s.id] ?? [];
            const closed = s.is_won || s.is_lost;
            const shown = closed ? items.slice(0, 12) : items;
            const total = items.reduce((a, d) => a + d.amount, 0);
            return (
              <section
                key={s.id}
                aria-label={s.name}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(s.id);
                }}
                onDragLeave={() => setOverStage((o) => (o === s.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(s);
                }}
                className={clsx(
                  'flex w-[290px] shrink-0 snap-start flex-col rounded-panel border bg-sunken/60 transition-colors',
                  overStage === s.id ? 'border-primary bg-primary-soft/50' : 'border-line',
                )}
              >
                <header className="px-3.5 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    <h2 className="font-display text-[15px] font-semibold">{s.name}</h2>
                    <span className="ml-auto rounded-full bg-surface px-2 text-[12.5px] text-muted num">{items.length}</span>
                  </div>
                  <p className="mt-0.5 pl-[18px] text-[13px] text-muted num">{rupeesShort(total)}</p>
                </header>
                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                  {shown.map((d) => (
                    <article
                      key={d.id}
                      draggable
                      onDragStart={(e) => {
                        setDragId(d.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', d.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                      onClick={() => setOpen(d.id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setOpen(d.id);
                      }}
                      className={clsx(
                        'cursor-grab rounded-control border border-line bg-surface p-3 transition-shadow hover:shadow-pop active:cursor-grabbing',
                        dragId === d.id && 'opacity-40',
                      )}
                    >
                      <p className="line-clamp-2 font-medium leading-snug">{d.name}</p>
                      {d.account_name && <p className="mt-0.5 truncate text-[13px] text-muted">{d.account_name}</p>}
                      <div className="mt-2.5 flex items-center justify-between">
                        <span className="font-display text-[16px] font-semibold num">{rupeesShort(d.amount)}</span>
                        {d.owner_name && <Avatar name={d.owner_name} size={22} />}
                      </div>
                      {!closed && (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          {closeChip(d.expected_close, d.status === 'open')}
                        </div>
                      )}
                      {!closed && d.next_step && (
                        <p className="mt-1.5 truncate border-t border-line pt-1.5 text-[12.5px] text-muted">Next: {d.next_step}</p>
                      )}
                      {s.is_lost && d.lost_reason && (
                        <Badge tone="danger" className="mt-1.5">
                          {d.lost_reason}
                        </Badge>
                      )}
                    </article>
                  ))}
                  {items.length === 0 && (
                    <p className="rounded-control border border-dashed border-line px-3 py-6 text-center text-[13px] text-muted">
                      {closed ? 'Nothing here yet' : 'Drop a deal here'}
                    </p>
                  )}
                  {closed && items.length > shown.length && (
                    <p className="px-1 text-center text-[12.5px] text-muted">
                      Showing latest {shown.length} of {items.length}. Use List view for all.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        {deals.data && deals.data.total === 0 && stages.data && (
          <div className="min-w-[280px] self-start">
            <EmptyState
              icon={<KanbanSquare className="h-5 w-5" />}
              title="No deals yet"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create a deal
                </Button>
              }
            >
              Deals show up as cards you can drag between stages.
            </EmptyState>
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New deal" width={640}>
        <RecordForm
          entity="deal"
          onCancel={() => setCreating(false)}
          onSaved={(r) => {
            setCreating(false);
            setOpen(r.id);
          }}
        />
      </Modal>
      <Modal
        open={!!lostFor}
        onClose={() => setLostFor(null)}
        title="Mark deal as lost"
        width={420}
        footer={
          <>
            <Button onClick={() => setLostFor(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                move.mutate({ id: lostFor.id, stageId: lostFor.stageId, lost: reason });
                setLostFor(null);
              }}
            >
              Mark as lost
            </Button>
          </>
        }
      >
        <Field label="Why was it lost?">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {LOST_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
      </Modal>
      {openId && <RecordDrawer entity="deal" id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}

export default function Deals() {
  const [view, setViewState] = useState(() => localStorage.getItem('dealwave.dealsView') || 'board');
  const setView = (v) => {
    setViewState(v);
    localStorage.setItem('dealwave.dealsView', v);
  };
  const stages = useStages();
  const columns = [
    {
      key: 'name',
      header: 'Deal',
      sort: 'name',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-[12.5px] text-muted">{r.account_name || 'No account'}</p>
        </div>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: r.stage_color }} />
          {r.stage_name}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Value',
      sort: 'amount',
      className: 'text-right',
      render: (r) => <span className="font-medium num">{rupees(r.amount)}</span>,
    },
    {
      key: 'close',
      header: 'Expected close',
      sort: 'expected_close',
      hideBelow: 'md',
      render: (r) =>
        r.status === 'open' ? (
          (closeChip(r.expected_close, true) ?? <span className="text-muted">-</span>)
        ) : (
          <Badge tone={r.status === 'won' ? 'success' : 'danger'}>
            {r.status === 'won' ? 'Won' : 'Lost'} {dateShort(r.closed_at)}
          </Badge>
        ),
    },
    {
      key: 'owner',
      header: 'Owner',
      hideBelow: 'sm',
      render: (r) =>
        r.owner_name ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={r.owner_name} size={20} />
            {r.owner_name}
          </span>
        ) : (
          <span className="text-muted">Unassigned</span>
        ),
    },
    {
      key: 'next',
      header: 'Next step',
      hideBelow: 'lg',
      render: (r) => <span className="line-clamp-1 text-muted">{r.next_step || '-'}</span>,
    },
  ];
  if (view === 'board') return <Board view={view} setView={setView} />;
  return (
    <EntityPage
      entity="deal"
      description="Every opportunity, from first call to signature."
      columns={columns}
      actions={<ViewToggle view={view} onChange={setView} />}
      filters={[
        {
          key: 'status',
          label: 'Any status',
          options: [
            { value: 'open', label: 'Open' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost' },
          ],
        },
        { key: 'stage_id', label: 'All stages', options: (stages.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
      ]}
      emptyHint="Create a deal to start tracking value and stage."
    />
  );
}
