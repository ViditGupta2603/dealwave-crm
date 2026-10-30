import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshSession, session } from './api';
import { useAuth } from './auth';
import { useToast } from '../components/ui';

const PATH = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };

/** Reads the server's event stream with fetch (so the access token can go in a header) and parses its frames. */
async function readStream(signal, onReady, onChange) {
  const res = await fetch('/api/events', {
    headers: { Authorization: `Bearer ${session.token()}`, 'x-requested-with': 'dealwave', Accept: 'text/event-stream' },
    signal,
    credentials: 'same-origin',
  });
  if (res.status === 401) return 'unauthorized';
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return 'closed';
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (ev === 'ready') onReady();
      else if (ev === 'reconnect') return 'reconnect';
      else if (ev === 'change' && data) {
        try {
          onChange(JSON.parse(data));
        } catch {
          /* ignore a bad frame */
        }
      }
    }
  }
}

/**
 * Keeps the screen in step with the workspace: when a teammate (or an automation) changes something, the lists,
 * boards, drawers and numbers you are looking at refresh by themselves.
 */
export function useRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('connecting');
  const me = user?.id;
  const lastToast = useRef(0);

  useEffect(() => {
    if (!me) return;
    const ctl = new AbortController();
    let pending = new Set();
    let timer;
    const invalidate = (...keys) => {
      keys.forEach((k) => pending.add(JSON.stringify(k)));
      if (!timer)
        timer = setTimeout(() => {
          const keys = [...pending];
          pending = new Set();
          timer = undefined;
          keys.forEach((k) => qc.invalidateQueries({ queryKey: JSON.parse(k) }));
        }, 200);
    };

    const handle = (c) => {
      if (c.type === 'notification') {
        invalidate(['notifications']);
        return;
      }
      if (!c.entity || !c.id) return;
      if (c.entity === 'activity') {
        invalidate(['tasks'], ['timeline'], ['dashboard'], ['notifications']);
        return;
      }
      const path = PATH[c.entity];
      invalidate(
        ['list', path],
        ['record', path, c.id],
        ['timeline', c.entity, c.id],
        ['files', c.entity, c.id],
        ['emails', c.entity, c.id],
        ['history', c.entity, c.id],
        ['related'],
        ['dashboard'],
      );
      // A short note when someone else moves or adds something. At most one every few seconds, so it never becomes noise.
      if (c.by_user_id && c.by_user_id !== me && c.by_name && c.label && Date.now() - lastToast.current > 4000) {
        const text =
          c.action === 'moved'
            ? `${c.by_name} moved ${c.label}${c.detail ? ` to ${c.detail}` : ''}`
            : c.action === 'created' && (c.entity === 'deal' || c.entity === 'lead')
              ? `${c.by_name} added ${c.entity} ${c.label}`
              : null;
        if (text) {
          lastToast.current = Date.now();
          toast.info(text);
        }
      }
    };

    (async () => {
      let delay = 1000;
      let triedRefresh = false;
      while (!ctl.signal.aborted) {
        try {
          setStatus((s) => (s === 'live' ? s : 'connecting'));
          const outcome = await readStream(
            ctl.signal,
            () => {
              delay = 1000;
              triedRefresh = false;
              setStatus('live');
            },
            handle,
          );
          if (ctl.signal.aborted) return;
          if (outcome === 'unauthorized') {
            // The access token expired while connected. Get a new one once; if that fails the sign-in is over.
            if (triedRefresh || !(await refreshSession())) {
              setStatus('offline');
              return;
            }
            triedRefresh = true;
            continue;
          }
          if (outcome === 'reconnect') {
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          setStatus('offline');
        } catch {
          if (ctl.signal.aborted) return;
          setStatus('offline');
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(30_000, delay * 2);
        // Anything may have changed while we were away.
        invalidate(['list'], ['dashboard'], ['tasks'], ['notifications']);
      }
    })();

    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [me, qc, toast]);

  return status;
}
