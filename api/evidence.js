import { randomBytes } from 'node:crypto';
import { sql, json, guard } from '../lib/common.js';
import { notifyTaskDone } from '../lib/notify.js';

const MAX_BYTES = 2 * 1024 * 1024; // the page shrinks photos well below this

function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export default async function handler(req, res) {
  const me = await guard(req, res);
  if (!me) return;
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return json(res, 400, { error: 'Bad task id.' });
  try {
    const [t] = await sql`select id, assignee_id from tasks where id = ${id}`;
    // Only the assignee or an admin may see or add evidence for a task.
    if (!t || (me.role !== 'admin' && t.assignee_id !== me.id)) return json(res, 404, { error: 'Task not found.' });

    if (req.method === 'GET') {
      const [p] = await sql`select mime, encode(data, 'base64') as b64 from task_photos where task_id = ${id}`;
      if (!p) return json(res, 404, { error: 'No photo for this task.' });
      res.setHeader('Content-Type', p.mime);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(Buffer.from(p.b64, 'base64'));
    }

    if (req.method === 'POST') {
      const raw = String((req.body || {}).image || '').replace(/^data:[^;]+;base64,/, '');
      if (!raw || raw.length > MAX_BYTES * 1.4) return json(res, 413, { error: 'Photo is too large.' });
      const buf = Buffer.from(raw, 'base64');
      const mime = sniff(buf);
      if (!mime || buf.length > MAX_BYTES) return json(res, 400, { error: 'Please upload a JPEG, PNG or WebP photo.' });
      const token = randomBytes(12).toString('base64url'); // random, unguessable id for the public SMS link
      // Save the photo and mark the task done together, or neither.
      await sql.transaction([
        sql`insert into task_photos (task_id, mime, data, uploaded_by, view_token)
            values (${id}, ${mime}, decode(${buf.toString('base64')}, 'base64'), ${me.id}, ${token})
            on conflict (task_id) do update
            set mime = excluded.mime, data = excluded.data, uploaded_by = excluded.uploaded_by, view_token = excluded.view_token, uploaded_at = now()`,
        sql`update tasks set done = true where id = ${id}`,
      ]);
      // Tell the notification recipients (awaited, because serverless functions can stop right after responding).
      const [info] = await sql`select text from tasks where id = ${id}`;
      const notify = await notifyTaskDone({ task: info.text, by: me.name, link: `${String(process.env.APP_URL || '').replace(/\/$/, '')}/p/${token}` });
      return json(res, 200, { ok: true, notify });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
}
