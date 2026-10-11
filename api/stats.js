// Admin-only numbers for the dashboard page.
import { sql, json, guard } from '../lib/common.js';

const tzOk = (tz) => { try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch (e) { return false; } };

export default async function handler(req, res) {
  const me = await guard(req, res, { admin: true });
  if (!me) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const tz = process.env.APP_TIMEZONE && tzOk(process.env.APP_TIMEZONE) ? process.env.APP_TIMEZONE : 'UTC';
  try {
    const [totals, people, unassigned, priorities, days, overdue, recent, comments] = await Promise.all([
      sql`select count(*)::int as total,
                 count(*) filter (where done)::int as done,
                 count(*) filter (where not done)::int as open,
                 count(*) filter (where not done and progress > 0)::int as started,
                 count(*) filter (where not done and due < current_date)::int as overdue
          from tasks`,
      sql`select u.id, u.name,
                 count(t.id)::int as assigned,
                 (count(t.id) filter (where t.done))::int as done,
                 (count(t.id) filter (where not t.done and t.due < current_date))::int as overdue
          from users u left join tasks t on t.assignee_id = u.id
          group by u.id, u.name, u.role
          having u.role = 'member' or count(t.id) > 0
          order by u.name`,
      sql`select count(*)::int as assigned,
                 (count(*) filter (where done))::int as done,
                 (count(*) filter (where not done and due < current_date))::int as overdue
          from tasks where assignee_id is null`,
      sql`select priority, count(*)::int as total, (count(*) filter (where done))::int as done
          from tasks group by priority`,
      // A task's completion time is when its photo was uploaded.
      sql`select to_char(p.uploaded_at at time zone ${tz}, 'YYYY-MM-DD') as day, count(*)::int as n
          from task_photos p join tasks t on t.id = p.task_id
          where t.done and p.uploaded_at > now() - interval '16 days'
          group by 1`,
      sql`select t.id, t.text, t.priority, to_char(t.due,'YYYY-MM-DD') as due, u.name as assignee_name
          from tasks t left join users u on u.id = t.assignee_id
          where not t.done and t.due < current_date
          order by t.due, t.id limit 10`,
      sql`select t.id, t.text, u.name as assignee_name, p.uploaded_at as done_at
          from task_photos p join tasks t on t.id = p.task_id left join users u on u.id = t.assignee_id
          where t.done order by p.uploaded_at desc limit 10`,
      sql`select c.body, c.created_at, t.text as task_text, u.name as author_name
          from task_comments c join tasks t on t.id = c.task_id left join users u on u.id = c.author_id
          order by c.created_at desc limit 8`,
    ]);

    const byDay = Object.fromEntries(days.map((d) => [d.day, d.n]));
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
      daily.push({ day, n: byDay[day] || 0 });
    }
    const rows = people.slice();
    if (unassigned[0] && unassigned[0].assigned > 0) rows.push({ id: null, name: 'Unassigned', ...unassigned[0] });

    return json(res, 200, { totals: totals[0], people: rows, priorities, daily, overdue, recent, comments, tz });
  } catch (e) {
    console.error('stats failed:', e.message);
    return json(res, 500, { error: 'Server error.' });
  }
}
