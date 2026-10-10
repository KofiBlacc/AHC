import { sql, json, guard } from '../lib/common.js';

const PRIOS = ['high', 'med', 'low'];

export default async function handler(req, res) {
  const me = await guard(req, res);
  if (!me) return;
  const isAdmin = me.role === 'admin';
  try {
    if (req.method === 'GET') {
      // Members only ever receive tasks assigned to them; this is enforced here, in the query.
      const rows = isAdmin
        ? await sql`select t.id, t.text, t.priority, to_char(t.due,'YYYY-MM-DD') as due, t.done, t.assignee_id, u.name as assignee_name
            from tasks t left join users u on u.id = t.assignee_id
            order by t.done, case t.priority when 'high' then 0 when 'med' then 1 else 2 end, t.due nulls last, t.id`
        : await sql`select t.id, t.text, t.priority, to_char(t.due,'YYYY-MM-DD') as due, t.done, t.assignee_id, u.name as assignee_name
            from tasks t left join users u on u.id = t.assignee_id
            where t.assignee_id = ${me.id}
            order by t.done, case t.priority when 'high' then 0 when 'med' then 1 else 2 end, t.due nulls last, t.id`;
      return json(res, 200, { tasks: rows });
    }
    const b = req.body || {};
    const id = Number(req.query.id);

    if (req.method === 'PATCH') {
      if (!isAdmin) { // members may only tick off their own tasks
        const rows = await sql`update tasks set done = ${!!b.done} where id = ${id} and assignee_id = ${me.id} returning id`;
        return rows[0] ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Task not found.' });
      }
      const [t] = await sql`select * from tasks where id = ${id}`;
      if (!t) return json(res, 404, { error: 'Task not found.' });
      const text = b.text !== undefined ? String(b.text).trim() : t.text;
      const priority = PRIOS.includes(b.priority) ? b.priority : t.priority;
      const done = b.done !== undefined ? !!b.done : t.done;
      const assignee = b.assignee_id !== undefined ? (b.assignee_id ? Number(b.assignee_id) : null) : t.assignee_id;
      if (!text) return json(res, 400, { error: 'Task text is required.' });
      await sql`update tasks set text = ${text}, priority = ${priority}, done = ${done}, assignee_id = ${assignee} where id = ${id}`;
      return json(res, 200, { ok: true });
    }

    if (!isAdmin) return json(res, 403, { error: 'Administrators only.' });

    if (req.method === 'POST') {
      const text = String(b.text || '').trim();
      if (!text) return json(res, 400, { error: 'Task text is required.' });
      const priority = PRIOS.includes(b.priority) ? b.priority : 'med';
      const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : null;
      const assignee = b.assignee_id ? Number(b.assignee_id) : null;
      await sql`insert into tasks (text, priority, due, assignee_id) values (${text}, ${priority}, ${due}::date, ${assignee})`;
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
