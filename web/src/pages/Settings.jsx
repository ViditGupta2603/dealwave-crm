import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Copy,
  Download,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { loadRazorpay } from '../lib/razorpay';
import { useAuth } from '../lib/auth';
import { ENTITIES } from '../lib/entities';

import { cap, dateShort, number, rupees, timeAgo } from '../lib/format';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Pagination,
  Panel,
  Select,
  Skeleton,
  Textarea,
  Toggle,
  useConfirm,
  useToast,
} from '../components/ui';
import { SOURCE_LABEL, STATUS_TONE } from '../components/RecordExtras';

const TABS = [
  { id: 'profile', label: 'Profile', min: 'member' },
  { id: 'team', label: 'Team', min: 'admin' },
  { id: 'pipeline', label: 'Pipeline stages', min: 'admin' },
  { id: 'fields', label: 'Custom fields', min: 'admin' },
  { id: 'email', label: 'Email', min: 'manager' },
  { id: 'ai', label: 'AI assistant', min: 'admin' },
  { id: 'plan', label: 'Plan and usage', min: 'admin' },
  { id: 'activity', label: 'Activity log', min: 'manager' },
];

// ---------------- Profile ----------------
function Profile() {
  const { user, tenant, refreshMe } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [title, setTitle] = useState(user?.title ?? '');
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwErr, setPwErr] = useState({});
  const save = useMutation({
    mutationFn: () => api('/auth/me', { method: 'PATCH', body: { name, title } }),
    onSuccess: async () => {
      await refreshMe();
      toast.success('Profile saved');
    },
    onError: (e) => toast.error(e.message),
  });
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { body: pw }),
    onSuccess: () => {
      setPw({ current_password: '', new_password: '' });
      setPwErr({});
      toast.success('Password changed. Other devices are signed out.');
    },
    onError: (e) => setPwErr(Object.keys(e.fields).length ? e.fields : { current_password: e.message }),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Your profile">
        <div className="flex items-center gap-3">
          <Avatar name={user?.name ?? '?'} size={48} />
          <div>
            <p className="font-medium">{user?.email}</p>
            <p className="text-muted">
              <span className="capitalize">{user?.role}</span> at {tenant?.name}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3.5">
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Job title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save profile
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="Change password">
        <form
          className="grid gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Current password" error={pwErr.current_password}>
            <Input
              type="password"
              autoComplete="current-password"
              value={pw.current_password}
              onChange={(e) => setPw({ ...pw, current_password: e.target.value })}
            />
          </Field>
          <Field label="New password" error={pwErr.new_password} hint="At least 8 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              value={pw.new_password}
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </Panel>
      <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
        <TwoFactor />
        <CalendarSync />
      </div>
    </div>
  );
}

// ---------------- Security: two-step verification ----------------
function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

