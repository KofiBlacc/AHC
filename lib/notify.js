// Texts the SMS_RECIPIENTS through Hubtel when a task is completed, with a link to the evidence photo.
// Never throws: an SMS problem must not stop a task being marked done.
const SEND_URL = process.env.HUBTEL_SMS_URL || 'https://smsc.hubtel.com/v1/messages/send';

export function recipients() {
  return String(process.env.SMS_RECIPIENTS || '').split(',').map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 9)
    .map((n) => (/^0\d{9}$/.test(n) ? '233' + n.slice(1) : n)); // Ghana local format 024... -> 23324...
}
export const smsConfigured = () => !!(process.env.HUBTEL_CLIENT_ID && process.env.HUBTEL_CLIENT_SECRET && process.env.HUBTEL_SENDER && recipients().length);

const short = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };

async function sendSms(to, content) {
  const auth = Buffer.from(`${process.env.HUBTEL_CLIENT_ID}:${process.env.HUBTEL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ From: process.env.HUBTEL_SENDER, To: to, Content: content, RegisteredDelivery: true }),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${d.Message || d.message || d.statusDescription || d.error || 'Rejected'} (HTTP ${r.status})`);
}

export async function notifyTaskDone({ task, by, link }) {
  if (!smsConfigured()) return null;
  const to = recipients();
  const content = `Task done: ${short(task, 70)} by ${short(by, 30)}. Photo: ${link}`;
  const results = await Promise.allSettled(to.map((n) => sendSms(n, content)));
  const bad = results.filter((r) => r.status === 'rejected');
  bad.forEach((r) => console.error('Hubtel SMS failed:', r.reason.message));
  return { sent: results.length - bad.length, failed: bad.length, error: bad[0] ? bad[0].reason.message : undefined };
}
