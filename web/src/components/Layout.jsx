import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Sparkles,
  Bell,
  BarChart3,
  Building2,
  CheckSquare,
  Handshake,
  LayoutDashboard,
  LogOut,
  BookOpen,
  Menu as MenuIcon,
  Mail,
  Moon,
  Search,
  Settings as SettingsIcon,
  Sun,
  Target,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { Avatar, Badge, IconButton, Menu, MenuItem, Spinner, useClickOutside, useToast } from './ui';
import { useRealtime } from '../lib/realtime';

export function Logo({ light = true, size = 26 }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? '#173d37' : '#0E2A26'} />
        <path d="M6 21c4 0 5-10 10-10s6 10 10 10" fill="none" stroke="#F2A900" strokeWidth="3" strokeLinecap="round" />
        <path d="M6 15c3 0 4-6 8-6" fill="none" stroke="#5FD1BB" strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
      </svg>
      <span className={clsx('font-display text-[19px] font-semibold tracking-tight', light ? 'text-white' : 'text-ink')}>Dealwave</span>
    </span>
  );
}

const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    group: 'Sales',
    items: [
      { to: '/leads', label: 'Leads', icon: Target },
      { to: '/contacts', label: 'Contacts', icon: UserRound },
      { to: '/accounts', label: 'Accounts', icon: Building2 },
      { to: '/deals', label: 'Deals', icon: Handshake },
    ],
  },
  {
    group: 'Work',
    items: [
      { to: '/tasks', label: 'Tasks', icon: CheckSquare },
      { to: '/ask', label: 'Ask Dealwave', icon: Sparkles },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    group: 'Setup',
    items: [
      { to: '/automations', label: 'Automations', icon: Workflow, min: 'manager' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
  { group: 'Project', items: [{ to: '/docs', label: 'Project pages', icon: BookOpen }] },
];

function useTheme() {
  const [theme, setTheme] = useState(() => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : 'light');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', next === 'dark' ? '#000000' : '#0E2A26');
    try {
      localStorage.setItem('dealwave.theme', next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

const TYPE_PATH = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const inputRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close, open);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);
  const res = useQuery({ queryKey: ['search', dq], enabled: dq.length >= 2, queryFn: () => api('/search', { params: { q: dq } }) });
  const go = (r) => {
    nav(`/${TYPE_PATH[r.type]}?open=${r.id}`);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim().split(/\s+/).length >= 3) {
            nav(`/ask?q=${encodeURIComponent(q.trim())}`);
            setOpen(false);
            setQ('');
            inputRef.current?.blur();
          }
        }}
        placeholder="Search leads, contacts, accounts, deals"
        className="h-9 w-full rounded-control border border-line bg-surface pl-9 pr-12 text-[14px] placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
        aria-label="Search everything"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-muted sm:block">
        Ctrl K
      </kbd>
      {open && dq.length >= 2 && (
        <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-[60vh] animate-popIn overflow-auto rounded-panel border border-line bg-surface p-1 shadow-pop scroll-thin">
          <button
            onClick={() => {
              nav(`/ask?q=${encodeURIComponent(dq)}`);
              setOpen(false);
              setQ('');
              inputRef.current?.blur();
            }}
            className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left hover:bg-sunken"
          >
            <span className="flex h-7 w-[68px] items-center justify-center rounded-full bg-accent/20 text-accent">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Ask in plain English: <b>{dq}</b>
            </span>
          </button>
          {res.isLoading && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}
          {res.data?.length === 0 && <p className="px-3 py-3 text-muted">No results for "{dq}"</p>}
          {res.data?.map((r) => (
            <button
              key={r.type + r.id}
              onClick={() => go(r)}
              className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left hover:bg-sunken"
            >
              <Badge
                tone={r.type === 'deal' ? 'warn' : r.type === 'account' ? 'info' : r.type === 'lead' ? 'primary' : 'neutral'}
                className="w-[68px] justify-center capitalize"
              >
                {r.type}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.title}</span>
                {r.subtitle && <span className="block truncate text-[12.5px] text-muted">{r.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api('/notifications'), refetchInterval: 60_000 });
  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readOne = useMutation({
    mutationFn: (id) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  return (
    <Menu
      width={340}
      trigger={({ toggle }) => (
        <IconButton label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={toggle} className="relative">
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-[#2a1c00]">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between px-2.5 py-2">
            <span className="font-display text-[15px] font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-[13px] text-primary hover:underline" onClick={() => readAll.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-auto scroll-thin">
            {q.data?.data.length === 0 && <p className="px-3 py-6 text-center text-muted">You are all caught up.</p>}
            {q.data?.data.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read_at) readOne.mutate(n.id);
                  if (n.link) nav(n.link);
                  close();
                }}
                className="flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left hover:bg-sunken"
              >
                <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent')} />
                <span className="min-w-0">
                  <span className="block font-medium">{n.title}</span>
                  {n.body && <span className="block truncate text-muted">{n.body}</span>}
                  <span className="block text-[12px] text-muted">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Menu>
  );
}

/** Shown to people whose email is not confirmed yet. It never blocks anything; it just keeps asking politely. */
function VerifyBanner() {
  const { user, refreshMe } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!user || user.email_verified !== false) return null;
  async function resend() {
    setBusy(true);
    try {
      await api('/auth/resend-verification', { body: {} });
      toast.success('Email sent. Check your inbox.');
    } catch (e) {
      toast.error(e?.message || 'Could not send the email');
    }
    setBusy(false);
  }
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-warn-soft px-4 py-2 text-[13.5px] text-warn sm:px-6"
    >
      <Mail className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        Please confirm your email address <strong className="font-medium">{user.email}</strong>. We sent you a link.
      </span>
      <span className="flex gap-3">
        <button disabled={busy} onClick={resend} className="font-medium underline disabled:opacity-60">
          Resend email
        </button>
        <button onClick={() => refreshMe().catch(() => undefined)} className="underline">
          I have confirmed it
        </button>
      </span>
    </div>
  );
}

export function Layout() {
  const { user, tenant, can, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const live = useRealtime();
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col border-r border-transparent bg-sidebar text-sidebar-ink dark:border-line">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <button
          className="rounded p-1 text-sidebar-ink/70 hover:text-white lg:hidden"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 pb-4 pt-2" aria-label="Main">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.min || can(i.min));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-4">
              <p className="px-2.5 pb-1 text-[12.5px] text-sidebar-ink/55">{g.group}</p>
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === '/'}
                  className={({ isActive }) =>
                    clsx(
                      'group relative flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[14px] transition-colors',
                      isActive ? 'bg-white/10 font-medium text-white' : 'text-sidebar-ink/85 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute -left-2.5 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-accent" />}
                      <i.icon className="h-[18px] w-[18px] opacity-90" />
                      {i.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-3">
        <p className="truncate text-[13.5px] font-medium text-white">{tenant?.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[12.5px] text-sidebar-ink/60">
            {tenant?.plan === 'pro' ? 'Growth plan' : tenant?.plan === 'enterprise' ? 'Scale plan' : 'Starter plan'}
          </span>
          {tenant?.plan === 'free' && can('admin') && (
            <button onClick={() => nav('/settings/plan')} className="text-[12.5px] font-medium text-accent hover:underline">
              Upgrade
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-[232px] shrink-0 lg:block">{sidebar}</aside>
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade bg-black/60" onClick={() => setNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[260px] animate-drawerIn">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-6">
          <IconButton label="Open menu" className="lg:hidden" onClick={() => setNavOpen(true)}>
            <MenuIcon className="h-5 w-5" />
          </IconButton>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <span
              className="mr-1 hidden items-center gap-1.5 text-[12.5px] text-muted sm:inline-flex"
              title={
                live === 'live'
                  ? 'Changes by your team appear here by themselves'
                  : live === 'connecting'
                    ? 'Connecting to live updates'
                    : 'Live updates are paused. Reconnecting...'
              }
              aria-live="polite"
            >
              <span
                className={clsx('h-2 w-2 rounded-full', live === 'live' ? 'bg-success' : live === 'connecting' ? 'bg-accent' : 'bg-danger')}
              />
              {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
            <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
              {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </IconButton>
            <Notifications />
            <Menu
              width={240}
              trigger={({ toggle: t }) => (
                <button
                  onClick={t}
                  className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-sunken"
                  aria-label="Account menu"
                >
                  <Avatar name={user?.name || '?'} size={30} />
                  <span className="hidden text-[13.5px] font-medium md:block">{user?.name.split(' ')[0]}</span>
                </button>
              )}
            >
              {(close) => (
                <div>
                  <div className="border-b border-line px-2.5 pb-2.5 pt-2">
                    <p className="font-medium">{user?.name}</p>
                    <p className="truncate text-[12.5px] text-muted">{user?.email}</p>
                    <Badge tone="primary" className="mt-1.5 capitalize">
                      {user?.role}
                    </Badge>
                  </div>
                  <div className="pt-1">
                    <MenuItem
                      icon={<SettingsIcon className="h-4 w-4" />}
                      onClick={() => {
                        nav('/settings/profile');
                        close();
                      }}
                    >
                      Profile and settings
                    </MenuItem>
                    <MenuItem
                      icon={<LogOut className="h-4 w-4" />}
                      onClick={() => {
                        close();
                        signOut();
                      }}
                    >
                      Sign out
                    </MenuItem>
                  </div>
                </div>
              )}
            </Menu>
          </div>
        </header>
        <VerifyBanner />
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