function TwoFactor() {
  const { refreshMe } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ['2fa'], queryFn: () => api('/auth/2fa/status') });
  const [step, setStep] = useState('idle');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const done = () => {
    qc.invalidateQueries({ queryKey: ['2fa'] });
    refreshMe();
  };

  const start = useMutation({
    mutationFn: () => api('/auth/2fa/setup', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setSetup(r);
      setStep('scan');
      setCode('');
      setError('');
    },
    onError: (e) => toast.error(e.message),
  });
  const enable = useMutation({
    mutationFn: () => api('/auth/2fa/enable', { body: { code } }),
    onSuccess: (r) => {
      setCodes(r.backup_codes);
      setStep('codes');
      setSaved(false);
      done();
    },
    onError: (e) => setError(e.message),
  });
  const disable = useMutation({
    mutationFn: () => api('/auth/2fa/disable', { body: { password, code } }),
    onSuccess: () => {
      setStep('idle');
      setPassword('');
      setCode('');
      toast.success('Two-step verification is off');
      done();
    },
    onError: (e) => setError(e.message),
  });
  const downloadCodes = () => {
    const blob = new Blob([`Dealwave CRM backup codes\nEach code works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dealwave-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Panel
      title="Two-step verification"
      action={
        status.data?.enabled ? (
          <Badge tone="success">
            <ShieldCheck className="h-3 w-3" />
            On
          </Badge>
        ) : (
          <Badge>Off</Badge>
        )
      }
    >
      {step === 'idle' && (
        <>
          <p className="text-muted">
            {status.data?.enabled
              ? `Signing in needs your password and a 6-digit code from your authenticator app. ${status.data.backup_codes_left} backup code${status.data.backup_codes_left === 1 ? '' : 's'} left.`
              : 'Add a second lock. Even if someone learns your password, they cannot sign in without a code from your phone.'}
          </p>
          <div className="mt-3">
            {status.data?.enabled ? (
              <Button
                onClick={() => {
                  setStep('off');
                  setError('');
                  setCode('');
                  setPassword('');
                }}
              >
                Turn off
              </Button>
            ) : (
              <Button variant="primary" icon={<KeyRound className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>
                Turn on
              </Button>
            )}
          </div>
        </>
      )}
      {step === 'scan' && setup && (
        <div>
          <ol className="list-decimal space-y-1 pl-5 text-[14px] text-muted">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li>
            <li>Scan this picture, or type the setup key by hand.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              width={160}
              height={160}
              className="rounded-control border border-line bg-white p-1"
            />
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted">Setup key</p>
              <p className="break-all font-mono text-[14px] font-medium tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
              <div className="mt-2">
                <CopyButton text={setup.secret} label="Copy key" />
              </div>
            </div>
          </div>
          <form
            className="mt-4 flex max-w-xs gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={7}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
              aria-label="6-digit code"
              className="num"
            />
            <Button type="submit" variant="primary" loading={enable.isPending}>
              Confirm
            </Button>
          </form>
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
          <button className="mt-3 text-[13px] text-muted hover:text-ink" onClick={() => setStep('idle')}>
            Cancel
          </button>
        </div>
      )}
      {step === 'codes' && (
        <div>
          <p className="font-medium">Two-step verification is on. Save your backup codes now.</p>
          <p className="mt-1 text-[13.5px] text-muted">
            If you lose your phone, each of these signs you in once. They will not be shown again.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
            {codes.map((c) => (
              <li key={c} className="rounded-control bg-sunken px-3 py-1.5 text-center font-mono text-[14px]">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={codes.join('\n')} label="Copy all" />
            <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={downloadCodes}>
              Download
            </Button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--primary))]"
            />
            I have saved these codes somewhere safe
          </label>
          <Button className="mt-3" variant="primary" disabled={!saved} onClick={() => setStep('idle')}>
            Done
          </Button>
        </div>
      )}
      {step === 'off' && (
        <form
          className="grid max-w-sm gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          <p className="text-muted">Enter your password and a current code (or a backup code) to turn this off.</p>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Code">
            <Input
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="num"
            />
          </Field>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={disable.isPending}>
              Turn off
            </Button>
            <Button onClick={() => setStep('idle')}>Cancel</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// ---------------- Calendar sync ----------------
function CalendarSync() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState(null);
  const status = useQuery({ queryKey: ['calendar-feed'], queryFn: () => api('/calendar/feed') });
  const make = useMutation({
    mutationFn: () => api('/calendar/feed-token', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setUrl(r.url);
      qc.invalidateQueries({ queryKey: ['calendar-feed'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api('/calendar/feed-token', { method: 'DELETE' }),
    onSuccess: () => {
      setUrl(null);
      qc.invalidateQueries({ queryKey: ['calendar-feed'] });
      toast.success('Calendar link removed');
    },
  });
  return (
    <Panel title="Calendar sync" action={status.data?.enabled ? <Badge tone="success">Link active</Badge> : undefined}>
      <p className="flex gap-2 text-muted">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
        See your open tasks, calls and meetings inside Google Calendar, Apple Calendar or Outlook. Each task also has an "Add to calendar"
        button on the Tasks page.
      </p>
      {url ? (
        <div className="mt-3">
          <p className="text-[13.5px] font-medium">Your private link (shown only now)</p>
          <div className="mt-1.5 flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar link" />
            <CopyButton text={url} />
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13.5px] text-muted">
            <li>Google Calendar: on a computer, open "Other calendars" (+), choose "From URL", paste the link.</li>
            <li>Apple Calendar: File, New Calendar Subscription. Outlook: Add calendar, Subscribe from web.</li>
            <li>
              Calendar apps refresh subscribed links every few hours, and Google can take up to a day. New tasks do not appear instantly.
            </li>
          </ol>
          <p className="mt-2 text-[12.5px] text-warn">Anyone with this link can see your task titles. Do not share it.</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={make.isPending}
            onClick={async () => {
              if (
                !status.data?.enabled ||
                (await confirm({
                  title: 'Replace your calendar link?',
                  body: 'The old link stops working. You will need to subscribe again with the new one.',
                  confirmLabel: 'Replace link',
                }))
              )
                make.mutate();
            }}
          >
            {status.data?.enabled ? 'Make a new link' : 'Create my calendar link'}
          </Button>
          {status.data?.enabled && (
            <Button
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Stop syncing?',
                    body: 'Calendars using your link will stop receiving updates.',
                    confirmLabel: 'Remove link',
                    danger: true,
                  })
                )
                  remove.mutate();
              }}
            >
              Remove link
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------------- AI assistant ----------------
function AiSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api('/ai/status') });
  const toggle = useMutation({
    mutationFn: (enabled) => api('/ai/settings', { method: 'PATCH', body: { enabled } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-status'] });
      toast.success('Saved');
    },
    onError: (e) => toast.error(e.message),
  });
  const rescore = useMutation({
    mutationFn: () => api('/ai/rescore', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['list', 'leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${r.changed} of ${r.checked} lead scores updated`);
    },
    onError: (e) => toast.error(e.message),
  });
  const d = status.data;
  return (
    <div className="space-y-4">
      <Panel title="What works without any AI service">
        <ul className="space-y-2">
          {[
            ['Lead score with reasons', 'Every point is explained. Calculated by fixed rules inside Dealwave.'],
            ['Ask Dealwave (plain-English search)', 'Understands statuses, cities, sources, people, amounts in lakh or crore, and dates.'],
            ['Quick summaries', 'A factual briefing built from the record, its tasks and its emails.'],
            ['Email drafts', 'Picks your best-fitting saved template and fills in the details.'],
          ].map(([t, x]) => (
            <li key={t} className="flex gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                <b className="font-medium">{t}.</b> <span className="text-muted">{x}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="AI model (optional)"
        action={
          d?.ai_active ? (
            <Badge tone="success">
              <Sparkles className="h-3 w-3" />
              Active
            </Badge>
          ) : (
            <Badge>Not active</Badge>
          )
        }
      >
        {!d ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-3">
            <p className={d.llm_configured ? 'text-success' : 'text-muted'}>
              {d.llm_configured
                ? 'An AI service key is configured on this server.'
                : 'No AI service key is configured on this server. To turn on AI-written summaries and drafts, set ANTHROPIC_API_KEY in the server settings.'}
            </p>
            <div className="flex items-start gap-3">
              <Toggle checked={d.enabled} onChange={(v) => toggle.mutate(v)} label="Allow this workspace to use the AI model" />
              <div>
                <p className="font-medium">Allow this workspace to use the AI model</p>
                <p className="text-[13.5px] text-muted">
                  When on and a key is set, the text of the record you ask about (names, company, notes, recent activity titles) is sent to
                  the AI provider to write the answer. When off, nothing leaves Dealwave and the built-in versions are used.
                </p>
              </div>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Lead scores">
        <p className="text-muted">
          Re-calculate the score of every lead that is not yet converted, using the rules shown under "Why this score?" on each lead. This
          overwrites hand-set scores.
        </p>
        <Button
          className="mt-3"
          loading={rescore.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: 'Re-score all leads?',
                body: 'Scores you set by hand will be replaced by the calculated ones.',
                confirmLabel: 'Re-score',
              })
            )
              rescore.mutate();
          }}
        >
          Re-score all leads
        </Button>
      </Panel>
    </div>
  );
}

