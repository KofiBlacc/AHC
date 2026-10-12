// Departments that tasks can belong to. Admins and viewers can read; only admins change them.
import { sql, json, guard } from '../lib/common.js';

export default async function handler(req, res) {
  const me = await guard(req, res, { staff: true });
  if (!me) return;
  if (req.method !== 'GET' && me.role !== 'admin') return json(res, 403, { error: 'Administrators only.' });
  try {
    if (req.method === 'GET') {
      const rows = await sql`select d.id, d.name, (select count(*)::int from tasks t where t.department_id = d.id) as task_count
        from departments d order by lower(d.name)`;
      return json(res, 200, { departments: rows });
    }
    if (req.method === 'POST') {
      const name = String((req.body || {}).name || '').replace(/\s+/g, ' ').trim();
      if (!name) return json(res, 400, { error: 'Enter a department name.' });
      if (name.length > 60) return json(res, 400, { error: 'Department names can be up to 60 characters.' });
      try {
        const [d] = await sql`insert into departments (name) values (${name}) returning id, name`;
        return json(res, 201, { department: d });
      } catch (e) {
        return json(res, 409, { error: /duplicate key/.test(e.message) ? 'That department already exists.' : 'Could not save.' });
      }
    }
    if (req.method === 'DELETE') {
      await sql`delete from departments where id = ${Number(req.query.id)}`; // its tasks keep existing, with no department
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
}
