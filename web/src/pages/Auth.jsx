import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, session } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorNote, Field, Input, Spinner } from '../components/ui';
import { Logo } from '../components/Layout';

const SHOW_DEMO = (import.meta.env.VITE_SHOW_DEMO ?? 'true') !== 'false';

function Shell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-ink lg:flex lg:flex-col lg:justify-between">
        <Logo />
        <svg
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 opacity-95"
          viewBox="0 0 640 360"
          fill="none"
          aria-hidden
          preserveAspectRatio="xMidYMid slice"
        >
          <path
            d="M-20 250C110 250 150 110 300 110s210 140 360 140"
            stroke="#F2A900"
            strokeWidth="26"
            strokeLinecap="round"
            opacity=".95"
          />
          <path d="M-20 200C110 200 150 60 300 60s210 140 360 140" stroke="#5FD1BB" strokeWidth="18" strokeLinecap="round" opacity=".55" />
          <path d="M-20 300C110 300 150 160 300 160s210 140 360 140" stroke="#1d5b51" strokeWidth="30" strokeLinecap="round" opacity=".9" />
        </svg>
        <div className="relative max-w-md">
          <h2 className="font-display text-[34px] font-semibold leading-[1.1] text-white">Keep every deal moving.</h2>
          <p className="mt-3 text-[15.5px] text-sidebar-ink/80">
            Leads, contacts, deals and follow-ups in one workspace, with automations that do the chasing for you.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo light={false} />
          </div>
          <h1 className="font-display text-[28px] font-semibold leading-tight">{title}</h1>
          <p className="mt-1 text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

const DEMOS = [
  { label: 'Owner, Sundaram Solar', email: 'owner@sundaram.demo' },
  { label: 'Sales manager', email: 'arjun@sundaram.demo' },
  { label: 'Sales executive', email: 'rohan@sundaram.demo' },
  { label: 'Owner, Nimbus Logistics', email: 'owner@nimbus.demo' },
];

const GOOGLE_ERRORS = {
  google_failed: 'Google sign-in did not work. Please try again.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'That Google sign-in took too long. Please try again.',
  google_unverified: 'Google says that email address is not verified, so we cannot sign you in with it.',
  google_off: 'Google sign-in is not set up on this server.',
  account_disabled: 'Your account is disabled. Ask a workspace admin to re-enable it.',
  workspace_suspended: 'This workspace is suspended. Contact support.',
};

