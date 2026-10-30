import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, FileImage, FileSpreadsheet, FileText, Mail, Paperclip, PenLine, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { api, ApiError, downloadFile, uploadFile } from '../lib/api';
import { ENTITIES } from '../lib/entities';
import { useAuth } from '../lib/auth';
import { dateTime, timeAgo } from '../lib/format';
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, Select, Skeleton, Textarea, useConfirm, useToast } from './ui';

const MAX_MB = 5;
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function FileIcon({ name }) {
  const ext = name.split('.').pop()?.toLowerCase();
  const cls = 'h-5 w-5';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return <FileImage className={cls} />;
  if (ext === 'xlsx' || ext === 'csv') return <FileSpreadsheet className={cls} />;
  return <FileText className={cls} />;
}

// ---------------- Files ----------------
export function FilesTab({ entity, id }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user, can } = useAuth();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const key = ['files', entity, id];
  const q = useQuery({ queryKey: key, queryFn: () => api('/attachments', { params: { entity, entity_id: id } }) });

  const up = useMutation({
    mutationFn: async (files) => {
      for (const f of files) {
        if (f.size > MAX_MB * 1024 * 1024) throw new ApiError(413, `"${f.name}" is larger than ${MAX_MB} MB`);
        await uploadFile(entity, id, f);
      }
      return files.length;
    },
    onSuccess: (n) => {
      setError('');
      qc.invalidateQueries({ queryKey: key });
      toast.success(n === 1 ? 'File uploaded' : `${n} files uploaded`);
    },
    onError: (e) => {
      setError(e.message);
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const del = useMutation({
    mutationFn: (a) => api(`/attachments/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success('File removed');
    },
    onError: (e) => toast.error(e.message),
  });

  const pick = (e) => {
    const f = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (f.length) up.mutate(f);
  };
  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    const f = Array.from(e.dataTransfer.files);
    if (f.length) up.mutate(f);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={clsx(
          'flex flex-col items-center rounded-panel border border-dashed px-4 py-6 text-center transition-colors',
          over ? 'border-primary bg-primary-soft/60' : 'border-line bg-surface',
        )}
      >
        <Upload className="h-6 w-6 text-muted" />
        <p className="mt-2 font-medium">Drop files here, or</p>
        <Button
          className="mt-2"
          variant="primary"
          size="sm"
          icon={<Paperclip className="h-4 w-4" />}
          loading={up.isPending}
          onClick={() => input.current?.click()}
        >
          Choose files
        </Button>
        <p className="mt-2 text-[12.5px] text-muted">PDF, images, Word, Excel, CSV or text. Up to {MAX_MB} MB each.</p>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt"
          onChange={pick}
          aria-label="Choose files to upload"
        />
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      <ul className="mt-4 divide-y divide-line rounded-panel border border-line bg-surface">
        {q.isLoading && (
          <li className="p-3">
            <Skeleton className="h-10 w-full" />
          </li>
        )}
        {q.data?.length === 0 && (
          <li>
            <EmptyState icon={<Paperclip className="h-5 w-5" />} title="No files yet">
              Attach the quotation, a signed form or a site photo so the whole team can find it.
            </EmptyState>
          </li>
        )}
        {q.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <FileIcon name={a.filename} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{a.filename}</p>
              <p className="text-[12.5px] text-muted">
                {kb(a.size_bytes)} - {a.uploaded_by_name || 'Someone'} - {timeAgo(a.created_at)}
              </p>
            </div>
            <Button
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={() =>
                downloadFile(`/attachments/${a.id}/download`, a.filename).catch(() => toast.error('Could not download the file'))
              }
            >
              Download
            </Button>
            {(a.uploaded_by === user?.id || can('manager')) && (
              <button
                aria-label={`Delete ${a.filename}`}
                className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete "${a.filename}"?`,
                      body: 'This cannot be undone.',
                      confirmLabel: 'Delete',
                      danger: true,
                    })
                  )
                    del.mutate(a);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- Email ----------------
export const STATUS_TONE = {
  sent: { label: 'Sent', tone: 'success' },
  simulated: { label: 'Saved, not sent', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
};
export const SOURCE_LABEL = { manual: 'Written by hand', automation: 'Automation', invite: 'Invitation' };

/** Fills {{placeholders}} in a template from the record being emailed. */
export function fillTemplate(text, vars) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? '');
}

export function ComposeEmailModal({ entity, record, onClose }) {
  const cfg = ENTITIES[entity];
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useQuery({ queryKey: ['email-templates'], queryFn: () => api('/emails/templates'), staleTime: 60_000 });
  const vars = {
    name: cfg.title(record),
    first_name: record.first_name || cfg.title(record),
    company: record.company || record.account_name || (entity === 'account' ? record.name : ''),
    owner_name: record.owner_name || user?.name || '',
  };
  const [to, setTo] = useState(record.email || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () => api('/emails/send', { body: { to, subject, body, related_type: entity, related_id: record.id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['emails', entity, record.id] });
      qc.invalidateQueries({ queryKey: ['timeline', entity, record.id] });
      toast.success(
        r.status === 'sent' ? 'Email sent' : 'Email saved. Email sending is not set up on this server, so it was not delivered.',
      );
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields);
      setError(Object.keys(e.fields).length ? '' : e.message);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Email ${cfg.title(record)}`}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Mail className="h-4 w-4" />} loading={send.isPending} onClick={() => send.mutate()}>
            Send email
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <DraftBar
          entity={entity}
          id={record.id}
          onDraft={(d) => {
            setSubject(d.subject);
            setBody(d.body);
          }}
        />
        <Field label="Use a template">
          <Select
            value=""
            onChange={(e) => {
              const t = templates.data?.find((x) => x.id === e.target.value);
              if (t) {
                setSubject(fillTemplate(t.subject, vars));
                setBody(fillTemplate(t.body, vars));
              }
            }}
          >
            <option value="">Start from scratch</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To" error={errors.to} required>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="Subject" error={errors.subject} required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message" error={errors.body} required>
          <Textarea className="min-h-[170px]" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

export function EmailsTab({ entity, id, record }) {
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(null);
  const q = useQuery({
    queryKey: ['emails', entity, id],
    queryFn: () => api('/emails', { params: { related_type: entity, related_id: id, limit: 50 } }),
  });
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted">{q.data ? `${q.data.total} email${q.data.total === 1 ? '' : 's'} on this record` : ' '}</p>
        <Button variant="primary" size="sm" icon={<PenLine className="h-4 w-4" />} onClick={() => setComposing(true)}>
          Write email
        </Button>
      </div>
      {q.data && !q.data.smtp_configured && (
        <p className="mt-3 rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Email delivery is not set up on this server (no SMTP details), so new emails are saved here but not actually sent.
        </p>
      )}
      <ul className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface">
        {q.isLoading && (
          <li className="p-3">
            <Skeleton className="h-10 w-full" />
          </li>
        )}
        {q.data?.data.length === 0 && (
          <li>
            <EmptyState icon={<Mail className="h-5 w-5" />} title="No emails yet">
              Write one with a template, or let an automation send it.
            </EmptyState>
          </li>
        )}
        {q.data?.data.map((m) => {
          const st = STATUS_TONE[m.status] ?? STATUS_TONE.sent;
          return (
            <li key={m.id} className="px-3.5 py-3">
              <button
                className="flex w-full items-start gap-3 text-left"
                onClick={() => setOpen(open === m.id ? null : m.id)}
                aria-expanded={open === m.id}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
                  <Mail className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.subject}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    To {m.to_email} - {m.sender_name || SOURCE_LABEL[m.source]} - {timeAgo(m.created_at)}
                  </span>
                </span>
                <Badge tone={st.tone}>{st.label}</Badge>
              </button>
              {open === m.id && (
                <div className="mt-2.5 animate-fade rounded-control bg-sunken/70 p-3 text-[13.5px]">
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-2 text-[12px] text-muted">
                    {SOURCE_LABEL[m.source]} - {dateTime(m.created_at)}
                  </p>
                  {m.error && <p className="mt-1 text-[12.5px] text-danger">{m.error}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {composing && <ComposeEmailModal entity={entity} record={record} onClose={() => setComposing(false)} />}
    </div>
  );
}

// ---------------- AI helpers shown in the record drawer ----------------

export function SummaryCard({ entity, id }) {
  const [out, setOut] = useState(null);
  const m = useMutation({ mutationFn: () => api('/ai/summary', { body: { entity, id } }), onSuccess: setOut });
  return (
    <section className="mb-4 rounded-panel border border-line bg-surface p-4" aria-label="Summary">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
          <Sparkles className="h-4 w-4 text-accent" />
          Quick summary
        </h3>
        <Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>
          {out ? 'Refresh' : 'Summarize'}
        </Button>
      </div>
      {!out && !m.isError && (
        <p className="mt-1.5 text-[13.5px] text-muted">Get a short briefing: where this stands, what happened lately, and what is due.</p>
      )}
      {m.isError && <p className="mt-2 text-[13.5px] text-danger">Could not create a summary. Try again.</p>}
      {out && (
        <>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{out.text}</p>
          <p className="mt-2 text-[12px] text-muted">
            {out.mode === 'ai'
              ? 'Written by an AI model from this record. Check anything important.'
              : 'Put together automatically from the record, with no AI involved.'}
          </p>
        </>
      )}
    </section>
  );
}

export function ScorePanel({ id, current, onApplied }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['lead-score', id], enabled: open, queryFn: () => api(`/ai/lead-score/${id}`) });
  const apply = useMutation({
    mutationFn: () => api(`/leads/${id}`, { method: 'PATCH', body: { score: q.data.score } }),
    onSuccess: () => {
      toast.success('Score updated');
      onApplied();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="mt-3">
      <button className="text-[13.5px] font-medium text-primary hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide score details' : 'Why this score? Suggest a score'}
      </button>
      {open && (
        <div className="mt-2 animate-fade rounded-panel border border-line bg-surface p-3.5">
          {q.isLoading && <Skeleton className="h-24 w-full" />}
          {q.data && (
            <>
              <p className="text-[13.5px]">
                Suggested score <b className="font-display text-[20px] num">{q.data.score}</b>{' '}
                <span className="text-muted">(now {current})</span>
              </p>
              <ul className="mt-2 divide-y divide-line text-[13.5px]">
                {q.data.factors.map((f) => (
                  <li key={f.label} className="flex items-center justify-between gap-3 py-1.5">
                    <span>{f.label}</span>
                    <span className={clsx('font-medium num', f.points < 0 ? 'text-danger' : 'text-success')}>
                      {f.points > 0 ? '+' : ''}
                      {f.points}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">
                Worked out by fixed rules from this lead's details and recent contact. Nothing is sent outside Dealwave.
              </p>
              {q.data.score !== current && (
                <Button className="mt-3" size="sm" variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
                  Use {q.data.score} as the score
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function useEmailDraft(entity, id) {
  return useMutation({ mutationFn: (goal) => api('/ai/email-draft', { body: { entity, id, goal } }) });
}

export function DraftBar({ entity, id, onDraft }) {
  const [goal, setGoal] = useState('');
  const [note, setNote] = useState('');
  const draft = useEmailDraft(entity, id);
  return (
    <div className="rounded-control border border-dashed border-line bg-sunken/50 p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <Wand2 className="h-4 w-4 text-accent" />
        Write it for me
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What should it say? e.g. send the quotation"
          aria-label="What the email should say"
        />
        <Button
          loading={draft.isPending}
          onClick={() =>
            draft.mutate(goal, {
              onSuccess: (d) => {
                onDraft(d);
                setNote(
                  d.mode === 'ai'
                    ? 'Drafted by an AI model. Please read it before sending.'
                    : 'Drafted from your saved templates. Connect an AI key for fully written drafts.',
                );
              },
            })
          }
        >
          Draft
        </Button>
      </div>
      {draft.isError && <p className="mt-1.5 text-[12.5px] text-danger">Could not draft. Try again.</p>}
      {note && <p className="mt-1.5 text-[12px] text-muted">{note}</p>}
    </div>
  );
}
