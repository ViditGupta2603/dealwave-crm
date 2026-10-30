import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { ENTITIES, LOST_REASONS } from '../lib/entities';
import { useFieldDefs, useOwners, useStages } from '../lib/hooks';
import { Button, ErrorNote, Field, Input, Select, Textarea, Toggle, useToast, useClickOutside } from './ui';
import { useAuth } from '../lib/auth';

export function RecordPicker({ path, value, label, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const ref = useClickOutside(() => setOpen(false), open);
  const results = useQuery({
    queryKey: ['picker', path, debounced],
    enabled: open,
    queryFn: () => api(`/${path}`, { params: { q: debounced, limit: 8, sort: debounced ? undefined : 'created_at' } }),
  });
  const nameOf = (r) => r.name || [r.first_name, r.last_name].filter(Boolean).join(' ');
  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Input
          value={open ? q : label || ''}
          placeholder={placeholder || 'Search...'}
          onFocus={() => {
            setOpen(true);
            setQ('');
          }}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {value && !open && (
          <button
            type="button"
            aria-label="Clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            onClick={() => onChange(null, null)}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full animate-popIn overflow-auto rounded-panel border border-line bg-surface p-1 shadow-pop scroll-thin">
          {results.isLoading && <li className="px-3 py-2 text-muted">Searching...</li>}
          {results.data?.data.length === 0 && <li className="px-3 py-2 text-muted">No matches</li>}
          {results.data?.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full rounded-control px-3 py-2 text-left hover:bg-sunken"
                onClick={() => {
                  onChange(r.id, nameOf(r));
                  setOpen(false);
                }}
              >
                <span className="block">{nameOf(r)}</span>
                <span className="block text-[12.5px] text-muted">{r.account_name || r.industry || r.email || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecordForm({ entity, initial, defaults, onSaved, onCancel, submitLabel }) {
  const cfg = ENTITIES[entity];
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const owners = useOwners();
  const stages = useStages();
  const defs = useFieldDefs(entity);
  const isEdit = !!initial?.id;
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of cfg.fields) v[f.key] = initial?.[f.key] ?? defaults?.[f.key] ?? '';
    if (!isEdit && entity === 'lead') {
      v.status = v.status || 'new';
      v.score = v.score === '' ? 30 : v.score;
    }
    if (!isEdit && !v.owner_id && user) v.owner_id = user.id;
    return v;
  });
  const [labels, setLabels] = useState(() => {
    const l = {};
    for (const f of cfg.fields) if (f.labelKey) l[f.key] = initial?.[f.labelKey] ?? defaults?.[f.labelKey] ?? null;
    return l;
  });
  const [custom, setCustom] = useState(initial?.custom_data ?? {});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const first = useRef(null);
  useEffect(() => {
    first.current?.querySelector('input')?.focus();
  }, []);

  const set = (k, v) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k])
      setErrors((e) => {
        const n = { ...e };
        delete n[k];
        return n;
      });
  };
  const stage = stages.data?.find((s) => s.id === values.stage_id);

  const render = (f) => {
    const v = values[f.key] ?? '';
    switch (f.type) {
      case 'textarea':
        return <Textarea value={v} onChange={(e) => set(f.key, e.target.value)} />;
      case 'select':
        return (
          <Select value={v} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">Select...</option>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      case 'owner':
        return (
          <Select value={v} onChange={(e) => set(f.key, e.target.value)} disabled={user?.role === 'member'}>
            <option value="">Unassigned</option>
            {owners.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        );
      case 'stage':
        return (
          <Select value={v} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">First open stage</option>
            {stages.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        );
      case 'account':
      case 'contact':
        return (
          <RecordPicker
            path={f.type === 'account' ? 'accounts' : 'contacts'}
            value={v || null}
            label={labels[f.key]}
            onChange={(id, l) => {
              set(f.key, id ?? '');
              setLabels((s) => ({ ...s, [f.key]: l }));
            }}
            placeholder={`Search ${f.type}s`}
          />
        );
      case 'score':
        return (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={v === '' ? 0 : v}
              onChange={(e) => set(f.key, Number(e.target.value))}
              className="h-1.5 w-full accent-[rgb(var(--primary))]"
              aria-label="Lead score"
            />
            <span className="w-8 text-right num">{v === '' ? 0 : v}</span>
          </div>
        );
      case 'money':
        return (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
            <Input type="number" min={0} inputMode="numeric" className="pl-7 num" value={v} onChange={(e) => set(f.key, e.target.value)} />
          </div>
        );
      default:
        return (
          <Input
            type={
              f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'
            }
            value={v ?? ''}
            placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
    }
  };

  const renderCustom = (d) => {
    const v = custom[d.key] ?? '';
    const setC = (x) => {
      setCustom((s) => ({ ...s, [d.key]: x }));
    };
    if (d.type === 'select')
      return (
        <Select value={v} onChange={(e) => setC(e.target.value)}>
          <option value="">Select...</option>
          {d.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      );
    if (d.type === 'boolean')
      return (
        <div className="flex h-9 items-center">
          <Toggle checked={!!custom[d.key]} onChange={setC} label={d.label} />
        </div>
      );
    return (
      <Input type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => setC(e.target.value)} />
    );
  };

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError('');
    const body = {};
    for (const f of cfg.fields) {
      let v = values[f.key];
      if (v === '' || v === undefined) v = null;
      if (v !== null && (f.type === 'number' || f.type === 'money')) v = Number(v);
      body[f.key] = v;
    }
    if (entity === 'deal') {
      if (body.amount === null) body.amount = 0;
      if (!stage?.is_lost) delete body.lost_reason;
      if (values.lost_reason && stage?.is_lost) body.lost_reason = values.lost_reason;
    }
    if (!isEdit && entity !== 'deal' && body.status === null) delete body.status;
    if (!isEdit && body.score === null) delete body.score;
    body.custom_data = custom;
    try {
      const saved = isEdit
        ? await api(`/${cfg.path}/${initial.id}`, { method: 'PATCH', body })
        : await api(`/${cfg.path}`, { method: 'POST', body });
      qc.invalidateQueries({ queryKey: ['list', cfg.path] });
      qc.invalidateQueries({ queryKey: ['record', cfg.path] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(isEdit ? `${cap(cfg.singular)} updated` : `${cap(cfg.singular)} created`);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(Object.keys(err.fields).length ? '' : err.message);
      } else setFormError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div ref={first} className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {cfg.fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            required={f.required}
            error={errors[f.key]}
            className={f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : ''}
          >
            {render(f)}
          </Field>
        ))}
        {entity === 'deal' && stage?.is_lost && (
          <Field label="Lost reason" className="sm:col-span-2">
            <Select value={values.lost_reason ?? ''} onChange={(e) => set('lost_reason', e.target.value)}>
              <option value="">Select...</option>
              {LOST_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
        )}
        {defs.data && defs.data.length > 0 && (
          <div className="sm:col-span-2 mt-1 border-t border-line pt-3.5">
            <p className="mb-2.5 font-display text-[14px] font-semibold">Extra details</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
              {defs.data.map((d) => (
                <Field key={d.id} label={d.label} required={d.required} error={errors[`custom_data.${d.key}`]}>
                  {renderCustom(d)}
                </Field>
              ))}
            </div>
          </div>
        )}
      </div>
      {formError && (
        <div className="mt-4">
          <ErrorNote message={formError} />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          {submitLabel || (isEdit ? 'Save changes' : `Create ${cfg.singular}`)}
        </Button>
      </div>
    </form>
  );
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