// ---------------- Team ----------------
function InviteModal({ onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: () => api('/team/invite', { body: { email, role } }),
    onSuccess: (r) => {
      setLink({ url: r.invite_link, emailed: r.emailed });
      qc.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (e) => setError(e.fields.email || e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite a teammate"
      width={460}
      footer={
        link ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
              Send invite
            </Button>
          </>
        )
      }
    >
      {!link ? (
        <div className="grid gap-3.5">
          <Field label="Email">
            <Input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="name@company.com"
            />
          </Field>
          <Field
            label="Role"
            hint={
              role === 'member'
                ? 'Sees and edits only their own records.'
                : role === 'manager'
                  ? 'Sees the whole team, can delete records and view reports.'
                  : 'Manages people, fields, automations and pipeline.'
            }
          >
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Sales executive (member)</option>
              <option value="manager">Manager</option>
              {user?.role === 'owner' && <option value="admin">Admin</option>}
            </Select>
          </Field>
          <ErrorNote message={error} />
        </div>
      ) : (
        <div>
          <p>
            {link.emailed
              ? `We emailed an invitation to ${email}.`
              : 'Email is not set up on this server, so share this link with them yourself.'}{' '}
            It works for 7 days.
          </p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <Button
              icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              onClick={() => {
                navigator.clipboard?.writeText(link.url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Team() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const q = useQuery({ queryKey: ['team'], queryFn: () => api('/team') });
  const patch = useMutation({
    mutationFn: ({ id, body }) => api(`/team/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['owners'] });
      toast.success('Saved');
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id) => api(`/team/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
  return (
    <>
      <Panel
        title="People"
        action={
          <Button variant="primary" size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>
            Invite
          </Button>
        }
        pad={false}
      >
        {q.isLoading && (
          <div className="p-4">
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        <ul className="divide-y divide-line">
          {q.data?.users.map((u) => {
            const locked = u.role === 'owner' || u.id === user?.id || (u.role === 'admin' && user?.role !== 'owner');
            return (
              <li key={u.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', !u.active && 'opacity-60')}>
                <Avatar name={u.name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {u.name} {u.id === user?.id && <span className="text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-[13px] text-muted">
                    {u.title ? `${u.title} - ` : ''}
                    {u.email}
                  </p>
                </div>
                <div className="hidden text-right text-[12.5px] text-muted md:block">
                  <p className="num">{u.open_deals} open deals</p>
                  <p>{u.last_login_at ? `Seen ${timeAgo(u.last_login_at)}` : 'Never signed in'}</p>
                </div>
                {locked ? (
                  <Badge tone="primary" className="capitalize">
                    {u.role}
                  </Badge>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="w-32">
                      <Select
                        value={u.role}
                        onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}
                        aria-label={`Role for ${u.name}`}
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                        {user?.role === 'owner' && <option value="admin">Admin</option>}
                      </Select>
                    </div>
                    <Toggle
                      checked={u.active}
                      onChange={(v) => patch.mutate({ id: u.id, body: { active: v } })}
                      label={u.active ? `Disable ${u.name}` : `Enable ${u.name}`}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      {q.data && q.data.invitations.length > 0 && (
        <Panel title="Pending invitations" className="mt-4" pad={false}>
          <ul className="divide-y divide-line">
            {q.data.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="text-[13px] text-muted capitalize">
                    {i.role} - expires {dateShort(i.expires_at)}
                  </p>
                </div>
                <Button size="sm" onClick={() => revoke.mutate(i.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </>
  );
}

// ---------------- Pipeline ----------------
function StageModal({ stage, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: stage?.name ?? '',
    probability: stage?.probability ?? 50,
    color: stage?.color ?? '#0F6B5C',
    kind: stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open',
  });
  const [errors, setErrors] = useState({});
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        probability: f.kind === 'won' ? 100 : f.kind === 'lost' ? 0 : Number(f.probability),
        color: f.color,
        is_won: f.kind === 'won',
        is_lost: f.kind === 'lost',
      };
      return stage ? api(`/pipeline/stages/${stage.id}`, { method: 'PATCH', body }) : api('/pipeline/stages', { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stages'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Stage saved');
      onClose();
    },
    onError: (e) => setErrors(Object.keys(e.fields).length ? e.fields : { name: e.message }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={stage ? 'Edit stage' : 'New stage'}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save stage
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="Name" error={errors.name}>
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="This stage means">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="open">Deal is still open</option>
            <option value="won">Deal is won</option>
            <option value="lost">Deal is lost</option>
          </Select>
        </Field>
        {f.kind === 'open' && (
          <Field label={`Chance of winning: ${f.probability}%`} hint="Used for the weighted forecast.">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={f.probability}
              onChange={(e) => setF({ ...f, probability: Number(e.target.value) })}
              className="w-full accent-[rgb(var(--primary))]"
            />
          </Field>
        )}
        <Field label="Colour" error={errors.color}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={f.color}
              onChange={(e) => setF({ ...f, color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-line bg-surface p-0.5"
              aria-label="Colour"
            />
            <span className="text-muted num">{f.color}</span>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function Pipeline() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['stages'], queryFn: () => api('/pipeline/stages') });
  const reorder = useMutation({
    mutationFn: (ids) => api('/pipeline/stages/reorder', { method: 'PATCH', body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stages'] }),
  });
  const del = useMutation({
    mutationFn: (id) => api(`/pipeline/stages/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stages'] });
      toast.success('Stage deleted');
    },
    onError: (e) => toast.error(e.message),
  });
  const move = (i, dir) => {
    const ids = q.data.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate(ids);
  };
  return (
    <Panel
      title="Deal stages"
      action={
        <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Add stage
        </Button>
      }
      pad={false}
    >
      <p className="border-b border-line px-4 py-3 text-muted">
        Deals move left to right through these stages. Won and lost stages close the deal.
      </p>
      {q.isLoading && (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      <ul className="divide-y divide-line">
        {q.data?.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.name}</p>
              <p className="text-[13px] text-muted num">
                {s.is_won ? 'Counts as won' : s.is_lost ? 'Counts as lost' : `${s.probability}% chance`} - {s.deal_count} deals
              </p>
            </div>
            <button
              aria-label="Move up"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="rounded p-1.5 text-muted hover:bg-sunken disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              aria-label="Move down"
              disabled={i === q.data.length - 1}
              onClick={() => move(i, 1)}
              className="rounded p-1.5 text-muted hover:bg-sunken disabled:opacity-30"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <Button size="sm" onClick={() => setEditing(s)}>
              Edit
            </Button>
            <button
              aria-label={`Delete ${s.name}`}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Delete "${s.name}"?`,
                    body: 'Stages with deals cannot be deleted. Move the deals first.',
                    confirmLabel: 'Delete',
                    danger: true,
                  })
                )
                  del.mutate(s.id);
              }}
              className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {editing && <StageModal stage={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

// ---------------- Custom fields ----------------
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 39);

function FieldModal({ onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ entity: 'lead', label: '', type: 'text', options: '', required: false });
  const [errors, setErrors] = useState({});
  const m = useMutation({
    mutationFn: () =>
      api('/fields', {
        body: {
          entity: f.entity,
          key: slug(f.label),
          label: f.label,
          type: f.type,
          options:
            f.type === 'select'
              ? f.options
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
          required: f.required,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fields'] });
      toast.success('Field added');
      onClose();
    },
    onError: (e) =>
      setErrors(
        Object.keys(e.fields).length
          ? { label: e.fields.key || e.fields.label || e.fields.options || Object.values(e.fields)[0] }
          : { label: e.message },
      ),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New custom field"
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Add field
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="Add it to">
          <Select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
            {Object.values(ENTITIES).map((e) => (
              <option key={e.key} value={e.key}>
                {cap(e.plural)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label" error={errors.label} hint={f.label ? `Stored as "${slug(f.label)}"` : undefined}>
          <Input autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Preferred language" />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Dropdown</option>
            <option value="boolean">Yes / No</option>
          </Select>
        </Field>
        {f.type === 'select' && (
          <Field label="Options" hint="Separate with commas.">
            <Input value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder="English, Hindi, Marathi" />
          </Field>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={f.required}
            onChange={(e) => setF({ ...f, required: e.target.checked })}
            className="h-4 w-4 accent-[rgb(var(--primary))]"
          />
          Required when saving a record
        </label>
      </div>
    </Modal>
  );
}

function Fields() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['fields', 'all'], queryFn: () => api('/fields') });
  const del = useMutation({
    mutationFn: (id) => api(`/fields/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fields'] });
      toast.success('Field removed');
    },
  });
  return (
    <Panel
      title="Custom fields"
      action={
        <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
          Add field
        </Button>
      }
      pad={false}
    >
      <p className="border-b border-line px-4 py-3 text-muted">
        Track details that are specific to your business. New fields appear in forms and record pages straight away.
      </p>
      {q.isLoading && (
        <div className="p-4">
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {q.data?.length === 0 && (
        <EmptyState title="No custom fields yet">Add fields like budget range, GST number or contract term.</EmptyState>
      )}
      {Object.keys(ENTITIES).map((e) => {
        const list = q.data?.filter((f) => f.entity === e) ?? [];
        if (!list.length) return null;
        return (
          <div key={e} className="border-b border-line last:border-0">
            <p className="bg-sunken/50 px-4 py-2 font-display text-[14px] font-semibold">{cap(ENTITIES[e].plural)}</p>
            <ul className="divide-y divide-line">
              {list.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {f.label} {f.required && <Badge tone="warn">Required</Badge>}
                    </p>
                    <p className="text-[13px] text-muted">
                      {cap(f.type === 'select' ? 'dropdown' : f.type)}
                      {f.type === 'select' ? `: ${f.options.join(', ')}` : ''}
                    </p>
                  </div>
                  <button
                    aria-label={`Delete ${f.label}`}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Remove "${f.label}"?`,
                          body: 'The field is hidden everywhere. Values already saved on records are kept but no longer shown.',
                          confirmLabel: 'Remove',
                          danger: true,
                        })
                      )
                        del.mutate(f.id);
                    }}
                    className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {adding && <FieldModal onClose={() => setAdding(false)} />}
    </Panel>
  );
}

// ---------------- Email ----------------
function TemplateModal({ onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: '', subject: '', body: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: () => api('/emails/templates', { body: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success('Template saved');
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
      title="New email template"
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="Template name" error={errors.name} required>
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Quotation follow-up" />
        </Field>
        <Field label="Subject" error={errors.subject} required>
          <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Following up for {{company}}" />
        </Field>
        <Field
          label="Message"
          error={errors.body}
          required
          hint="Use {{name}}, {{first_name}}, {{company}} and {{owner_name}} to fill in details automatically."
        >
          <Textarea className="min-h-[150px]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}

function EmailSettings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const templates = useQuery({ queryKey: ['email-templates'], queryFn: () => api('/emails/templates') });
  const log = useQuery({ queryKey: ['email-log', page, status], queryFn: () => api('/emails', { params: { page, limit: 15, status } }) });
  const del = useMutation({
    mutationFn: (id) => api(`/emails/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success('Template deleted');
    },
  });
  return (
    <div className="space-y-4">
      {log.data && (
        <p
          className={
            log.data.smtp_configured
              ? 'rounded-control bg-success-soft px-3.5 py-2.5 text-success'
              : 'rounded-control bg-warn-soft px-3.5 py-2.5 text-warn'
          }
        >
          {log.data.smtp_configured
            ? 'Email delivery is connected. Messages are sent through your SMTP server.'
            : 'Email delivery is not connected. Messages are saved in the history below but not delivered. Set the SMTP_HOST, SMTP_USER and SMTP_PASS settings on the server to turn it on.'}
        </p>
      )}
      <Panel
        title="Templates"
        action={
          <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            New template
          </Button>
        }
        pad={false}
      >
        {templates.isLoading && (
          <div className="p-4">
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {templates.data?.length === 0 && (
          <EmptyState title="No templates yet">Save the emails you send often, then reuse them in one click.</EmptyState>
        )}
        <ul className="divide-y divide-line">
          {templates.data?.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="truncate text-[13px] text-muted">{t.subject}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{t.body}</p>
              </div>
              <button
                aria-label={`Delete ${t.name}`}
                className="rounded p-1.5 text-muted hover:bg-sunken hover:text-danger"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete "${t.name}"?`,
                      body: 'Emails already sent are not affected.',
                      confirmLabel: 'Delete',
                      danger: true,
                    })
                  )
                    del.mutate(t.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Email history"
        action={
          <div className="w-40">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="sent">Sent</option>
              <option value="simulated">Saved, not sent</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
        }
        pad={false}
      >
        {log.isLoading && (
          <div className="p-4">
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {log.data?.data.length === 0 && (
          <EmptyState title="No emails yet">Emails you send, and those sent by automations, are listed here.</EmptyState>
        )}
        <ul className="divide-y divide-line">
          {log.data?.data.map((m) => {
            const st = STATUS_TONE[m.status] ?? STATUS_TONE.sent;
            return (
              <li key={m.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/60" onClick={() => setView(m)}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.subject}</p>
                    <p className="truncate text-[13px] text-muted">
                      To {m.to_email} - {m.sender_name || SOURCE_LABEL[m.source]}
                    </p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <span className="hidden w-24 shrink-0 text-right text-[12.5px] text-muted sm:block">{timeAgo(m.created_at)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {log.data && log.data.total > 0 && (
          <div className="border-t border-line">
            <Pagination page={page} limit={15} total={log.data.total} onPage={setPage} />
          </div>
        )}
      </Panel>
      {adding && <TemplateModal onClose={() => setAdding(false)} />}
      {view && (
        <Modal
          open
          onClose={() => setView(null)}
          title={view.subject}
          width={560}
          footer={
            <Button variant="primary" onClick={() => setView(null)}>
              Close
            </Button>
          }
        >
          <p className="text-[13px] text-muted">
            To {view.to_email} - {view.sender_name || SOURCE_LABEL[view.source]} - {SOURCE_LABEL[view.source]}
          </p>
          <p className="mt-3 whitespace-pre-wrap">{view.body}</p>
          {view.error && <p className="mt-3 text-danger">{view.error}</p>}
        </Modal>
      )}
    </div>
  );
}

// ---------------- Plan ----------------
function Plan() {
  const { user, tenant, refreshMe } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [paying, setPaying] = useState(null);
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api('/billing') });
  const change = useMutation({
    mutationFn: (plan) => api('/billing/plan', { body: { plan } }),
    onSuccess: async () => {
      await refreshMe();
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success('Plan updated');
    },
    onError: (e) => toast.error(e.message),
  });
  const online = q.data?.payment_gateway === 'razorpay';

  async function pay(planId) {
    setPaying(planId);
    try {
      const o = await api('/billing/checkout', { body: { plan: planId } });
      await loadRazorpay();
      const rzp = new window.Razorpay({
        key: o.key_id,
        order_id: o.order_id,
        amount: o.amount,
        currency: o.currency,
        name: 'Dealwave CRM',
        description: `${o.plan_name} plan, 1 month`,
        prefill: o.prefill,
        theme: { color: '#0F6B5C' },
        handler: async (resp) => {
          try {
            await api('/billing/verify', { body: resp });
            await refreshMe();
            qc.invalidateQueries({ queryKey: ['billing'] });
            toast.success(`You are on the ${o.plan_name} plan`);
          } catch (e) {
            toast.error(
              e instanceof ApiError
                ? e.message
                : 'We could not confirm the payment yet. If money was taken, your plan will update shortly.',
            );
            qc.invalidateQueries({ queryKey: ['billing'] });
          } finally {
            setPaying(null);
          }
        },
        modal: { ondismiss: () => setPaying(null) },
      });
      rzp.on('payment.failed', (r) => {
        toast.error(r?.error?.description || 'The payment did not go through');
        setPaying(null);
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the payment');
      setPaying(null);
    }
  }

  const cur = q.data?.plans.find((p) => p.id === q.data.plan);
  const bar = (label, used, max) => (
    <div key={label}>
      <div className="flex justify-between text-[13.5px]">
        <span>{label}</span>
        <span className="text-muted num">
          {number(used)} of {max === null ? 'unlimited' : number(max)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
        <div
          className={clsx('h-full rounded-full', max && used / max > 0.85 ? 'bg-danger' : 'bg-primary')}
          style={{ width: max === null ? '6%' : `${Math.min(100, (used / max) * 100)}%` }}
        />
      </div>
    </div>
  );
  const paidUntil = q.data?.plan_paid_until ? new Date(q.data.plan_paid_until) : null;
  return (
    <div className="space-y-4">
      <Panel
        title={`Usage on the ${cur?.name ?? ''} plan`}
        action={
          paidUntil && q.data?.plan !== 'free' ? (
            <span className={clsx('text-[13px]', paidUntil < new Date() ? 'font-medium text-danger' : 'text-muted')}>
              {paidUntil < new Date() ? 'Paid period ended' : 'Paid until'} {dateShort(paidUntil)}
            </span>
          ) : undefined
        }
      >
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          q.data &&
          cur && (
            <div className="grid gap-4 sm:grid-cols-3">
              {bar('People', q.data.usage.users, cur.limits.users)}
              {bar('Records', q.data.usage.records, cur.limits.records)}
              {bar('Automations', q.data.usage.workflows, cur.limits.workflows)}
            </div>
          )
        )}
      </Panel>
      <div className="grid gap-4 md:grid-cols-3">
        {q.data?.plans.map((p) => {
          const active = p.id === tenant?.plan;
          const paid = p.priceMonthly > 0;
          return (
            <section
              key={p.id}
              className={clsx(
                'flex flex-col rounded-panel border bg-surface p-4',
                active ? 'border-primary ring-1 ring-primary' : 'border-line',
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-[18px] font-semibold">{p.name}</h3>
                {active && <Badge tone="primary">Current</Badge>}
              </div>
              <p className="mt-0.5 text-[13.5px] text-muted">{p.tagline}</p>
              <p className="mt-3 font-display text-[26px] font-semibold num">
                {p.priceMonthly === 0 ? 'Free' : rupees(p.priceMonthly)}
                <span className="text-[13px] font-normal text-muted">{p.priceMonthly ? ' per month' : ''}</span>
              </p>
              <ul className="mt-3 flex-1 space-y-1.5 text-[13.5px]">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              {user?.role === 'owner' && paid && online && (
                <Button className="mt-4" variant="primary" loading={paying === p.id} disabled={!!paying} onClick={() => pay(p.id)}>
                  {active ? `Renew for ${rupees(p.priceMonthly)}` : `Pay ${rupees(p.priceMonthly)} and switch`}
                </Button>
              )}
              {user?.role === 'owner' && !active && !(paid && online) && (
                <Button
                  className="mt-4"
                  variant={p.priceMonthly ? 'primary' : 'secondary'}
                  loading={change.isPending && change.variables === p.id}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Switch to ${p.name}?`,
                        body: 'The new limits apply immediately.',
                        confirmLabel: 'Switch plan',
                      })
                    )
                      change.mutate(p.id);
                  }}
                >
                  {p.priceMonthly === 0 ? 'Downgrade' : `Switch to ${p.name}`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
      {online ? (
        <p className="text-[13px] text-muted">
          Payments are taken securely by Razorpay (UPI, cards, netbanking). One payment covers one month. Amounts are as listed, and the
          plan is not renewed automatically.
        </p>
      ) : (
        q.data && (
          <p className="text-[13px] text-muted">
            Online payments are not connected on this server, so plan changes apply immediately without a charge.
          </p>
        )
      )}
      {q.data && q.data.payments.length > 0 && (
        <Panel title="Payment history" pad={false}>
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-[12.5px] text-muted">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Plan</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data.payments.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{dateShort(p.paid_at ?? p.created_at)}</td>
                  <td className="px-2 capitalize">{p.plan === 'pro' ? 'Growth' : 'Scale'}</td>
                  <td className="px-2 text-right num">{rupees(p.amount_paise / 100)}</td>
                  <td className="px-4 text-right">
                    <Badge tone={p.status === 'paid' ? 'success' : p.status === 'failed' ? 'danger' : 'warn'}>
                      {p.status === 'paid' ? 'Paid' : p.status === 'failed' ? 'Failed' : 'Not completed'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

// ---------------- Activity log ----------------
function ActivityLog() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', page], queryFn: () => api('/audit', { params: { page, limit: 30 } }) });
  return (
    <Panel title="Everything that changed" pad={false}>
      {q.isLoading && (
        <div className="p-4">
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      <ul className="divide-y divide-line">
        {q.data?.data.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
            <Avatar name={a.user_name || 'System'} size={26} />
            <div className="min-w-0 flex-1 text-[13.5px]">
              <span className="font-medium">{a.user_name || 'System'}</span> {a.action} {a.entity}{' '}
              {a.label && <span className="text-muted">{a.label}</span>}
            </div>
            <span className="shrink-0 text-[12.5px] text-muted">{timeAgo(a.created_at)}</span>
          </li>
        ))}
      </ul>
      {q.data && (
        <div className="border-t border-line">
          <Pagination page={page} limit={30} total={q.data.total} onPage={setPage} />
        </div>
      )}
    </Panel>
  );
}

export default function Settings() {
  const { tab = 'profile' } = useParams();
  const { can } = useAuth();
  const allowed = TABS.filter((t) => can(t.min));
  const current = allowed.find((t) => t.id === tab);
  if (!current) return <Navigate to="/settings/profile" replace />;
  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-7">
      <h1 className="font-display text-[26px] font-semibold leading-tight">Settings</h1>
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-line scroll-thin" role="tablist">
        {allowed.map((t) => (
          <NavLink
            key={t.id}
            to={`/settings/${t.id}`}
            role="tab"
            className={({ isActive }) =>
              clsx(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] font-medium',
                isActive ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="mt-5">
        {tab === 'profile' && <Profile />}
        {tab === 'team' && <Team />}
        {tab === 'pipeline' && <Pipeline />}
        {tab === 'fields' && <Fields />}
        {tab === 'email' && <EmailSettings />}
        {tab === 'ai' && <AiSettings />}
        {tab === 'plan' && <Plan />}
        {tab === 'activity' && <ActivityLog />}
      </div>
    </div>
  );
}
