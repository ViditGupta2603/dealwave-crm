import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarPlus, Check, Plus } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOwners } from '../lib/hooks';
import { cap, dateTime, timeAgo } from '../lib/format';
import {
  Avatar,
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
  Textarea,
  useToast,
} from '../components/ui';

const TABS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'open', label: 'All open' },
  { id: 'done', label: 'Completed' },
];

const PATH = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };

function NewTask({ onClose }) {
  const { user } = useAuth();
  const owners = useOwners();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ type: 'task', subject: '', notes: '', due: '', priority: 'normal', owner_id: user?.id ?? '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api('/activities', {
        body: {
          type: f.type,
          subject: f.subject,
          notes: f.notes || null,
          priority: f.priority,
          owner_id: f.owner_id || null,
          due_at: f.due ? new Date(f.due).toISOString() : null,
          completed_at: null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Task added');
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields);
      setError(Object.keys(e.fields).length ? '' : e.message);
    },
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Add task
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="What needs doing?" error={errors.subject} required>
          <Input autoFocus value={f.subject} onChange={set('subject')} placeholder="Send revised quotation" />
        </Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Type">
            <Select value={f.type} onChange={set('type')}>
              {['task', 'call', 'meeting', 'email'].map((t) => (
                <option key={t} value={t}>
                  {cap(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={set('priority')}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Due">
            <Input type="datetime-local" value={f.due} onChange={set('due')} />
          </Field>
          <Field label="Assigned to">
            <Select value={f.owner_id} onChange={set('owner_id')} disabled={user?.role === 'member'}>
              {owners.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={set('notes')} />
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const [tab, setTab] = useState('open');
  const [mine, setMine] = useState(true);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const params = { limit: 100, sort: 'due_at', dir: 'asc' };
  if (tab === 'overdue' || tab === 'today' || tab === 'week') params.due = tab;
  if (tab === 'open' || tab === 'overdue' || tab === 'today' || tab === 'week') {
    params.completed = 'no';
    params.type = 'task';
  }
  if (tab === 'done') {
    params.completed = 'yes';
    params.type = 'task';
    params.sort = 'completed_at';
    params.dir = 'desc';
  }
  if (mine && user?.role !== 'member') params.owner_id = 'me';
  const q = useQuery({ queryKey: ['tasks', params], queryFn: () => api('/activities', { params }) });
  const toggle = useMutation({
    mutationFn: (a) =>
      api(`/activities/${a.id}`, { method: 'PATCH', body: { completed_at: a.completed_at ? null : new Date().toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight">Tasks</h1>
          <p className="mt-0.5 text-muted">Follow-ups and to-dos across your leads and deals.</p>
        </div>
        <div className="flex items-center gap-3">
          {user?.role !== 'member' && (
            <label className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--primary))]"
              />
              Only mine
            </label>
          )}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New task
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={setTab} />
      </div>
      <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
        {q.isLoading && (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {q.data?.data.length === 0 && (
          <EmptyState icon={<Check className="h-5 w-5" />} title={tab === 'done' ? 'Nothing completed yet' : 'You are all clear'}>
            {tab === 'overdue' ? 'No overdue tasks. Keep it up.' : 'Add a task, or open a lead or deal to log a follow-up.'}
          </EmptyState>
        )}
        <ul className="divide-y divide-line">
          {q.data?.data.map((a) => {
            const done = !!a.completed_at;
            const overdue = !done && a.due_at && new Date(a.due_at) < new Date();
            return (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
                <button
                  aria-label={done ? 'Reopen task' : 'Mark task done'}
                  onClick={() => toggle.mutate(a)}
                  className={clsx(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                    done
                      ? 'border-success bg-success text-white'
                      : 'border-line text-transparent hover:border-success hover:bg-success-soft hover:text-success',
                  )}
                >
                  <Check className="h-3 w-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className={clsx('font-medium', done && 'text-muted line-through')}>{a.subject}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                    <span className={clsx(overdue && 'font-medium text-danger')}>
                      {a.due_at ? `${overdue ? 'Overdue - ' : 'Due '}${dateTime(a.due_at)}` : 'No due date'}
                    </span>
                    {a.related_type && a.related_name && (
                      <Link className="text-primary hover:underline" to={`/${PATH[a.related_type]}?open=${a.related_id}`}>
                        {cap(a.related_type)}: {a.related_name}
                      </Link>
                    )}
                    {done && <span>Done {timeAgo(a.completed_at)}</span>}
                  </p>
                </div>
                {a.due_at && !done && (
                  <button
                    aria-label={`Add "${a.subject}" to my calendar`}
                    title="Add to calendar"
                    className="rounded p-1.5 text-muted hover:bg-sunken hover:text-primary"
                    onClick={() => downloadFile(`/calendar/activity/${a.id}.ics`, 'dealwave-task.ics').catch(() => undefined)}
                  >
                    <CalendarPlus className="h-4 w-4" />
                  </button>
                )}
                {a.priority === 'high' && !done && <Badge tone="danger">High</Badge>}
                {a.owner_name && (
                  <span title={a.owner_name}>
                    <Avatar name={a.owner_name} size={24} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {creating && <NewTask onClose={() => setCreating(false)} />}
    </div>
  );
}
