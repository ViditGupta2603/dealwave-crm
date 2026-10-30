import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Mail,
  Pencil,
  Plus,
  Trash2,
  UserCog,
  Webhook,
  X,
  ListChecks,
  StickyNote,
  Wand2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ENTITIES } from '../lib/entities';
import { useFieldDefs } from '../lib/hooks';
import { cap, timeAgo } from '../lib/format';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Tabs,
  Toggle,
  useConfirm,
  useToast,
  Textarea,
} from '../components/ui';

const OPS = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['gt', 'is greater than'],
  ['gte', 'is at least'],
  ['lt', 'is less than'],
  ['lte', 'is at most'],
  ['contains', 'contains'],
  ['in', 'is one of (comma separated)'],
  ['is_empty', 'is empty'],
  ['not_empty', 'is not empty'],
  ['changed_to', 'just changed to'],
];
const ACTIONS = {
  create_task: { label: 'Create a task', icon: ListChecks },
  assign_round_robin: { label: 'Assign to the least busy seller', icon: UserCog },
  notify: { label: 'Send an in-app notification', icon: Bell },
  send_email: { label: 'Send an email', icon: Mail },
  update_field: { label: 'Update a field', icon: Wand2 },
  add_note: { label: 'Add a note', icon: StickyNote },
  webhook: { label: 'Call a webhook', icon: Webhook },
};
const EVENTS = { created: 'is created', updated: 'is updated', stage_changed: 'moves to a new stage' };
const UPDATABLE = {
  lead: ['status', 'source', 'score', 'owner_id', 'title', 'city', 'notes'],
  contact: ['title', 'city', 'owner_id'],
  account: ['industry', 'city', 'state', 'owner_id', 'description'],
  deal: ['next_step', 'expected_close', 'owner_id', 'amount'],
};

function describe(r) {
  const cond = r.conditions
    .map(
      (c) =>
        `${c.field.replace('custom_data.', '')} ${OPS.find((o) => o[0] === c.op)?.[1] ?? c.op}${c.value !== undefined && c.value !== '' && !['is_empty', 'not_empty'].includes(c.op) ? ` "${c.value}"` : ''}`,
    )
    .join(' and ');
  return {
    when: `A ${r.entity} ${EVENTS[r.event]}${cond ? `, and ${cond}` : ''}`,
    then: r.actions.map((a) => ACTIONS[a.type]?.label ?? a.type),
  };
}

const blankRule = () => ({
  name: '',
  description: '',
  entity: 'lead',
  event: 'created',
  conditions: [],
  actions: [{ type: 'create_task', subject: 'Follow up with {{name}}', due_in_days: 1, priority: 'normal' }],
  active: true,
});