/** What the server supports (is Google set up?). Cached for the whole visit. */
function useProviders() {
  return useQuery({ queryKey: ['providers'], queryFn: () => api('/auth/providers', { auth: false }), staleTime: Infinity, retry: false });
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

/** "Continue with Google". A normal link (not a router link) because the browser must leave our app and visit Google. */
function GoogleButton({ label }) {
  const providers = useProviders();
  if (!providers.data?.google) return null;
  return (
    <div className="mb-5">
      <a
        href="/api/auth/google/start"
        className="flex h-10 w-full items-center justify-center gap-2.5 rounded-control border border-line bg-surface text-[14px] font-medium transition-colors hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <GoogleLogo />
        {label}
      </a>
      <div className="mt-5 flex items-center gap-3 text-[12.5px] text-muted">
        <span className="h-px flex-1 bg-line" />
        or use your email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

export function Login() {
  const { signIn, verifyMfa } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mfaToken, setMfaToken] = useState(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sp] = useSearchParams();
  const [error, setError] = useState(GOOGLE_ERRORS[sp.get('error') || ''] || '');
  const [notice] = useState(sp.get('reset') === '1' ? 'Your password was changed. Sign in with the new one.' : '');
  const [busy, setBusy] = useState(false);
  // After "Continue with Google" an account with two-step verification comes back here with a short-lived token in the URL fragment.
  useEffect(() => {
    const m = /(?:^#|&)mfa=([^&]+)/.exec(window.location.hash);
    if (m) {
      setMfaToken(decodeURIComponent(m[1]));
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  async function go(e, p) {
    setBusy(true);
    setError('');
    try {
      const r = await signIn(e, p);
      if (r.mfaToken) {
        setMfaToken(r.mfaToken);
        setBusy(false);
        return;
      }
      nav(loc.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setBusy(false);
    }
  }
  const submit = (e) => {
    e.preventDefault();
    go(email, password);
  };
  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyMfa(mfaToken, code);
      nav(loc.state?.from || '/', { replace: true });
    } catch (err) {
      const expired = err instanceof ApiError && /expired/i.test(err.message);
      setError(err instanceof ApiError ? err.message : 'Could not verify the code');
      if (expired) {
        setMfaToken(null);
        setCode('');
      }
      setBusy(false);
    }
  }
  if (mfaToken) {
    return (
      <Shell
        title="Check your authenticator app"
        subtitle="Enter the 6-digit code for Dealwave. You can also use one of your backup codes."
      >
        <form onSubmit={submitCode} className="space-y-4">
          <Field label="Verification code">
            <Input
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="text-center font-display text-[22px] tracking-[0.3em] num"
              maxLength={12}
            />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Verify and sign in
          </Button>
        </form>
        <p className="mt-5 text-center">
          <button
            className="text-primary hover:underline"
            onClick={() => {
              setMfaToken(null);
              setCode('');
              setError('');
            }}
          >
            Use a different account
          </button>
        </p>
      </Shell>
    );
  }
  return (
    <Shell title="Welcome back" subtitle="Sign in to your workspace.">
      {notice && (
        <div role="status" className="mb-4 rounded-control bg-success-soft px-3 py-2 text-[13.5px] text-success">
          {notice}
        </div>
      )}
      <GoogleButton label="Continue with Google" />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email">
          <Input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <ErrorNote message={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-5 text-center text-muted">
        New here?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create a workspace
        </Link>
      </p>
      {SHOW_DEMO && (
        <div className="mt-8 rounded-panel border border-line bg-surface p-4">
          <p className="font-display text-[15px] font-semibold">Try a demo workspace</p>
          <p className="mt-0.5 text-[13px] text-muted">Filled with sample leads, deals and tasks. One click signs you in.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DEMOS.map((d) => (
              <button
                key={d.email}
                disabled={busy}
                onClick={() => go(d.email, 'Demo@12345')}
                className="rounded-control border border-line px-3 py-2 text-left text-[13px] transition-colors hover:border-primary hover:bg-primary-soft disabled:opacity-50"
              >
                <span className="block font-medium">{d.label}</span>
                <span className="block truncate text-muted">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

export function Register() {
  const { signInWith } = useAuth();
  const [f, setF] = useState({ company_name: '', name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    try {
      signInWith(await api('/auth/register', { body: f, auth: false }));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(Object.keys(err.fields).length ? '' : err.message);
      }
      setBusy(false);
    }
  }
  return (
    <Shell title="Create your workspace" subtitle="Free for up to 3 people. No card needed.">
      <GoogleButton label="Sign up with Google" />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Company name" error={errors.company_name}>
          <Input required autoFocus value={f.company_name} onChange={set('company_name')} />
        </Field>
        <Field label="Your name" error={errors.name}>
          <Input required autoComplete="name" value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Work email" error={errors.email}>
          <Input type="email" required autoComplete="username" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters.">
          <Input type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Create workspace
        </Button>
      </form>
      <p className="mt-5 text-center text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

export function AcceptInvite() {
  const { signInWith } = useAuth();
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api(`/auth/invite/${token}`, { auth: false }),
    enabled: !!token,
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError('');
  }, [name, password]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      signInWith(await api('/auth/accept-invite', { body: { token, name, password }, auth: false }));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(Object.keys(err.fields).length ? '' : err.message);
      }
      setBusy(false);
    }
  }
  if (info.isError || !token)
    return (
      <Shell
        title="This invitation is not valid"
        subtitle="The link may have expired or was already used. Ask your admin to send a new one."
      >
        <Link to="/login" className="font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </Shell>
    );
  return (
    <Shell
      title={`Join ${info.data?.tenant_name ?? 'your team'}`}
      subtitle={info.data ? `You were invited as ${info.data.role} (${info.data.email}).` : 'Loading your invitation...'}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Your name" error={errors.name}>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Choose a password" error={errors.password} hint="At least 8 characters.">
          <Input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!info.data}>
          Join workspace
        </Button>
      </form>
    </Shell>
  );
}

// ---------------- Forgot password ----------------
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot-password', { body: { email }, auth: false });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.fields.email || err.message : 'Could not send the email');
    }
    setBusy(false);
  }
  if (sent) {
    return (
      <Shell title="Check your email" subtitle={`If ${email} has an account, we sent a link to choose a new password.`}>
        <ul className="list-disc space-y-1.5 pl-5 text-[14px] text-muted">
          <li>The link works for 1 hour and only once.</li>
          <li>Nothing yet? Look in your spam folder, then try again in a minute.</li>
        </ul>
        <p className="mt-6">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </Shell>
    );
  }
  return (
    <Shell title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email">
          <Input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <ErrorNote message={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
      <p className="mt-5 text-center text-muted">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </Shell>
  );
}

// ---------------- Choose a new password (from the emailed link) ----------------
export function ResetPassword() {
  const { signOut } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const check = useQuery({
    queryKey: ['reset-token', token],
    queryFn: () => api(`/auth/reset-password/${encodeURIComponent(token)}`, { auth: false }),
    enabled: !!token,
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError('');
    setFieldError('');
    if (password !== again) {
      setFieldError('The two passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/reset-password', { body: { token, password }, auth: false });
      await signOut(); // every old session was ended by the server; clear this browser's copy too
      nav('/login?reset=1', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields.password) setFieldError(err.fields.password);
        else setError(err.message);
      } else setError('Could not change the password');
      setBusy(false);
    }
  }
  if (!token || check.isError) {
    return (
      <Shell title="This link is not valid" subtitle="It may have expired or was already used. Reset links work for 1 hour, one time.">
        <Link to="/forgot-password" className="font-medium text-primary hover:underline">
          Send me a new link
        </Link>
      </Shell>
    );
  }
  return (
    <Shell title="Choose a new password" subtitle="You will be signed out everywhere else once it is changed.">
      {check.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password" hint="At least 8 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Type it again" error={fieldError}>
            <Input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Change password
          </Button>
        </form>
      )}
    </Shell>
  );
}

// ---------------- Confirm email (from the emailed link) ----------------
// A confirmation link works once, so the request must be sent only once per link even though React may run effects twice in development.
const verifying = new Map();

export function VerifyEmail() {
  const { user, refreshMe } = useAuth();
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [state, setState] = useState(token ? 'working' : 'failed');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!token) return;
    if (!verifying.has(token)) verifying.set(token, api('/auth/verify-email', { body: { token }, auth: false }));
    verifying
      .get(token)
      .then(() => {
        setState('done');
        return session.hasHint() ? refreshMe().catch(() => undefined) : undefined;
      })
      .catch((err) => {
        setMessage(err instanceof ApiError ? err.message : 'Could not confirm your email.');
        setState('failed');
      });
  }, [token, refreshMe]);
  if (state === 'working')
    return (
      <Shell title="Confirming your email" subtitle="One moment...">
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6" />
        </div>
      </Shell>
    );
  if (state === 'done') {
    return (
      <Shell title="Email confirmed" subtitle="Thank you. Your email address is now verified.">
        <Link to={user ? '/' : '/login'}>
          <Button variant="primary" className="w-full">
            {user ? 'Continue to Dealwave' : 'Go to sign in'}
          </Button>
        </Link>
      </Shell>
    );
  }
  return (
    <Shell title="This link is not valid" subtitle={message || 'It may have expired or was already used.'}>
      <p className="text-[14px] text-muted">
        {user
          ? 'Use the "Resend email" button at the top of the app to get a new link.'
          : 'Sign in and use the "Resend email" button at the top of the app to get a new link.'}
      </p>
      <p className="mt-5">
        <Link to={user ? '/' : '/login'} className="font-medium text-primary hover:underline">
          {user ? 'Back to the app' : 'Go to sign in'}
        </Link>
      </p>
    </Shell>
  );
}

// ---------------- Landing page after Google ----------------
// The server already signed the person in with a cookie; this page trades it for an access token. A refresh token can be
// used only once, so the request is made once even if React runs effects twice in development.
let googleDone = null;

export function GoogleDone() {
  const { signInWith } = useAuth();
  const nav = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!googleDone) googleDone = api('/auth/refresh', { body: {}, auth: false });
    googleDone
      .then((payload) => {
        googleDone = null;
        signInWith(payload);
        nav('/', { replace: true });
      })
      .catch(() => {
        googleDone = null;
        setFailed(true);
      });
  }, [signInWith, nav]);
  if (failed)
    return (
      <Shell
        title="We could not finish signing you in"
        subtitle="Your Google sign-in worked, but the session did not start. Please try again."
      >
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </Shell>
    );
  return (
    <Shell title="Signing you in" subtitle="Almost there...">
      <div className="flex justify-center py-6">
        <Spinner className="h-6 w-6" />
      </div>
    </Shell>
  );
}
