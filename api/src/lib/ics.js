/** Minimal iCalendar (RFC 5545) writer. Works in Google Calendar, Apple Calendar and Outlook. */

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Lines must be at most 75 bytes; longer ones continue on the next line after a space. */
export function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let cur = '',
    bytes = 0,
    limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildCalendar(name, events, now = new Date()) {
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dealwave CRM//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
  ];
  for (const e of events) {
    const end = e.end ?? new Date(e.start.getTime() + 30 * 60_000);
    L.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(e.summary)}`,
    );
    if (e.description) L.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) L.push(`URL:${e.url}`);
    if (e.alarmMinutes !== undefined)
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.summary)}`, `TRIGGER:-PT${e.alarmMinutes}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
