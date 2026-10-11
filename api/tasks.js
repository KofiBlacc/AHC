import { sql, json, guard } from '../lib/common.js';
import { notifyTaskDone } from '../lib/notify.js';

const PRIOS = ['high', 'med', 'low'];
const STEPS = [0, 20, 50, 70, 100];

export default async function handler(req, res) {
  const me = await guard(req, res);
  if (!me) return;
  const isAdmin = me.role === 'admin';
  try {
    if (req.method === 'GET') {
      // Members only ever receive tasks assigned to them; this is enforced here, in the query.
      const rows = isAdmin
        ? await sql`select t.id, t.text, t.priority, to_char(t.due,'YYYY-MM-DD') as due, t.done, t.progress, t.needs_photo, t.assignee_id, u.name as assignee_name,
            exists(select 1 from task_photos p where p.task_id = t.id) as has_photo,
            (select count(*)::int from task_comments c where c.task_id = t.id) as comment_count
            from tasks t left join users u on u.id = t.assignee_id
            order by t.done, case t.priority when 'high' then 0 when 'med' then 1 else 2 end, t.due nulls last, t.id`
        : await sql`select t.id, t.text, t.priority, to_char(t.due,'YYYY-MM-DD') as due, t.done, t.progress, t.needs_photo, t.assignee_id, u.name as assignee_name,
            exists(select 1 from task_photos p where p.task_id = t.id) as has_photo,
            (select count(*)::int from task_comments c where c.task_id = t.id) as comment_count
            from tasks t left join users u on u.id = t.assignee_id
            where t.assignee_id = ${me.id}
            order by t.done, case t.priority when 'high' then 0 when 'med' then 1 else 2 end, t.due nulls last, t.id`;
      return json(res, 200, { tasks: rows });
    }
    const b = req.body || {};
    const id = Number(req.query.id);

    if (req.method === 'PATCH') {
      const [t] = await sql`select * from tasks where id = ${id}`;
      if (!t || (!isAdmin && t.assignee_id !== me.id)) return json(res, 404, { error: 'Task not found.' });

      if (!isAdmin) {
        // Members can only move the progress of their own, unfinished tasks.
        const p = Number(b.progress);
        if (b.progress === undefined || !STEPS.includes(p)) return json(res, 400, { error: 'Pick a progress step.' });
        if (t.done) return json(res, 403, { error: 'This task is already finished.' });
        if (p === 100 && t.needs_photo) return json(res, 400, { error: 'Add a photo to finish this task.' });
        await sql`update tasks set progress = ${p}, done = ${p === 100} where id = ${id}`;
        const notify = p === 100 ? await notifyTaskDone({ task: t.text, by: me.name }) : null;
        return json(res, 200, { ok: true, notify });
      }

      const text = b.text !== undefined ? String(b.text).trim() : t.text;
      const priority = PRIOS.includes(b.priority) ? b.priority : t.priority;
      const assignee = b.assignee_id !== undefined ? (b.assignee_id ? Number(b.assignee_id) : null) : t.assignee_id;
      const needsPhoto = b.needs_photo !== undefined ? !!b.needs_photo : t.needs_photo;
      const done = b.done !== undefined ? !!b.done : t.done;
      if (!text) return json(res, 400, { error: 'Task text is required.' });
      let progress = t.progress;
      if (b.progress !== undefined && STEPS.includes(Number(b.progress)) && Number(b.progress) < 100) progress = Number(b.progress);
      let notify = null;
      if (done && !t.done) {
        // Finishing a task that needs a photo goes through the photo upload (/api/evidence).
        if (needsPhoto) return json(res, 400, { error: 'Add a photo to finish this task.' });
        progress = 100;
        notify = await notifyTaskDone({ task: text, by: me.name });
      }
      if (!done && t.done) { // reopening discards the old evidence and resets progress
        progress = 0;
        await sql`delete from task_photos where task_id = ${id}`;
      }
      if (!done && progress === 100) progress = 70;
      await sql`update tasks set text = ${text}, priority = ${priority}, done = ${done}, progress = ${progress}, needs_photo = ${needsPhoto}, assignee_id = ${assignee} where id = ${id}`;
      return json(res, 200, { ok: true, notify });
    }

    if (!isAdmin) return json(res, 403, { error: 'Administrators only.' });

    if (req.method === 'POST') {
      const text = String(b.text || '').trim();
      if (!text) return json(res, 400, { error: 'Task text is required.' });
      const priority = PRIOS.includes(b.priority) ? b.priority : 'med';
      const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : null;
      const assignee = b.assignee_id ? Number(b.assignee_id) : null;
      const needsPhoto = b.needs_photo !== false;
      await sql`insert into tasks (text, priority, due, assignee_id, needs_photo) values (${text}, ${priority}, ${due}::date, ${assignee}, ${needsPhoto})`;
      return json(res, 201, { ok: true });
    }
    if (req.method === 'DELETE') {
      await sql`delete from tasks where id = ${id}`;
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
}
