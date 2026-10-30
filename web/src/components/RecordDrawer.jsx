import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRightLeft, Check, FileText, Mail, Pencil, Phone, Trash2, Users, X, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { ENTITIES, LOST_REASONS } from '../lib/entities';
import { useAuth } from '../lib/auth';
import { useFieldDefs, useStages } from '../lib/hooks';
import { cap, dateShort, dateTime, rupees, rupeesShort, timeAgo } from '../lib/format';
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorNote,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
  ScoreBar,
  useConfirm,
  useToast,
  Field,
} from './ui';
import { RecordForm } from './RecordForm';
import { EmailsTab, FilesTab, ScorePanel, SummaryCard } from './RecordExtras';

// ---------------- Timeline ----------------
const ACT_ICON = {
  task: <Check className="h-3.5 w-3.5" />,
  call: <Phone className="h-3.5 w-3.5" />,
  meeting: <Users className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  note: <FileText className="h-3.5 w-3.5" />,
};

export function Timeline({ relatedType, relatedId }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState('note');
  const [subject, setSubject] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: ['timeline', relatedType, relatedId],
    queryFn: () => api('/activities', { params: { related_type: relatedType, related_id: relatedId, limit: 100, sort: 'created_at' } }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['timeline', relatedType, relatedId] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const add = useMutation({
    mutationFn: () =>
      api('/activities', {
        body: {
          type,
          subject: subject.trim(),
          related_type: relatedType,
          related_id: relatedId,
          due_at: due ? new Date(due).toISOString() : null,
          completed_at: type === 'task' || (type === 'meeting' && due) ? null : new Date().toISOString(),
        },
      }),
    onSuccess: () => {
      setSubject('');
      setDue('');
      setError('');
      refresh();
      toast.success('Activity added');
    },
    onError: (e) => setError(e.fields.subject || e.message),
  });
  const toggle = useMutation({
    mutationFn: (a) =>
      api(`/activities/${a.id}`, { method: 'PATCH', body: { completed_at: a.completed_at ? null : new Date().toISOString() } }),
    onSuccess: refresh,
  });

  return (
    <div>
      <form
        className="rounded-panel border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (subject.trim()) add.mutate();
          else setError('Add a short subject');
        }}
      >
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Activity type">
          {['note', 'call', 'meeting', 'email', 'task'].map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]',
                type === t ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-ink',
              )}
            >
              {ACT_ICON[t]}
              {cap(t)}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder={type === 'note' ? 'What happened?' : type === 'task' ? 'What needs doing?' : `Subject of the ${type}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
          />
          {(type === 'task' || type === 'meeting') && (
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="sm:w-52" aria-label="Due" />
          )}
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add
          </Button>
        </div>
        {error && <p className="mt-1.5 text-[12.5px] text-danger">{error}</p>}
      </form>

      <ol className="relative mt-5 space-y-4 border-l border-line pl-5">
        {q.isLoading && <Skeleton className="h-14 w-full" />}
        {q.data?.data.length === 0 && <li className="text-muted">Nothing logged yet. Add a call, meeting or note above.</li>}
        {q.data?.data.map((a) => {
          const open = a.type === 'task' && !a.completed_at;
          const overdue = open && a.due_at && new Date(a.due_at) < new Date();
          return (
            <li key={a.id} className="relative">
              <span
                className={clsx(
                  'absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-surface',
                  open ? (overdue ? 'border-danger text-danger' : 'border-accent text-warn') : 'border-line text-muted',
                )}
              >
                {ACT_ICON[a.type]}
              </span>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={clsx('font-medium', a.completed_at && a.type === 'task' && 'text-muted line-through')}>{a.subject}</p>
                  {a.notes && <p className="mt-0.5 text-muted">{a.notes}</p>}
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {cap(a.type)} by {a.owner_name || 'Unassigned'} - {timeAgo(a.created_at)}
                    {a.due_at && <span className={clsx('ml-1', overdue && 'font-medium text-danger')}> - due {dateTime(a.due_at)}</span>}
                  </p>
                </div>
                {a.type === 'task' && (
                  <Button size="sm" onClick={() => toggle.mutate(a)}>
                    {a.completed_at ? 'Reopen' : 'Mark done'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------- Convert lead ----------------
function ConvertModal({ lead, onClose, onDone }) {
  const [createDeal, setCreateDeal] = useState(true);
  const [dealName, setDealName] = useState(`${lead.company || lead.first_name} - new deal`);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      api('/leads/' + lead.id + '/convert', {
        body: { create_deal: createDeal, deal_name: dealName || undefined, amount: amount ? Number(amount) : undefined },
      }),
    onSuccess: () => {
      ['leads', 'contacts', 'accounts', 'deals'].forEach((p) => qc.invalidateQueries({ queryKey: ['list', p] }));
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Lead converted');
      onDone();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Convert lead"
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Convert
          </Button>
        </>
      }
    >
      <p className="text-muted">
        This creates a contact{lead.company ? ` and an account for ${lead.company}` : ''}, and marks the lead as converted.
      </p>
      <label className="mt-4 flex items-center gap-2">
        <input
          type="checkbox"
          checked={createDeal}
          onChange={(e) => setCreateDeal(e.target.checked)}
          className="h-4 w-4 accent-[rgb(var(--primary))]"
        />{' '}
        Also create a deal
      </label>
      {createDeal && (
        <div className="mt-3 grid gap-3">
          <Field label="Deal name">
            <Input value={dealName} onChange={(e) => setDealName(e.target.value)} />
          </Field>
          <Field label="Deal value (₹)">
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
          </Field>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
    </Modal>
  );
}

// ---------------- Stage stepper for deals ----------------
function StageStepper({ deal, onChange }) {
  const stages = useStages();
  const [askLost, setAskLost] = useState(null);
  const [reason, setReason] = useState(LOST_REASONS[0]);
  if (!stages.data) return null;
  const idx = stages.data.findIndex((s) => s.id === deal.stage_id);
  return (
    <>
      <div className="flex gap-1 overflow-x-auto scroll-thin pb-1" role="group" aria-label="Deal stage">
        {stages.data.map((s, i) => {
          const done = i <= idx && !stages.data[idx].is_lost;
          const current = i === idx;
          return (
            <button
              key={s.id}
              onClick={() => !current && (s.is_lost ? setAskLost(s.id) : onChange(s.id))}
              aria-current={current}
              className={clsx(
                'min-w-[84px] flex-1 rounded-control border px-2 py-1.5 text-center text-[12.5px] font-medium transition-colors',
                current
                  ? 'border-transparent text-white'
                  : done
                    ? 'border-transparent bg-primary-soft text-primary'
                    : 'border-line text-muted hover:text-ink',
              )}
              style={current ? { background: s.color } : undefined}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      <Modal
        open={!!askLost}
        onClose={() => setAskLost(null)}
        title="Mark deal as lost"
        width={420}
        footer={
          <>
            <Button onClick={() => setAskLost(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                onChange(askLost, reason);
                setAskLost(null);
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
    </>
  );
}

// ---------------- Related lists ----------------
function Related({ title, path, params, render, empty }) {
  const q = useQuery({ queryKey: ['related', path, params], queryFn: () => api(`/${path}`, { params: { ...params, limit: 6 } }) });
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 font-display text-[14.5px] font-semibold">
        {title} {q.data && <span className="text-muted num">{q.data.total}</span>}
      </h3>
      <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
        {q.isLoading && (
          <li className="p-3">
            <Skeleton className="h-5 w-2/3" />
          </li>
        )}
        {q.data?.data.length === 0 && <li className="px-3 py-3 text-muted">{empty}</li>}
        {q.data?.data.map((r) => (
          <li key={r.id} className="px-3 py-2.5">
            {render(r)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const fmt = (v) =>
  v === null || v === undefined || v === ''
    ? 'empty'
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v).length > 40
        ? String(v).slice(0, 40) + '...'
        : String(v);

// ---------------- Drawer ----------------
export function RecordDrawer({ entity, id, onClose }) {
  const cfg = ENTITIES[entity];
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const defs = useFieldDefs(entity);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);

  const q = useQuery({ queryKey: ['record', cfg.path, id], queryFn: () => api(`/${cfg.path}/${id}`), retry: false });
  const hist = useQuery({
    queryKey: ['history', entity, id],
    enabled: tab === 'history' && can('manager'),
    queryFn: () => api('/audit', { params: { entity, entity_id: id, limit: 30 } }),
  });
  const r = q.data;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['record', cfg.path, id] });
    qc.invalidateQueries({ queryKey: ['list', cfg.path] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['history', entity, id] });
  };
  const moveStage = useMutation({
    mutationFn: ({ stageId, reason }) =>
      api(`/deals/${id}`, { method: 'PATCH', body: { stage_id: stageId, ...(reason ? { lost_reason: reason } : {}) } }),
    onSuccess: () => {
      invalidate();
      toast.success('Stage updated');
    },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => api(`/${cfg.path}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list', cfg.path] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${cap(cfg.singular)} deleted`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const display = (f) => {
    const v = r[f.key];
    if (v === null || v === undefined || v === '') return <span className="text-muted">Not set</span>;
    if (f.type === 'money') return <span className="num">{rupees(v)}</span>;
    if (f.type === 'score') return <ScoreBar score={v} />;
    if (f.type === 'owner')
      return (
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={r[f.labelKey] || '?'} size={20} />
          {r[f.labelKey]}
        </span>
      );
    if (f.type === 'date') return dateShort(v);
    if (f.key === 'status') return <StatusBadge status={v} />;
    if (f.type === 'account' && v)
      return (
        <Link className="text-primary hover:underline" to={`/accounts?open=${v}`}>
          {r[f.labelKey]}
        </Link>
      );
    if (f.type === 'contact' && v)
      return (
        <Link className="text-primary hover:underline" to={`/contacts?open=${v}`}>
          {r[f.labelKey]}
        </Link>
      );
    if (f.type === 'stage') return <Badge tone="neutral">{r.stage_name}</Badge>;
    if (f.type === 'email')
      return (
        <a className="text-primary hover:underline" href={`mailto:${v}`}>
          {v}
        </a>
      );
    if (f.type === 'tel')
      return (
        <a className="text-primary hover:underline" href={`tel:${v}`}>
          {v}
        </a>
      );
    if (f.type === 'number') return <span className="num">{Number(v).toLocaleString('en-IN')}</span>;
    return String(v);
  };

  return (
    <Drawer open onClose={onClose} width={680}>
      <header className="border-b border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {q.isLoading ? (
              <Skeleton className="h-7 w-56" />
            ) : r ? (
              <>
                <h2 className="truncate font-display text-[21px] font-semibold leading-tight">{cfg.title(r)}</h2>
                <p className="mt-0.5 text-muted">{cfg.subtitle?.(r) || cap(cfg.singular)}</p>
              </>
            ) : (
              <h2 className="font-display text-[19px] font-semibold">Not found</h2>
            )}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        {r && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {entity === 'lead' && <StatusBadge status={r.status} />}
            {entity === 'deal' && (
              <>
                <span className="font-display text-[22px] font-semibold num">{rupees(r.amount)}</span>
                <Badge tone={r.status === 'won' ? 'success' : r.status === 'lost' ? 'danger' : 'primary'}>{cap(r.status)}</Badge>
              </>
            )}
            <div className="ml-auto flex gap-2">
              {entity === 'lead' && r.status !== 'converted' && (
                <Button variant="accent" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setConverting(true)}>
                  Convert
                </Button>
              )}
              <Button
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => {
                  setEditing(true);
                  setTab('overview');
                }}
              >
                Edit
              </Button>
              {can('manager') && (
                <Button
                  icon={<Trash2 className="h-4 w-4" />}
                  aria-label="Delete"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete this ${cfg.singular}?`,
                        body: 'This cannot be undone. Related activity is kept in the audit log.',
                        confirmLabel: 'Delete',
                        danger: true,
                      })
                    )
                      del.mutate();
                  }}
                />
              )}
            </div>
          </div>
        )}
        {r && entity === 'deal' && (
          <div className="mt-3">
            <StageStepper deal={r} onChange={(stageId, reason) => moveStage.mutate({ stageId, reason })} />
          </div>
        )}
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-8 pt-3">
        {q.isError && (
          <EmptyState title="We could not find this record" icon={<X className="h-5 w-5" />}>
            It may have been deleted, or it belongs to someone else.
          </EmptyState>
        )}
        {r && (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'activity', label: 'Activity' },
                { id: 'files', label: 'Files' },
                { id: 'emails', label: 'Emails' },
                ...(can('manager') ? [{ id: 'history', label: 'History' }] : []),
              ]}
            />
            <div className="pt-4">
              {tab === 'overview' &&
                (editing ? (
                  <RecordForm
                    entity={entity}
                    initial={r}
                    onCancel={() => setEditing(false)}
                    onSaved={() => {
                      setEditing(false);
                      invalidate();
                    }}
                  />
                ) : (
                  <>
                    <SummaryCard entity={entity} id={id} />
                    {entity === 'deal' && r.status === 'lost' && r.lost_reason && (
                      <div className="mb-4 rounded-control bg-danger-soft px-3 py-2 text-danger">Lost: {r.lost_reason}</div>
                    )}
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 rounded-panel border border-line bg-surface p-4 sm:grid-cols-2">
                      {cfg.fields
                        .filter((f) => !f.hideInView && !(entity === 'deal' && f.key === 'name'))
                        .map((f) => (
                          <div key={f.key} className={clsx(f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : '')}>
                            <dt className="text-[12.5px] text-muted">{f.label}</dt>
                            <dd className="mt-0.5 break-words">{display(f)}</dd>
                          </div>
                        ))}
                      {defs.data?.map((d) => (
                        <div key={d.id}>
                          <dt className="text-[12.5px] text-muted">{d.label}</dt>
                          <dd className="mt-0.5">
                            {r.custom_data?.[d.key] === undefined || r.custom_data?.[d.key] === null ? (
                              <span className="text-muted">Not set</span>
                            ) : d.type === 'boolean' ? (
                              r.custom_data[d.key] ? (
                                'Yes'
                              ) : (
                                'No'
                              )
                            ) : d.type === 'date' ? (
                              dateShort(r.custom_data[d.key])
                            ) : (
                              String(r.custom_data[d.key])
                            )}
                          </dd>
                        </div>
                      ))}
                      <div>
                        <dt className="text-[12.5px] text-muted">Created</dt>
                        <dd className="mt-0.5">{dateTime(r.created_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12.5px] text-muted">Last updated</dt>
                        <dd className="mt-0.5">{timeAgo(r.updated_at)}</dd>
                      </div>
                    </dl>

                    {entity === 'account' && (
                      <>
                        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                          {[
                            ['Contacts', r.contact_count],
                            ['Deals', r.deal_count],
                            ['Won value', rupeesShort(r.won_value)],
                          ].map(([l, v]) => (
                            <div key={String(l)} className="rounded-panel border border-line bg-surface p-3">
                              <p className="font-display text-[20px] font-semibold num">{v}</p>
                              <p className="text-[12.5px] text-muted">{l}</p>
                            </div>
                          ))}
                        </div>
                        <Related
                          title="Contacts"
                          path="contacts"
                          params={{ account_id: id }}
                          empty="No contacts yet."
                          render={(c) => (
                            <Link to={`/contacts?open=${c.id}`} className="flex items-center gap-2.5 hover:text-primary">
                              <Avatar name={`${c.first_name} ${c.last_name || ''}`} size={26} />
                              <span>
                                {c.first_name} {c.last_name}
                              </span>
                              <span className="ml-auto text-muted">{c.title}</span>
                            </Link>
                          )}
                        />
                        <Related
                          title="Deals"
                          path="deals"
                          params={{ account_id: id }}
                          empty="No deals yet."
                          render={(d) => (
                            <Link to={`/deals?open=${d.id}`} className="flex items-center gap-2 hover:text-primary">
                              <span className="min-w-0 truncate">{d.name}</span>
                              <Badge className="ml-auto shrink-0">{d.stage_name}</Badge>
                              <span className="w-20 shrink-0 text-right num">{rupeesShort(d.amount)}</span>
                            </Link>
                          )}
                        />
                      </>
                    )}
                    {entity === 'contact' && (
                      <Related
                        title="Deals"
                        path="deals"
                        params={{ contact_id: id }}
                        empty="No deals with this contact."
                        render={(d) => (
                          <Link to={`/deals?open=${d.id}`} className="flex items-center gap-2 hover:text-primary">
                            <span className="min-w-0 truncate">{d.name}</span>
                            <Badge className="ml-auto shrink-0">{d.stage_name}</Badge>
                            <span className="w-20 shrink-0 text-right num">{rupeesShort(d.amount)}</span>
                          </Link>
                        )}
                      />
                    )}
                    {entity === 'lead' && r.status !== 'converted' && <ScorePanel id={id} current={r.score} onApplied={invalidate} />}
                    {entity === 'lead' && r.status === 'converted' && (
                      <p className="mt-4 flex items-center gap-2 rounded-control bg-success-soft px-3 py-2 text-success">
                        <Sparkles className="h-4 w-4" />
                        Converted {dateShort(r.converted_at)}. Find the contact and deal in their lists.
                      </p>
                    )}
                  </>
                ))}
              {tab === 'activity' && <Timeline relatedType={entity} relatedId={id} />}
              {tab === 'files' && <FilesTab entity={entity} id={id} />}
              {tab === 'emails' && <EmailsTab entity={entity} id={id} record={r} />}
              {tab === 'history' && (
                <ol className="space-y-3">
                  {hist.isLoading && <Skeleton className="h-10 w-full" />}
                  {hist.data?.data.length === 0 && <li className="text-muted">No changes recorded.</li>}
                  {hist.data?.data.map((h) => (
                    <li key={h.id} className="rounded-panel border border-line bg-surface px-3 py-2.5">
                      <p>
                        <span className="font-medium">{h.user_name || 'System'}</span> {h.action} this {cfg.singular}{' '}
                        <span className="text-muted">- {timeAgo(h.created_at)}</span>
                      </p>
                      {h.changes && (
                        <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
                          {Object.entries(h.changes)
                            .slice(0, 6)
                            .map(([k, v]) => (
                              <li key={k}>
                                {cap(k)}: {typeof v === 'object' && v && 'from' in v ? `${fmt(v.from)} → ${fmt(v.to)}` : fmt(v)}
                              </li>
                            ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
      {converting && r && (
        <ConvertModal
          lead={r}
          onClose={() => setConverting(false)}
          onDone={() => {
            setConverting(false);
            invalidate();
          }}
        />
      )}
    </Drawer>
  );
}
