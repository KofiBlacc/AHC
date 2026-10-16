// Numbers for the dashboard (admins and viewers). Optional ?dept=<id> or ?dept=none filters everything by department.
import { sql, json, guard } from '../lib/common.js';

const tzOk = (tz) => { try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch (e) { return false; } };

export default async function handler(req, res) {
  const me = await guard(req, res, { staff: true });
  if (!me) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const dq = String(req.query.dept || '');
  if (dq && dq !== 'none' && !/^\d+$/.test(dq)) return json(res, 400, { error: 'Bad department.' });
  const all = !dq, none = dq === 'none', did = /^\d+$/.test(dq) ? Number(dq) : null;
  const tz = process.env.APP_TIMEZONE && tzOk(process.env.APP_TIMEZONE) ? process.env.APP_TIMEZONE : 'UTC';
  try {
    // "cond" below = this task is inside the chosen department (or no filter is set)
    const [totals, people, unassigned, priorities, days, overdue, recent, comments, departments] = await Promise.all([
      sql`select count(*)::int as total,
                 count(*) filter (where t.done)::int as done,
                 count(*) filter (where not t.done)::int as open,
                 count(*) filter (where not t.done and t.progress > 0)::int as started,
                 count(*) filter (where not t.done and t.due < current_date)::int as overdue
          from tasks t
          where (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)`,
      sql`select u.id, u.name,
                 count(t.id)::int as assigned,
                 (count(t.id) filter (where t.done))::int as done,
                 (count(t.id) filter (where not t.done and t.due < current_date))::int as overdue
          from users u left join tasks t on t.assignee_id = u.id
               and (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)
          group by u.id, u.name, u.role
          having (${all}::boolean and u.role in ('member', 'lead')) or count(t.id) > 0
          order by u.name`,
      sql`select count(*)::int as assigned,
                 (count(*) filter (where t.done))::int as done,
                 (count(*) filter (where not t.done and t.due < current_date))::int as overdue
          from tasks t where t.assignee_id is null
          and (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)`,
      sql`select t.priority, count(*)::int as total, (count(*) filter (where t.done))::int as done
          from tasks t
          where (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)
          group by t.priority`,
      sql`select to_char(t.done_at at time zone ${tz}, 'YYYY-MM-DD') as day, count(*)::int as n
          from tasks t
          where t.done and t.done_at > now() - interval '16 days'
          and (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)
          group by 1`,
      sql`select t.id, t.text, t.priority, to_char(t.due,'YYYY-MM-DD') as due, u.name as assignee_name
          from tasks t left join users u on u.id = t.assignee_id
          where not t.done and t.due < current_date
          and (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)
          order by t.due, t.id limit 10`,
      sql`select t.id, t.text, u.name as assignee_name, t.done_at,
                 exists(select 1 from task_photos p where p.task_id = t.id) as has_photo
          from tasks t left join users u on u.id = t.assignee_id
          where t.done and t.done_at is not null
          and (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)
          order by t.done_at desc limit 10`,
      sql`select c.body, c.created_at, t.text as task_text, u.name as author_name
          from task_comments c join tasks t on t.id = c.task_id left join users u on u.id = c.author_id
          where (${all}::boolean or (${none}::boolean and t.department_id is null) or t.department_id = ${did}::int)
          order by c.created_at desc limit 8`,
      sql`select id, name from departments order by lower(name)`,
    ]);

    const byDay = Object.fromEntries(days.map((d) => [d.day, d.n]));
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
      daily.push({ day, n: byDay[day] || 0 });
    }
    const rows = people.slice();
    if (unassigned[0] && unassigned[0].assigned > 0) rows.push({ id: null, name: 'Unassigned', ...unassigned[0] });

    return json(res, 200, { totals: totals[0], people: rows, priorities, daily, overdue, recent, comments, departments, dept: dq, tz });
  } catch (e) {
    console.error('stats failed:', e.message);
    return json(res, 500, { error: 'Server error.' });
  }
}
