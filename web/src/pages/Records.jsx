import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Download, Upload } from 'lucide-react';
import { api, ApiError, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LEAD_SOURCES } from '../lib/entities';
import { dateShort, rupeesShort, timeAgo } from '../lib/format';
import { Avatar, Badge, Button, ErrorNote, Modal, ScoreBar, StatusBadge, ViewToggle, useToast } from '../components/ui';
import { LeadBoard } from './LeadBoard';
import { EntityPage } from '../components/EntityPage';

const Person = ({ name, sub }) => (
  <div className="flex items-center gap-2.5">
    <Avatar name={name} size={30} />
    <div className="min-w-0">
      <p className="truncate font-medium">{name}</p>
      {sub && <p className="truncate text-[12.5px] text-muted">{sub}</p>}
    </div>
  </div>
);
const Owner = ({ name }) =>
  name ? (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} size={20} />
      <span className="truncate">{name}</span>
    </span>
  ) : (
    <span className="text-muted">Unassigned</span>
  );

function ImportModal({ onClose }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const qc = useQueryClient();
  const toast = useToast();
  const pick = (f) => {
    if (!f) return;
    setFileName(f.name);
    setError('');
    setResult(null);
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        if (!r.data.length) setError('This file has no rows.');
        else setRows(r.data);
      },
      error: () => setError('Could not read this file. Save it as CSV and try again.'),
    });
  };
  async function run() {
    setBusy(true);
    setError('');
    try {
      const res = await api('/leads/import', { body: { rows } });
      setResult(res);
      qc.invalidateQueries({ queryKey: ['list', 'leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${res.created} leads imported`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Import leads from CSV"
      width={560}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!rows} loading={busy} onClick={run}>
              {rows ? `Import ${rows.length} rows` : 'Import'}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <>
          <p className="text-muted">
            Columns we understand: first_name, last_name, email, phone, company, title, source, status, score, city, notes. Headers like
            "First Name" work too.
          </p>
          <button
            onClick={() => input.current?.click()}
            className="mt-3 flex w-full flex-col items-center rounded-panel border border-dashed border-line px-4 py-8 text-center hover:border-primary hover:bg-primary-soft/50"
          >
            <Upload className="h-6 w-6 text-muted" />
            <span className="mt-2 font-medium">{fileName || 'Choose a CSV file'}</span>
            <span className="text-[13px] text-muted">
              {rows ? `${rows.length} rows ready. Up to 2,000 at a time.` : 'Up to 2,000 rows at a time'}
            </span>
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        </>
      ) : (
        <div>
          <p className="text-[15px]">
            <span className="font-semibold text-success">{result.created} imported</span>
            {result.skipped > 0 && (
              <>
                , <span className="font-semibold text-danger">{result.skipped} skipped</span>
              </>
            )}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-control bg-sunken p-3 text-[13px] scroll-thin">
              {result.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

export function Leads() {
  const { can } = useAuth();
  const [importing, setImporting] = useState(false);
  const [view, setViewState] = useState(() => localStorage.getItem('dealwave.leadsView') || 'list');
  const setView = (v) => {
    setViewState(v);
    localStorage.setItem('dealwave.leadsView', v);
  };
  const toast = useToast();
  const columns = [
    {
      key: 'name',
      header: 'Lead',
      sort: 'first_name',
      render: (r) => <Person name={`${r.first_name} ${r.last_name || ''}`.trim()} sub={r.company} />,
    },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'score', header: 'Score', sort: 'score', hideBelow: 'md', render: (r) => <ScoreBar score={r.score} /> },
    { key: 'source', header: 'Source', hideBelow: 'lg', render: (r) => r.source || <span className="text-muted">-</span> },
    { key: 'city', header: 'City', hideBelow: 'lg', render: (r) => r.city || <span className="text-muted">-</span> },
    { key: 'owner', header: 'Owner', hideBelow: 'sm', render: (r) => <Owner name={r.owner_name} /> },
    {
      key: 'created',
      header: 'Added',
      sort: 'created_at',
      hideBelow: 'md',
      render: (r) => <span className="text-muted">{timeAgo(r.created_at)}</span>,
    },
  ];
  const importExport = (
    <>
      <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
        Import
      </Button>
      {can('member') && (
        <Button
          icon={<Download className="h-4 w-4" />}
          onClick={() => downloadFile('/leads/export.csv', 'leads.csv').catch(() => toast.error('Could not export leads'))}
        >
          Export
        </Button>
      )}
    </>
  );
  if (view === 'board')
    return (
      <>
        <LeadBoard view={view} setView={setView} actions={importExport} />
        {importing && <ImportModal onClose={() => setImporting(false)} />}
      </>
    );
  return (
    <>
      <EntityPage
        entity="lead"
        description="People and companies that might become customers."
        columns={columns}
        emptyHint="Add a lead by hand, or import a CSV to get started."
        filters={[
          {
            key: 'status',
            label: 'All statuses',
            options: ['new', 'contacted', 'qualified', 'unqualified', 'converted'].map((s) => ({
              value: s,
              label: s[0].toUpperCase() + s.slice(1),
            })),
          },
          { key: 'source', label: 'All sources', options: LEAD_SOURCES.map((s) => ({ value: s, label: s })) },
        ]}
        actions={
          <>
            {importExport}
            <ViewToggle view={view} onChange={setView} />
          </>
        }
      />
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </>
  );
}

export function Contacts() {
  const columns = [
    {
      key: 'name',
      header: 'Contact',
      sort: 'first_name',
      render: (r) => <Person name={`${r.first_name} ${r.last_name || ''}`.trim()} sub={r.title} />,
    },
    { key: 'account', header: 'Company', render: (r) => r.account_name || <span className="text-muted">-</span> },
    {
      key: 'email',
      header: 'Email',
      hideBelow: 'md',
      render: (r) => (r.email ? <span className="truncate">{r.email}</span> : <span className="text-muted">-</span>),
    },
    { key: 'phone', header: 'Phone', hideBelow: 'lg', render: (r) => <span className="num">{r.phone || '-'}</span> },
    { key: 'owner', header: 'Owner', hideBelow: 'sm', render: (r) => <Owner name={r.owner_name} /> },
    {
      key: 'created',
      header: 'Added',
      sort: 'created_at',
      hideBelow: 'lg',
      render: (r) => <span className="text-muted">{dateShort(r.created_at)}</span>,
    },
  ];
  return (
    <EntityPage
      entity="contact"
      description="The people you work with at customer companies."
      columns={columns}
      emptyHint="Contacts are created when you convert a lead, or you can add them directly."
    />
  );
}

export function Accounts() {
  const columns = [
    {
      key: 'name',
      header: 'Company',
      sort: 'name',
      render: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="text-[12.5px] text-muted">{[r.city, r.state].filter(Boolean).join(', ')}</p>
        </div>
      ),
    },
    {
      key: 'industry',
      header: 'Industry',
      hideBelow: 'md',
      render: (r) => (r.industry ? <Badge>{r.industry}</Badge> : <span className="text-muted">-</span>),
    },
    {
      key: 'contacts',
      header: 'Contacts',
      hideBelow: 'sm',
      className: 'text-right',
      render: (r) => <span className="num">{r.contact_count}</span>,
    },
    { key: 'deals', header: 'Deals', hideBelow: 'sm', className: 'text-right', render: (r) => <span className="num">{r.deal_count}</span> },
    {
      key: 'won',
      header: 'Won value',
      hideBelow: 'md',
      className: 'text-right',
      render: (r) => <span className="num">{r.won_value ? rupeesShort(r.won_value) : <span className="text-muted">-</span>}</span>,
    },
    {
      key: 'employees',
      header: 'Employees',
      sort: 'employees',
      hideBelow: 'lg',
      className: 'text-right',
      render: (r) => <span className="num">{r.employees?.toLocaleString('en-IN') ?? '-'}</span>,
    },
    { key: 'owner', header: 'Owner', hideBelow: 'lg', render: (r) => <Owner name={r.owner_name} /> },
  ];
  return (
    <EntityPage
      entity="account"
      description="Customer and prospect companies."
      columns={columns}
      emptyHint="Accounts are created when you convert a lead, or you can add one directly."
    />
  );
}
