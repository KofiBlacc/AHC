import crypto from 'node:crypto';
import { sql, json, guard, sha256 } from '../lib/common.js';
import { sendMail } from '../lib/mail.js';

const PHONE = /^[+\d][\d\s().-]*$/;

async function sendInvite(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await sql`update users set invite_hash = ${sha256(token)}, invite_expires = now() + interval '7 days' where id = ${user.id}`;
  const link = process.env.APP_URL.replace(/\/$/, '') + '/?invite=' + token;
  await sendMail({
    to: user.email,
    subject: "You've been added to the task list",
    text: `Hi ${user.name},\n\nYou've been added to the task list. Set your password and sign in here:\n${link}\n\nThis link works for 7 days.`,
  });
}

export default async function handler(req, res) {
  const me = await guard(req, res, { admin: true });
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const rows = await sql`select id, name, email, phone, role, (password_hash is null) as invited from users order by created_at, id`;
      return json(res, 200, { users: rows });
    }
    const b = req.body || {};
    if (req.method === 'POST' && req.query.action === 'resend') {
      const rows = await sql`select id, name, email from users where id = ${Number(b.id)} and password_hash is null`;
      if (!rows[0]) return json(res, 404, { error: 'Nothing to resend. They may have joined already.' });
      try { await sendInvite(rows[0]); return json(res, 200, { emailSent: true }); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (req.method === 'POST') {
      const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), phone = String(b.phone || '').trim();
      const digits = phone.replace(/\D/g, '');
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Enter a name and a valid email.' });
      if (!PHONE.test(phone) || digits.length < 7 || digits.length > 15) return json(res, 400, { error: 'Enter a valid mobile number.' });
      let user;
      try { [user] = await sql`insert into users (name, email, phone) values (${name}, ${email}, ${phone}) returning id, name, email`; }
      catch (e) { return json(res, 409, { error: /duplicate key/.test(e.message) ? 'That email is already registered.' : 'Could not save.' }); }
      try { await sendInvite(user); return json(res, 201, { user, emailSent: true }); }
      catch (e) { return json(res, 201, { user, emailSent: false, error: e.message }); }
    }
    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (id === me.id) return json(res, 400, { error: "You can't remove yourself." });
      await sql`delete from users where id = ${id}`;
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
}
