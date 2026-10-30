import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { timeAgo, rupeesShort } from '../lib/format';
import { Avatar, Badge, Button, EmptyState, ErrorNote, Input, Skeleton } from '../components/ui';

const PATH = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };

const EXAMPLES = [
  'qualified leads from website',
  'deals above 50 lakh closing this month',
  'my deals in proposal stage',
  'hot leads added this week',
  'lost deals under 10 lakh',
  'leads not updated in 30 days',
  'contacts in Pune',
];

export default function Ask() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const q = sp.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);
  const res = useQuery({
    queryKey: ['ask', q],
    enabled: q.trim().length >= 2,
    retry: false,
    queryFn: () => api('/ai/search', { body: { query: q } }),
  });
  const go = (e, v = text) => {
    e?.preventDefault();
    if (v.trim().length >= 2) setSp({ q: v.trim() });
  };

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-7">
      <h1 className="font-display text-[26px] font-semibold leading-tight">Ask Dealwave</h1>
      <p className="mt-0.5 text-muted">
        Type what you are looking for, the way you would say it. Amounts like "50 lakh" or "1.5 crore" work too.
      </p>

      <form onSubmit={(e) => go(e)} className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            autoFocus
            className="h-11 pl-9 text-[15.5px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. deals above 50 lakh closing this month"
            aria-label="Your question"
          />
        </div>
        <Button type="submit" variant="primary" className="h-11 px-5" icon={<Sparkles className="h-4 w-4" />}>
          Ask
        </Button>
      </form>

      {!q && (
        <div className="mt-6">
          <p className="text-[13px] font-medium text-muted">Try one of these</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13.5px] hover:border-primary hover:bg-primary-soft"
                onClick={() => {
                  setText(e);
                  go(undefined, e);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {q && res.isLoading && (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {res.isError && (
        <div className="mt-6">
          <ErrorNote message={res.error instanceof ApiError ? res.error.message : 'Could not search. Try again.'} />
        </div>
      )}

      {res.data && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2" aria-label="How your question was understood">
            <span className="text-[13px] text-muted">Understood as</span>
            {res.data.interpretation.map((c) => (
              <Badge key={c.label} tone="primary" className="capitalize">
                {c.label}: {c.value}
              </Badge>
            ))}
            <span className="ml-auto text-[12px] text-muted">
              {res.data.mode === 'ai' ? 'Read with an AI model' : 'Read with built-in rules'}
            </span>
          </div>
          {res.data.interpretation.length === 1 && (
            <p className="mt-2 text-[13.5px] text-muted">
              I did not spot any filters, so this shows the latest. Try adding a status, a city, an amount or a time, like the examples
              above.
            </p>
          )}
          {res.data.notes.map((n) => (
            <p key={n} className="mt-2 text-[13.5px] text-warn">
              {n}
            </p>
          ))}

          <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
            <p className="border-b border-line px-4 py-2.5 text-[13.5px] text-muted">
              <b className="text-ink num">{res.data.total}</b> {res.data.total === 1 ? 'match' : 'matches'}
              {res.data.total > res.data.rows.length ? `, showing the latest ${res.data.rows.length}` : ''}
            </p>
            {res.data.rows.length === 0 && (
              <EmptyState icon={<Search className="h-5 w-5" />} title="Nothing matches">
                Try loosening the question, for example removing the city or the amount.
              </EmptyState>
            )}
            <ul className="divide-y divide-line">
              {res.data.rows.map((r) => (
                <li key={r.id}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/60"
                    onClick={() => nav(`/${PATH[r.entity]}?open=${r.id}`)}
                  >
                    <Avatar name={r.title} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block truncate text-[13px] text-muted">{r.subtitle || '-'}</span>
                    </span>
                    {r.badge && <Badge className="hidden capitalize sm:inline-flex">{r.badge}</Badge>}
                    {r.amount !== null && <span className="w-24 shrink-0 text-right font-medium num">{rupeesShort(r.amount)}</span>}
                    {r.score !== null && (
                      <span className="hidden w-14 shrink-0 text-right text-[13px] text-muted num md:block">Score {r.score}</span>
                    )}
                    <span className="hidden w-28 shrink-0 truncate text-[13px] text-muted lg:block">{r.owner_name || 'Unassigned'}</span>
                    <span className="hidden w-24 shrink-0 text-right text-[12.5px] text-muted md:block">{timeAgo(r.created_at)}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">
            Prefer filters? Open{' '}
            <Link to="/leads" className="text-primary hover:underline">
              Leads
            </Link>{' '}
            or{' '}
            <Link to="/deals" className="text-primary hover:underline">
              Deals
            </Link>{' '}
            and use the search box and menus.
          </p>
        </div>
      )}
    </div>
  );
}
