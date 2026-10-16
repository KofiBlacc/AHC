import crypto from 'node:crypto';
import { sql, json, guard, sha256 } from '../lib/common.js';
import { sendMail } from '../lib/mail.js';

const PHONE = /^[+\d][\d\s().-]*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ['member', 'lead', 'viewer'];   // admins are only created by the first-login setup

// kind 'new': first invite. kind 'updated': an existing person whose email or access was edited.
async function sendInvite(user, kind = 'new') {
  const token = crypto.randomBytes(32).toString('hex');
  await sql`update users set invite_hash = ${sha256(token)}, invite_expires = now() + interval '7 days' where id = ${user.id}`;
  const link = process.env.APP_URL.replace(/\/$/, '') + '/?invite=' + token;
  await sendMail({
    to: user.email,
    subject: kind === 'new' ? "You've been added to the task list" : 'Your task list sign-in details',
    text: kind === 'new'
      ? `Hi ${user.name},\n\nYou've been added to the task list. Set your password and sign in here:\n${link}\n\nThis link works for 7 days.`
      : `Hi ${user.name},\n\nYour account on the task list now uses this email address (${user.email}). Use this link to set a password and sign in:\n${link}\n\nThis link works for 7 days.`,
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
      if (!name || !EMAIL.test(email)) return json(res, 400, { error: 'Enter a name and a valid email.' });
      // The mobile number is optional; if one is given, it must look like a phone number.
      if (phone && (!PHONE.test(phone) || digits.length < 7 || digits.length > 15)) return json(res, 400, { error: 'Enter a valid mobile number, or leave it empty.' });
      const role = ROLES.includes(b.role) ? b.role : 'member';
      let user;
      try { [user] = await sql`insert into users (name, email, phone, role) values (${name}, ${email}, ${phone}, ${role}) returning id, name, email, role`; }
      catch (e) { return json(res, 409, { error: /duplicate key/.test(e.message) ? 'That email is already registered.' : 'Could not save.' }); }
      try { await sendInvite(user); return json(res, 201, { user, emailSent: true }); }
      catch (e) { return json(res, 201, { user, emailSent: false, error: e.message }); }
    }
    if (req.method === 'PATCH') {
      const id = Number(req.query.id);
      const [u] = await sql`select id, name, email, phone, role, (password_hash is null) as invited from users where id = ${id}`;
      if (!u) return json(res, 404, { error: 'Person not found.' });
      const name = b.name !== undefined ? String(b.name).trim() : u.name;
      const email = b.email !== undefined ? String(b.email).trim().toLowerCase() : u.email;
      const phone = b.phone !== undefined ? String(b.phone).trim() : u.phone;
      const digits = phone.replace(/\D/g, '');
      if (!name || !EMAIL.test(email)) return json(res, 400, { error: 'Enter a name and a valid email.' });
      if (phone && (!PHONE.test(phone) || digits.length < 7 || digits.length > 15)) return json(res, 400, { error: 'Enter a valid mobile number, or leave it empty.' });
      const emailChanged = email !== u.email;
      if (emailChanged && id === me.id) return json(res, 400, { error: "You can't change your own email here." });
      let role = u.role;
      if (b.role !== undefined && b.role !== u.role) {
        if (u.role === 'admin' || !ROLES.includes(b.role)) return json(res, 400, { error: "This person's access can't be changed here." });
        if (b.role === 'viewer') {
          const [n] = await sql`select count(*)::int as n from tasks where assignee_id = ${id}`;
          if (n.n > 0) return json(res, 400, { error: `Reassign their ${n.n} task${n.n === 1 ? '' : 's'} first. Viewers cannot be assigned tasks.` });
        }
        role = b.role;
      }
      let user;
      try {
        // A new address cancels any invite link that was sent to the old one.
        [user] = emailChanged
          ? await sql`update users set name = ${name}, email = ${email}, phone = ${phone}, role = ${role}, invite_hash = null, invite_expires = null where id = ${id} returning id, name, email, role`
          : await sql`update users set name = ${name}, phone = ${phone}, role = ${role} where id = ${id} returning id, name, email, role`;
      } catch (e) { return json(res, 409, { error: /duplicate key/.test(e.message) ? 'That email is already used by someone else.' : 'Could not save.' }); }
      let emailSent = null, error;
      if (b.send_invite) {
        try { await sendInvite(user, u.invited ? 'new' : 'updated'); emailSent = true; }
        catch (e) { emailSent = false; error = e.message; }
      }
      return json(res, 200, { ok: true, user, emailSent, error });
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