function ActionEditor({ a, entity, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...a, [k]: v });
  return (
    <div className="rounded-control border border-line bg-sunken/50 p-3">
      <div className="flex items-center gap-2">
        <Select
          value={a.type}
          onChange={(e) => {
            const t = e.target.value;
            const d = {
              create_task: { type: t, subject: 'Follow up with {{name}}', due_in_days: 1, priority: 'normal' },
              assign_round_robin: { type: t },
              notify: { type: t, title: 'Heads up: {{name}}', body: '' },
              send_email: { type: t, to: 'owner', subject: 'Update on {{name}}', body: 'Hi {{owner_name}}, ' },
              update_field: { type: t, field: UPDATABLE[entity][0], value: '' },
              add_note: { type: t, body: '' },
              webhook: { type: t, url: '', secret: '' },
            };
            onChange(d[t]);
          }}
          aria-label="Action type"
        >
          {Object.entries(ACTIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <button aria-label="Remove action" onClick={onRemove} className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        {a.type === 'create_task' && (
          <>
            <Field label="Task" className="sm:col-span-2">
              <Input value={a.subject} onChange={(e) => set('subject', e.target.value)} />
            </Field>
            <Field label="Due in (days)">
              <Input type="number" min={0} value={a.due_in_days} onChange={(e) => set('due_in_days', Number(e.target.value))} />
            </Field>
            <Field label="Priority">
              <Select value={a.priority} onChange={(e) => set('priority', e.target.value)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            </Field>
          </>
        )}
        {a.type === 'notify' && (
          <>
            <Field label="Title" className="sm:col-span-2">
              <Input value={a.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Message (optional)" className="sm:col-span-2">
              <Input value={a.body ?? ''} onChange={(e) => set('body', e.target.value)} />
            </Field>
          </>
        )}
        {a.type === 'send_email' && (
          <>
            <Field label="Send to">
              <Select
                value={['owner', 'record'].includes(a.to) ? a.to : 'custom'}
                onChange={(e) => set('to', e.target.value === 'custom' ? '' : e.target.value)}
              >
                <option value="owner">The record owner</option>
                <option value="record">The record's own email</option>
                <option value="custom">A specific address</option>
              </Select>
            </Field>
            {!['owner', 'record'].includes(a.to) && (
              <Field label="Email address">
                <Input type="email" value={a.to} onChange={(e) => set('to', e.target.value)} />
              </Field>
            )}
            <Field label="Subject" className="sm:col-span-2">
              <Input value={a.subject} onChange={(e) => set('subject', e.target.value)} />
            </Field>
            <Field label="Body" className="sm:col-span-2">
              <Textarea value={a.body} onChange={(e) => set('body', e.target.value)} />
            </Field>
          </>
        )}
        {a.type === 'update_field' && (
          <>
            <Field label="Field">
              <Select value={a.field} onChange={(e) => set('field', e.target.value)}>
                {UPDATABLE[entity].map((f) => (
                  <option key={f} value={f}>
                    {cap(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="New value">
              <Input value={a.value ?? ''} onChange={(e) => set('value', e.target.value)} />
            </Field>
          </>
        )}
        {a.type === 'add_note' && (
          <Field label="Note" className="sm:col-span-2">
            <Textarea value={a.body} onChange={(e) => set('body', e.target.value)} />
          </Field>
        )}
        {a.type === 'webhook' && (
          <>
            <Field label="URL" className="sm:col-span-2" hint="Must be a public https address. We send the record as JSON.">
              <Input
                type="url"
                value={a.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://hooks.example.com/dealwave"
              />
            </Field>
            <Field
              label="Signing secret (optional)"
              className="sm:col-span-2"
              hint="Used to sign each call in the X-Dealwave-Signature header."
            >
              <Input value={a.secret ?? ''} onChange={(e) => set('secret', e.target.value)} />
            </Field>
          </>
        )}
        {a.type === 'assign_round_robin' && (
          <p className="text-[13px] text-muted sm:col-span-2">
            Picks the active member or manager with the fewest recently assigned records.
          </p>
        )}
      </div>
    </div>
  );
}

function RuleModal({ rule, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [r, setR] = useState(() => (rule ? { ...rule } : blankRule()));
  const [error, setError] = useState('');
  const defs = useFieldDefs(r.entity);
  const fieldOptions = [
    ...ENTITIES[r.entity].fields.filter((f) => f.type !== 'textarea').map((f) => ({ v: f.key, l: f.label })),
    ...(r.entity === 'deal' ? [{ v: 'status', l: 'Deal status (open, won, lost)' }] : []),
    ...(defs.data ?? []).map((d) => ({ v: `custom_data.${d.key}`, l: `${d.label} (custom)` })),
  ];
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: r.name,
        description: r.description || null,
        entity: r.entity,
        event: r.event,
        conditions: r.conditions,
        actions: r.actions,
        active: r.active,
      };
      return rule ? api(`/workflows/${rule.id}`, { method: 'PATCH', body }) : api('/workflows', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      toast.success(rule ? 'Automation updated' : 'Automation created');
      onClose();
    },
    onError: (e) => setError(Object.values(e.fields)[0] || e.message),
  });
  const setCond = (i, c) => setR((s) => ({ ...s, conditions: s.conditions.map((x, j) => (j === i ? c : x)) }));
  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? 'Edit automation' : 'New automation'}
      width={680}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {rule ? 'Save changes' : 'Create automation'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" required>
          <Input
            autoFocus
            value={r.name}
            onChange={(e) => setR({ ...r, name: e.target.value })}
            placeholder="Follow up on every new website lead"
          />
        </Field>

        <section>
          <h3 className="mb-2 font-display text-[15px] font-semibold">When</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span>A</span>
            <div className="w-32">
              <Select
                value={r.entity}
                onChange={(e) =>
                  setR({
                    ...r,
                    entity: e.target.value,
                    conditions: [],
                    event: r.event === 'stage_changed' && e.target.value !== 'deal' ? 'created' : r.event,
                    actions: r.actions.filter((a) => a.type !== 'update_field'),
                  })
                }
                aria-label="Record type"
              >
                {Object.values(ENTITIES).map((e) => (
                  <option key={e.key} value={e.key}>
                    {cap(e.singular)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-44">
              <Select value={r.event} onChange={(e) => setR({ ...r, event: e.target.value })} aria-label="Event">
                <option value="created">is created</option>
                <option value="updated">is updated</option>
                {r.entity === 'deal' && <option value="stage_changed">moves to a new stage</option>}
              </Select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-display text-[15px] font-semibold">
            Only if <span className="text-[13px] font-normal text-muted">(all of these are true)</span>
          </h3>
          <div className="space-y-2">
            {r.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="w-44">
                  <Select value={c.field} onChange={(e) => setCond(i, { ...c, field: e.target.value })} aria-label="Field">
                    {fieldOptions.map((f) => (
                      <option key={f.v} value={f.v}>
                        {f.l}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-44">
                  <Select value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value })} aria-label="Operator">
                    {OPS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
                {!['is_empty', 'not_empty'].includes(c.op) && (
                  <Input
                    className="min-w-[120px] flex-1"
                    value={c.value ?? ''}
                    onChange={(e) => setCond(i, { ...c, value: e.target.value })}
                    placeholder="Value"
                    aria-label="Value"
                  />
                )}
                <button
                  aria-label="Remove condition"
                  onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}
                  className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setR({ ...r, conditions: [...r.conditions, { field: fieldOptions[0].v, op: 'eq', value: '' }] })}
            >
              Add condition
            </Button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-display text-[15px] font-semibold">Then</h3>
          <div className="space-y-2.5">
            {r.actions.map((a, i) => (
              <ActionEditor
                key={i}
                a={a}
                entity={r.entity}
                onChange={(na) => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? na : x)) })}
                onRemove={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })}
              />
            ))}
            <Button
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setR({ ...r, actions: [...r.actions, { type: 'notify', title: 'Heads up: {{name}}', body: '' }] })}
            >
              Add action
            </Button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Use {'{{name}}'}, {'{{company}}'}, {'{{owner_name}}'} or any field name in text to fill in the record's details.
          </p>
        </section>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

export default function Automations() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('rules');
  const [editing, setEditing] = useState(null);
  const rules = useQuery({ queryKey: ['workflows'], queryFn: () => api('/workflows') });
  const runs = useQuery({
    queryKey: ['workflow-runs'],
    queryFn: () => api('/workflows/runs'),
    enabled: tab === 'runs',
    refetchInterval: tab === 'runs' ? 15000 : false,
  });
  const toggle = useMutation({
    mutationFn: (r) => api(`/workflows/${r.id}`, { method: 'PATCH', body: { active: !r.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (r) => api(`/workflows/${r.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      toast.success('Automation deleted');
    },
  });

  return (
    <div className="mx-auto max-w-[980px] px-4 py-6 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight">Automations</h1>
          <p className="mt-0.5 text-muted">Let the CRM do the routine work when records change.</p>
        </div>
        {can('admin') && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New automation
          </Button>
        )}
      </div>
      <div className="mt-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'rules', label: 'Automations', count: rules.data?.length },
            { id: 'runs', label: 'Recent runs' },
          ]}
        />
      </div>

      {tab === 'rules' && (
        <div className="mt-4 space-y-3">
          {rules.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
          {rules.data?.length === 0 && (
            <div className="rounded-panel border border-line bg-surface">
              <EmptyState
                icon={<WorkflowIcon className="h-5 w-5" />}
                title="No automations yet"
                action={
                  can('admin') ? (
                    <Button variant="primary" onClick={() => setEditing('new')}>
                      Create your first automation
                    </Button>
                  ) : undefined
                }
              >
                For example: give each new website lead to a seller and create a follow-up task.
              </EmptyState>
            </div>
          )}
          {rules.data?.map((r) => {
            const d = describe(r);
            return (
              <article key={r.id} className={clsx('rounded-panel border border-line bg-surface p-4', !r.active && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-[17px] font-semibold leading-tight">{r.name}</h2>
                    {r.description && <p className="mt-0.5 text-muted">{r.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {can('admin') && (
                      <>
                        <Toggle checked={r.active} onChange={() => toggle.mutate(r)} label={r.active ? 'Turn off' : 'Turn on'} />
                        <button
                          aria-label="Edit automation"
                          onClick={() => setEditing(r)}
                          className="ml-2 rounded p-1.5 text-muted hover:bg-sunken hover:text-ink"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          aria-label="Delete automation"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `Delete "${r.name}"?`,
                                body: 'Past runs are removed too.',
                                confirmLabel: 'Delete',
                                danger: true,
                              })
                            )
                              del.mutate(r);
                          }}
                          className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
                  <span className="rounded-control bg-sunken px-2.5 py-1">{d.when}</span>
                  <ArrowRight className="h-4 w-4 text-muted" />
                  {d.then.map((t, i) => (
                    <span key={i} className="rounded-control bg-primary-soft px-2.5 py-1 text-primary">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="mt-3 flex flex-wrap items-center gap-x-3 text-[12.5px] text-muted">
                  <span className="num">{r.run_count} runs</span>
                  <span>Last run {r.last_run_at ? timeAgo(r.last_run_at) : 'never'}</span>
                  {r.failed_7d > 0 && (
                    <Badge tone="danger">
                      <AlertTriangle className="h-3 w-3" />
                      {r.failed_7d} failed this week
                    </Badge>
                  )}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {tab === 'runs' && (
        <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
          {runs.isLoading && (
            <div className="p-4">
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {runs.data?.length === 0 && <EmptyState title="No runs yet">Runs appear here when an automation fires.</EmptyState>}
          <ul className="divide-y divide-line">
            {runs.data?.map((run) => (
              <li key={run.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {run.status === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-danger" />
                  )}
                  <span className="font-medium">{run.rule_name}</span>
                  <Badge>{cap(run.entity)}</Badge>
                  <span className="ml-auto text-[12.5px] text-muted">{timeAgo(run.created_at)}</span>
                </div>
                <ul className="mt-1.5 space-y-0.5 pl-6 text-[13px] text-muted">
                  {run.log.map((l, i) => (
                    <li key={i} className={clsx(!l.ok && 'text-danger')}>
                      {l.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && <RuleModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
