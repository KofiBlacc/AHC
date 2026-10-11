// Comments on a task ("what is left"). Visible to the assigned person and admins.
import { sql, json, guard } from '../lib/common.js';

export default async function handler(req, res) {
  const me = await guard(req, res);
  if (!me) return;
  const id = Number(req.query.task);
  if (!Number.isInteger(id)) return json(res, 400, { error: 'Bad task id.' });
  try {
    const [t] = await sql`select id, assignee_id from tasks where id = ${id}`;
    if (!t || (me.role !== 'admin' && t.assignee_id !== me.id)) return json(res, 404, { error: 'Task not found.' });

    if (req.method === 'GET') {
      const rows = await sql`select c.id, c.body, c.created_at, u.name as author_name
        from task_comments c left join users u on u.id = c.author_id
        where c.task_id = ${id} order by c.created_at, c.id`;
      return json(res, 200, { comments: rows });
    }
    if (req.method === 'POST') {
      const body = String((req.body || {}).body || '').trim();
      if (!body) return json(res, 400, { error: 'Write a comment first.' });
      if (body.length > 1000) return json(res, 400, { error: 'Comments can be up to 1000 characters.' });
      await sql`insert into task_comments (task_id, author_id, body) values (${id}, ${me.id}, ${body})`;
      return json(res, 201, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (me.role !== 'admin') return json(res, 403, { error: 'Administrators only.' });
      await sql`delete from task_comments where id = ${Number(req.query.comment)} and task_id = ${id}`;
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
}
