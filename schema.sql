create table if not exists users (
  id serial primary key,
  name text not null,
  email text not null unique,
  phone text not null default '',
  role text not null default 'member' check (role in ('admin','member')),
  password_hash text,
  invite_hash text,
  invite_expires timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists users_invite_idx on users(invite_hash);

create table if not exists tasks (
  id serial primary key,
  text text not null,
  priority text not null default 'med' check (priority in ('high','med','low')),
  due date,
  done boolean not null default false,
  assignee_id integer references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on tasks(assignee_id);
