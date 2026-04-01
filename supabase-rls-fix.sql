-- ============================================================
-- RLS Fix — Kanban boards & tasks tables
-- Run this in your Supabase project's SQL Editor
-- (supabase.com → your project → SQL Editor → New query)
-- ============================================================

-- Enable Row Level Security on the boards and tasks tables
alter table boards enable row level security;
alter table tasks  enable row level security;

-- Allow all operations with the anon/publishable key (no auth needed for this tool)
create policy "anon full access on boards"
  on boards for all
  using (true)
  with check (true);

create policy "anon full access on tasks"
  on tasks for all
  using (true)
  with check (true);
