const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹1,23,456 */
export const rupees = (n) => (n === null || n === undefined ? '-' : '₹' + inr.format(Math.round(n)));

/** ₹1.2 Cr / ₹45.6 L / ₹12,300 */
export function rupeesShort(n) {
  if (n === null || n === undefined) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '');
  if (abs >= 1e7) return `${sign}₹${fmt(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${fmt(abs / 1e5)} L`;
  return sign + '₹' + inr.format(Math.round(abs));
}

export const number = (n) => (n === null || n === undefined ? '-' : inr.format(n));

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(iso) {
  if (!iso) return '-';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

export const dateShort = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      })
    : '-';

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '-';

/** Value for <input type="datetime-local"> from an ISO string */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fullName = (r) => r.name || [r.first_name, r.last_name].filter(Boolean).join(' ');

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('') || '?';

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);
