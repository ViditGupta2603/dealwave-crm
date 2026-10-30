import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onForcedLogout, refreshSession, session } from './api';

const RANK = { member: 1, manager: 2, admin: 3, owner: 4 };

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(session.hasHint());
  const qc = useQueryClient();

  const clear = useCallback(() => {
    setUser(null);
    setTenant(null);
    qc.clear();
  }, [qc]);

  const refreshMe = useCallback(async () => {
    const me = await api('/auth/me');
    setUser(me.user);
    setTenant(me.tenant);
  }, []);

  // Restore a previous sign-in from the httpOnly cookie. Visitors who never signed in skip this entirely.
  useEffect(() => {
    if (!session.hasHint()) return;
    refreshSession()
      .then((ok) => (ok ? refreshMe() : session.set(null)))
      .catch(() => session.set(null))
      .finally(() => setLoading(false));
  }, [refreshMe]);

  useEffect(() => onForcedLogout(clear), [clear]);

  const signInWith = useCallback(
    (p) => {
      session.set(p.accessToken);
      qc.clear();
      setUser(p.user);
      setTenant(p.tenant);
    },
    [qc],
  );

  const value = useMemo(
    () => ({
      user,
      tenant,
      loading,
      signInWith,
      refreshMe,
      signIn: async (email, password) => {
        const r = await api('/auth/login', { body: { email, password }, auth: false });
        if (r.mfa_required) return { mfaToken: r.mfa_token };
        signInWith(r);
        return {};
      },
      verifyMfa: async (mfaToken, code) => signInWith(await api('/auth/2fa/verify', { body: { mfa_token: mfaToken, code }, auth: false })),
      signOut: async () => {
        await api('/auth/logout', { body: {}, auth: false }).catch(() => undefined);
        session.set(null);
        clear();
      },
      can: (min) => !!user && RANK[user.role] >= RANK[min],
    }),
    [user, tenant, loading, signInWith, refreshMe, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
