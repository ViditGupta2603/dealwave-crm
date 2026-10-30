import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AcceptInvite, ForgotPassword, GoogleDone, Login, Register, ResetPassword, VerifyEmail } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import { Accounts, Contacts, Leads } from './pages/Records';
import Deals from './pages/Deals';
import Tasks from './pages/Tasks';
import Landing from './pages/Landing';
import Ask from './pages/Ask';
import { DocsIndex, DocsPage } from './pages/Docs';

const Reports = lazy(() => import('./pages/Reports'));
const Automations = lazy(() => import('./pages/Automations'));
const Settings = lazy(() => import('./pages/Settings'));

/** "/" shows the marketing page to visitors and the app to signed-in users. Any other path needs a sign-in. */
function RootGate() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  if (user) return <Layout />;
  if (loc.pathname === '/') return <Landing />;
  return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
}

function Guest({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const Fallback = (
  <div className="flex h-64 items-center justify-center">
    <Spinner className="h-6 w-6" />
  </div>
);

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Guest>
            <Login />
          </Guest>
        }
      />
      <Route
        path="/register"
        element={
          <Guest>
            <Register />
          </Guest>
        }
      />
      <Route
        path="/accept-invite"
        element={
          <Guest>
            <AcceptInvite />
          </Guest>
        }
      />
      {/* Open to everyone: an emailed link may be opened while signed in or out, and Google lands here before the session exists. */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/auth/google/done" element={<GoogleDone />} />
      {/* Project pages (PRD, Architecture, Rules, Phases, Design, Memory): open to everyone */}
      <Route path="/docs" element={<DocsIndex />} />
      <Route path="/docs/:slug" element={<DocsPage />} />
      <Route path="/" element={<RootGate />}>
        <Route index element={<Dashboard />} />
        <Route path="leads" element={<Leads />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="deals" element={<Deals />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="ask" element={<Ask />} />
        <Route
          path="reports"
          element={
            <Suspense fallback={Fallback}>
              <Reports />
            </Suspense>
          }
        />
        <Route
          path="automations"
          element={
            <Suspense fallback={Fallback}>
              <Automations />
            </Suspense>
          }
        />
        <Route
          path="settings/:tab?"
          element={
            <Suspense fallback={Fallback}>
              <Settings />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
