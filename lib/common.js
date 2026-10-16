import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const json = (res, status, body) => res.status(status).json(body);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const mac = (p) => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(p).digest('base64url');
export function sign(uid) {
  const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 14 * 864e5 })).toString('base64url');
  return p + '.' + mac(p);
}
function verify(token) {
  const [p, m] = String(token || '').split('.');
  if (!p || !m) return null;
  const good = Buffer.from(mac(p)), got = Buffer.from(m);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  const d = JSON.parse(Buffer.from(p, 'base64url').toString());
  return d.exp > Date.now() ? d.uid : null;
}
export function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', `sid=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
export async function currentUser(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  const uid = m && verify(m[1]);
  if (!uid) return null;
  const rows = await sql`select id, name, email, phone, role from users where id = ${uid}`;
  return rows[0] || null;
}
// Returns the signed-in user, or sends an error and returns null.
export async function guard(req, res, { admin = false, staff = false } = {}) {
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) {
    json(res, 415, { error: 'JSON required' }); return null;
  }
  const me = await currentUser(req);
  if (!me) { json(res, 401, { error: 'Please sign in.' }); return null; }
  if (admin && me.role !== 'admin') { json(res, 403, { error: 'Administrators only.' }); return null; }
  if (staff && me.role !== 'admin' && me.role !== 'viewer' && me.role !== 'lead') { json(res, 403, { error: 'Staff only.' }); return null; }
  return me;
}
