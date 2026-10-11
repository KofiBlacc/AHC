// Texts the SMS_RECIPIENTS when a task is completed, with a link to the evidence photo.
// Providers: SimGate (simgate.app, sends from your own Android phone's SIM) or Hubtel.
// Never throws: an SMS problem must not stop a task being marked done.
const env = process.env;

export function recipients() {
  return String(env.SMS_RECIPIENTS || '').split(',').map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 9)
    .map((n) => (/^0\d{9}$/.test(n) ? '233' + n.slice(1) : n)); // Ghana local format 024... -> 23324...
}
const simgateConfigured = () => !!(env.SIMGATE_API_KEY && env.SIMGATE_DEVICE_ID);
const hubtelConfigured = () => !!(env.HUBTEL_CLIENT_ID && env.HUBTEL_CLIENT_SECRET && env.HUBTEL_SENDER);

// SMS_PROVIDER=simgate|hubtel forces one; otherwise SimGate is used if its key is set, else Hubtel.
export function provider() {
  const p = (env.SMS_PROVIDER || '').toLowerCase();
  if (p === 'simgate' || p === 'hubtel') return p;
  return simgateConfigured() ? 'simgate' : hubtelConfigured() ? 'hubtel' : null;
}
export const smsConfigured = () => {
  const p = provider();
  return recipients().length > 0 && (p === 'simgate' ? simgateConfigured() : p === 'hubtel' ? hubtelConfigured() : false);
};

const short = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const reason = async (r) => { const d = await r.json().catch(() => ({})); return `${d.Message || d.message || d.statusDescription || d.error || 'Rejected'} (HTTP ${r.status})`; };

// One request per recipient; your Android phone sends each SMS from its own SIM.
async function viaSimgate(n, content) {
  const r = await fetch(env.SIMGATE_URL || 'https://api.simgate.app/v1/sms/send', {
    method: 'POST',
    headers: { 'x-api-key': env.SIMGATE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: env.SIMGATE_DEVICE_ID, phoneNumber: '+' + n, message: content }),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(`${d.message || d.error || 'Rejected'} (HTTP ${r.status})`);
}

async function viaHubtel(n, content) {
  const r = await fetch(env.HUBTEL_SMS_URL || 'https://smsc.hubtel.com/v1/messages/send', {
    method: 'POST',
    headers: { Authorization: basic(env.HUBTEL_CLIENT_ID, env.HUBTEL_CLIENT_SECRET), 'Content-Type': 'application/json' },
    body: JSON.stringify({ From: env.HUBTEL_SENDER, To: n, Content: content, RegisteredDelivery: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(await reason(r));
}

export async function notifyTaskDone({ task, by, link }) {
  if (!smsConfigured()) return null;
  const to = recipients();
  const content = `Task done: ${short(task, 70)} by ${short(by, 30)}.` + (link ? ` Photo: ${link}` : '');
  try {
    const send = provider() === 'simgate' ? viaSimgate : viaHubtel;
    const results = await Promise.allSettled(to.map((n) => send(n, content)));
    const bad = results.filter((r) => r.status === 'rejected');
    bad.forEach((r) => console.error('SMS failed:', r.reason.message));
    return { sent: results.length - bad.length, failed: bad.length, error: bad[0] ? bad[0].reason.message : undefined };
  } catch (e) {
    console.error('SMS failed:', e.message);
    return { sent: 0, failed: to.length, error: e.message };
  }
}
