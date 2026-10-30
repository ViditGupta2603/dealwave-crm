import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Info, KanbanSquare, List, Loader2, X } from 'lucide-react';
import { initials } from '../lib/format';

// ---------- Button ----------

const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none';
const btnVariants = {
  primary: 'bg-primary text-primary-ink hover:brightness-110 active:brightness-95',
  accent: 'bg-accent text-[#2a1c00] hover:brightness-105 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-danger text-white hover:brightness-110',
};

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(btnBase, btnVariants[variant], size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink transition-colors',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Form controls ----------
const control =
  'w-full rounded-control border border-line bg-surface px-3 text-ink placeholder:text-muted/70 transition-shadow focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-sunken disabled:text-muted';

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(control, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(control, 'py-2 min-h-[84px] resize-y', className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={clsx(control, 'h-9 appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
});

export function Field({ label, error, hint, children, className, required }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-[13px] font-medium text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12.5px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12.5px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line')}
    >
      <span
        className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')}
      />
    </button>
  );
}

// ---------- Badge / Avatar / misc ----------

const tones = {
  neutral: 'bg-sunken text-muted',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-[#e4ecfa] text-[#2f57a8] dark:bg-[#1c2c4a] dark:text-[#8fb2ee]',
};
export function Badge({ tone = 'neutral', children, className }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium leading-5', tones[tone], className)}
    >
      {children}
    </span>
  );
}

const avatarColors = ['#0F6B5C', '#B06A00', '#3E7CB1', '#8A4FB8', '#C8574B', '#2E9E5B', '#5B6B99', '#A6532F'];
export function Avatar({ name, size = 28, className }) {
  const bg = avatarColors[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarColors.length];
  return (
    <span
      className={clsx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-muted', className)} />;
}

export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse rounded bg-sunken', className)} />;
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-muted">{icon}</div>}
      <p className="font-display text-[17px] font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function Panel({ title, action, children, className, pad = true }) {
  return (
    <section className={clsx('rounded-panel border border-line bg-surface', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-[15.5px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            '-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors',
            value === t.id ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-muted num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-muted">
      <span className="num">
        {from}-{to} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <span className="px-1 num">
          Page {page} of {pages}
        </span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

// ---------- Overlays ----------
function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
}

function useLockScroll(open) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

export function Modal({ open, onClose, title, children, footer, width = 520 }) {
  useEscape(open, onClose);
  useLockScroll(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade bg-black/60" onClick={onClose} />
      <div
        className="relative flex max-h-[92vh] w-full animate-popIn flex-col rounded-t-2xl bg-surface shadow-pop sm:rounded-panel"
        style={{ maxWidth: width }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="font-display text-[17px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, width = 640 }) {
  useEscape(open, onClose);
  useLockScroll(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade bg-black/55" onClick={onClose} />
      <aside
        className="absolute right-0 top-0 flex h-full w-full animate-drawerIn flex-col bg-bg shadow-drawer"
        style={{ maxWidth: width }}
      >
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export function useClickOutside(onOutside, active = true) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    const k = (e) => {
      if (e.key === 'Escape') onOutside();
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [onOutside, active]);
  return ref;
}

export function Menu({ trigger, children, align = 'right', width = 220 }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close, open);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={clsx(
            'absolute z-30 mt-1.5 animate-popIn rounded-panel border border-line bg-surface p-1 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          style={{ width }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13.5px] hover:bg-sunken',
        danger && 'text-danger',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------- Toasts ----------

const ToastCtx = createContext({ push: () => undefined });

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((kind, text) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0"
          aria-live="polite"
        >
          {items.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex animate-popIn items-start gap-2.5 rounded-panel border border-line bg-surface px-3.5 py-3 shadow-pop"
            >
              {t.kind === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : t.kind === 'error' ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              )}
              <span className="text-[13.5px]">{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const { push } = useContext(ToastCtx);
  return useMemo(() => ({ success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t) }), [push]);
}

// ---------- Confirm ----------

const ConfirmCtx = createContext(async () => false);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const ask = useCallback((o) => new Promise((resolve) => setState({ ...o, resolve })), []);
  const done = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={!!state}
        onClose={() => done(false)}
        title={state?.title ?? ''}
        width={420}
        footer={
          <>
            <Button onClick={() => done(false)}>Cancel</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => done(true)}>
              {state?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="text-muted">{state?.body}</p>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Status pills ----------
export const LEAD_STATUS = {
  new: { label: 'New', tone: 'info' },
  contacted: { label: 'Contacted', tone: 'warn' },
  qualified: { label: 'Qualified', tone: 'primary' },
  unqualified: { label: 'Unqualified', tone: 'neutral' },
  converted: { label: 'Converted', tone: 'success' },
};
export function StatusBadge({ status }) {
  const s = LEAD_STATUS[status] ?? { label: status, tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ScoreBar({ score }) {
  const color = score >= 70 ? 'bg-success' : score >= 40 ? 'bg-accent' : 'bg-muted/50';
  return (
    <div className="flex items-center gap-2" title={`Lead score ${score}`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 text-[12.5px] text-muted num">{score}</span>
    </div>
  );
}

/** Board / List switch used on the Leads and Deals pages. */
export function ViewToggle({ view, onChange }) {
  const item = (v, label, icon) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={clsx(
        'inline-flex h-9 items-center gap-1.5 px-3 text-[13.5px] font-medium',
        view === v ? 'bg-primary-soft text-primary' : 'text-muted hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="inline-flex divide-x divide-line overflow-hidden rounded-control border border-line bg-surface">
      {item('board', 'Board', <KanbanSquare className="h-4 w-4" />)}
      {item('list', 'List', <List className="h-4 w-4" />)}
    </div>
  );
}
