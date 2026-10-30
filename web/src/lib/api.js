export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/**
 * Sign-in model:
 *  - The access token lives only in memory (a page script can never read a stored copy of it).
 *  - The refresh token is an httpOnly cookie set by the server; this code cannot read it either.
 *  - "dealwave.hint" is just a flag meaning "this browser signed in before", so visitors who never did
 *    do not trigger a pointless refresh call.
 */
let accessToken = null;
const HINT = 'dealwave.hint';
const hasHint = () => {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
};
const setHint = (on) => {
  try {
    if (on) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    /* ignore */
  }
};

export const session = {
  hasHint,
  set(token) {
    accessToken = token;
    setHint(!!token);
  },
  token: () => accessToken,
};

const logoutListeners = new Set();
export const onForcedLogout = (fn) => {
  logoutListeners.add(fn);
  return () => {
    logoutListeners.delete(fn);
  };
};

const SAME_ORIGIN_HEADERS = { 'x-requested-with': 'dealwave' };

async function doRefresh() {
  try {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...SAME_ORIGIN_HEADERS },
      body: '{}',
      credentials: 'same-origin',
    });
    if (!r.ok) return false;
    accessToken = (await r.json()).accessToken;
    return !!accessToken;
  } catch {
    return false;
  }
}

let refreshing = null;
/**
 * Gets a new access token using the cookie. Refresh tokens rotate on every use, so two tabs refreshing at the same
 * moment would trip the server's theft detection. The Web Locks API makes tabs take turns.
 */
export function refreshSession() {
  if (refreshing) return refreshing;
  const run =
    typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('dealwave-refresh', () => doRefresh()) : doRefresh();
  const p = run.finally(() => {
    setTimeout(() => {
      refreshing = null;
    }, 0);
  });
  refreshing = p;
  return p;
}

export async function api(path, opts = {}) {
  const url = new URL('/api' + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.params || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const hasBody = opts.body !== undefined || opts.rawBody !== undefined;
  const doFetch = () =>
    fetch(url.pathname + url.search, {
      method: opts.method || (hasBody ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: {
        ...SAME_ORIGIN_HEADERS,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.rawBody !== undefined ? { 'Content-Type': opts.contentType || 'application/octet-stream' } : {}),
        ...(accessToken && opts.auth !== false ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.rawBody !== undefined ? opts.rawBody : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && opts.auth !== false && (accessToken || hasHint())) {
    if (await refreshSession()) res = await doFetch();
    if (res.status === 401) {
      session.set(null);
      logoutListeners.forEach((f) => f());
    }
  }
  if (opts.raw) return res;
  if (res.status === 204) return undefined;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong', data.fields || {});
  return data;
}

export async function downloadFile(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function uploadFile(entity, entityId, file) {
  return api('/attachments', {
    params: { entity, entity_id: entityId, filename: file.name },
    rawBody: file,
    contentType: 'application/octet-stream',
  });
}
