import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { MapPin, Plus, Search, Target } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LEAD_SOURCES } from '../lib/entities';
import { useOwners } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import { Avatar, Button, EmptyState, Input, Modal, ScoreBar, Select, Skeleton, ViewToggle, useToast } from '../components/ui';
import { RecordForm } from '../components/RecordForm';
import { RecordDrawer } from '../components/RecordDrawer';

const COLUMNS = [
  { id: 'new', label: 'New', color: '#7C8DB5', hint: 'Just arrived' },
  { id: 'contacted', label: 'Contacted', color: '#E08A00', hint: 'We have reached out' },
  { id: 'qualified', label: 'Qualified', color: '#0F6B5C', hint: 'Real interest and budget' },
  { id: 'unqualified', label: 'Unqualified', color: '#9aa7a3', hint: 'Not a fit' },
  { id: 'converted', label: 'Converted', color: '#2E9E5B', hint: 'Became a customer' },
];

/** Leads as a drag-and-drop board, one column per status. */
export function LeadBoard({ view, setView, actions }) {
  const { user } = useAuth();
  const owners = useOwners();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const openId = sp.get('open');
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = { limit: 500, sort: 'updated_at', dir: 'desc', q: dq, owner_id: owner, source };
  const key = ['list', 'leads', 'board', params];
  const leads = useQuery({ queryKey: key, queryFn: () => api('/leads', { params }) });

  const byStatus = useMemo(() => {
    const m = {};
    for (const l of leads.data?.data ?? []) (m[l.status] ||= []).push(l);
    return m;
  }, [leads.data]);

  const move = useMutation({
    mutationFn: ({ id, status }) => api(`/leads/${id}`, { method: 'PATCH', body: { status } }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      if (prev) qc.setQueryData(key, { ...prev, data: prev.data.map((l) => (l.id === id ? { ...l, status } : l)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, v) => toast.success(`Moved to ${COLUMNS.find((c) => c.id === v.status)?.label}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['list', 'leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const drop = (status) => {
    setOver(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const lead = leads.data?.data.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (status === 'converted') {
      toast.info('Open the lead and press Convert. That creates the contact, account and deal for you.');
      return;
    }
    move.mutate({ id, status });
  };
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
            <h1 className="font-display text-[26px] font-semibold leading-tight">Leads</h1>
            <p className="mt-0.5 text-muted">
              Drag a lead to the next status as you work it. Press Convert on a lead once it becomes a customer.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions}
            <ViewToggle view={view} onChange={setView} />
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New lead
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder="Search by name, company or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search leads"
            />
          </div>
          <div className="min-w-[140px]">
            <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              <option value="">All sources</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
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
        {leads.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 w-[280px] shrink-0" />)}
        {leads.data &&
          COLUMNS.map((col) => {
            const items = byStatus[col.id] ?? [];
            const shown = col.id === 'converted' || col.id === 'unqualified' ? items.slice(0, 15) : items;
            return (
              <section
                key={col.id}
                aria-label={col.label}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.id);
                }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(col.id);
                }}
                className={clsx(
                  'flex w-[280px] shrink-0 snap-start flex-col rounded-panel border bg-sunken/60 transition-colors',
                  over === col.id ? 'border-primary bg-primary-soft/50' : 'border-line',
                )}
              >
                <header className="px-3.5 pb-2 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
                    <h2 className="font-display text-[15px] font-semibold">{col.label}</h2>
                    <span className="ml-auto rounded-full bg-surface px-2 text-[12.5px] text-muted num">{items.length}</span>
                  </div>
                  <p className="mt-0.5 pl-[18px] text-[12.5px] text-muted">{col.hint}</p>
                </header>
                <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                  {shown.map((l) => {
                    const name = `${l.first_name} ${l.last_name || ''}`.trim();
                    return (
                      <article
                        key={l.id}
                        draggable={l.status !== 'converted'}
                        onDragStart={(e) => {
                          setDragId(l.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', l.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOver(null);
                        }}
                        onClick={() => setOpen(l.id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setOpen(l.id);
                        }}
                        className={clsx(
                          'rounded-control border border-line bg-surface p-3 transition-shadow hover:shadow-pop',
                          l.status === 'converted' ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
                          dragId === l.id && 'opacity-40',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{name}</p>
                            {l.company && <p className="truncate text-[13px] text-muted">{l.company}</p>}
                          </div>
                          {l.owner_name && <Avatar name={l.owner_name} size={22} />}
                        </div>
                        <div className="mt-2.5">
                          <ScoreBar score={l.score} />
                        </div>
                        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[12.5px] text-muted">
                          {l.source && <span>{l.source}</span>}
                          {l.city && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {l.city}
                            </span>
                          )}
                          <span>{timeAgo(l.created_at)}</span>
                        </p>
                      </article>
                    );
                  })}
                  {items.length === 0 && (
                    <p className="rounded-control border border-dashed border-line px-3 py-6 text-center text-[13px] text-muted">
                      {col.id === 'converted' ? 'Converted leads appear here' : 'Drop a lead here'}
                    </p>
                  )}
                  {items.length > shown.length && (
                    <p className="px-1 text-center text-[12.5px] text-muted">
                      Showing latest {shown.length} of {items.length}. Use List view for all.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        {leads.data && leads.data.total === 0 && (
          <div className="min-w-[280px] self-start">
            <EmptyState
              icon={<Target className="h-5 w-5" />}
              title="No leads match"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Add a lead
                </Button>
              }
            >
              Try clearing the filters, or add a lead.
            </EmptyState>
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New lead" width={640}>
        <RecordForm
          entity="lead"
          onCancel={() => setCreating(false)}
          onSaved={(r) => {
            setCreating(false);
            setOpen(r.id);
          }}
        />
      </Modal>
      {openId && <RecordDrawer entity="lead" id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}
