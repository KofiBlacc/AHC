// Public photo link used in the SMS: /p/<token>. No login, but the token is random and unguessable.
import { sql } from '../lib/common.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const t = String(req.query.t || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return res.status(404).send('Not found');
  try {
    const [p] = await sql`select mime, encode(data, 'base64') as b64 from task_photos where view_token = ${t}`;
    if (!p) return res.status(404).send('Not found');
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.status(200).send(Buffer.from(p.b64, 'base64'));
  } catch (e) {
    return res.status(500).send('Server error');
  }
}
