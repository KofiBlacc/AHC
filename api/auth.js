import crypto from 'node:crypto';
import { sql, json, hashPassword, checkPassword, sign, sha256, setCookie, currentUser } from '../lib/common.js';

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  const action = req.query.action;
  try {
    if (req.method === 'GET' && action === 'me') return json(res, 200, { user: await currentUser(req) });
    if (req.method === 'GET' && action === 'invite') {
      const rows = await sql`select name from users where invite_hash = ${sha256(String(req.query.token || ''))} and invite_expires > now()`;
      return rows[0] ? json(res, 200, { name: rows[0].name }) : json(res, 404, { error: 'This invite link is invalid or has expired.' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'JSON required' });
    const b = req.body || {};

    if (action === 'logout') { setCookie(res, '', 0); return json(res, 200, { ok: true }); }

    if (action === 'login') {
      const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
      let rows = await sql`select id, password_hash from users where email = ${email}`;
      const boot = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD;
      if (!rows[0] && boot && email === process.env.ADMIN_EMAIL.toLowerCase() && same(pw, process.env.ADMIN_PASSWORD)) {
        rows = await sql`insert into users (name, email, role, password_hash) values ('Administrator', ${email}, 'admin', ${hashPassword(pw)}) returning id, password_hash`;
      }
      if (!rows[0] || !checkPassword(pw, rows[0].password_hash)) return json(res, 401, { error: 'Incorrect email or password.' });
      setCookie(res, sign(rows[0].id), 14 * 86400);
      return json(res, 200, { ok: true });
    }

    if (action === 'accept') {
      const pw = String(b.password || '');
      if (pw.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      const rows = await sql`update users set password_hash = ${hashPassword(pw)}, invite_hash = null, invite_expires = null
        where invite_hash = ${sha256(String(b.token || ''))} and invite_expires > now() returning id`;
      if (!rows[0]) return json(res, 404, { error: 'This invite link is invalid or has expired.' });
      setCookie(res, sign(rows[0].id), 14 * 86400);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Unknown action' });
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
}
