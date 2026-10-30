import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { ENTITIES } from '../lib/entities';
import { useAuth } from '../lib/auth';
import { useOwners } from '../lib/hooks';
import { Button, EmptyState, Input, Modal, Pagination, Select, Skeleton } from './ui';
import { RecordForm } from './RecordForm';
import { RecordDrawer } from './RecordDrawer';

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function EntityPage({ entity, description, columns, filters = [], actions, emptyHint, defaultSort = 'created_at' }) {
  const cfg = ENTITIES[entity];
  const { user } = useAuth();
  const owners = useOwners();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(defaultSort);
  const [dir, setDir] = useState('desc');
  const [filterVals, setFilterVals] = useState({});
  const [creating, setCreating] = useState(false);
  const openId = sp.get('open');
  const limit = 25;

  useEffect(() => {
    const t = setTimeout(() => {
      setDq(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = { page, limit, q: dq, sort, dir, ...filterVals };
  const list = useQuery({
    queryKey: ['list', cfg.path, params],
    placeholderData: keepPreviousData,
    queryFn: () => api(`/${cfg.path}`, { params }),
  });

  const setFilter = (k, v) => {
    setFilterVals((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  const toggleSort = (col) => {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(col);
      setDir(col === 'created_at' ? 'desc' : 'asc');
    }
    setPage(1);
  };
  const setOpen = (id) => {
    const n = new URLSearchParams(sp);
    if (id) n.set('open', id);
    else n.delete('open');
    setSp(n, { replace: true });
  };
  const rows = list.data?.data ?? [];
  const isFiltered = !!dq || Object.values(filterVals).some(Boolean);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight">{cfg.plural}</h1>
          <p className="mt-0.5 text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New {cfg.singular}
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            placeholder={cfg.searchHint}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={`Search ${cfg.plural.toLowerCase()}`}
          />
        </div>
        {filters.map((f) => (
          <div key={f.key} className="w-auto min-w-[136px]">
            <Select value={filterVals[f.key] ?? ''} onChange={(e) => setFilter(f.key, e.target.value)} aria-label={f.label}>
              <option value="">{f.label}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
        {user?.role !== 'member' && (
          <div className="min-w-[136px]">
            <Select value={filterVals.owner_id ?? ''} onChange={(e) => setFilter('owner_id', e.target.value)} aria-label="Owner">
              <option value="">All owners</option>
              <option value="me">Mine</option>
              <option value="none">Unassigned</option>
              {owners.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setFilterVals({});
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-sunken/60 text-[12.5px] text-muted">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={clsx('px-4 py-2.5 font-medium', c.hideBelow && hide[c.hideBelow], c.className)}
                    aria-sort={c.sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(c.sort)}>
                        {c.header}
                        {sort === c.sort && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx(list.isFetching && !list.isLoading && 'opacity-70 transition-opacity')}>
              {list.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className={clsx('px-4 py-3.5', c.hideBelow && hide[c.hideBelow])}>
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => setOpen(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setOpen(r.id);
                  }}
                  className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-sunken/70 focus-visible:bg-sunken/70"
                >
                  {columns.map((c) => (
                    <td key={c.key} className={clsx('px-4 py-3 align-middle', c.hideBelow && hide[c.hideBelow], c.className)}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isError && <EmptyState title="Could not load the list">Check your connection and refresh the page.</EmptyState>}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          <EmptyState
            icon={<cfg.icon className="h-5 w-5" />}
            title={isFiltered ? `No ${cfg.plural.toLowerCase()} match these filters` : `No ${cfg.plural.toLowerCase()} yet`}
            action={
              isFiltered ? (
                <Button
                  onClick={() => {
                    setQ('');
                    setFilterVals({});
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Add your first {cfg.singular}
                </Button>
              )
            }
          >
            {isFiltered ? 'Try a different search or remove a filter.' : emptyHint}
          </EmptyState>
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line">
            <Pagination page={page} limit={limit} total={list.data.total} onPage={setPage} />
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title={`New ${cfg.singular}`} width={640}>
        <RecordForm
          entity={entity}
          onCancel={() => setCreating(false)}
          onSaved={(r) => {
            setCreating(false);
            setOpen(r.id);
          }}
        />
      </Modal>
      {openId && <RecordDrawer entity={entity} id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}
