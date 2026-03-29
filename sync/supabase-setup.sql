-- ============================================================
-- Work Clip Sync — Supabase Setup
-- Run this in your Supabase project's SQL Editor
-- (supabase.com → your project → SQL Editor → New query)
-- ============================================================

-- 1. Projects table
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,          -- Display name: "Alpha Project"
  folder_name text not null,          -- Exact folder name on disk: "alpha-project"
  created_at  timestamptz default now()
);

-- 2. Clips table
create table if not exists clips (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text,
  clip_type   text not null check (clip_type in ('slack', 'email', 'note')),
  project_id  uuid references projects(id) on delete set null,
  file_paths  text[] default '{}',    -- Supabase Storage paths: {clip_id}/{filename}
  synced      boolean default false,
  created_at  timestamptz default now()
);

-- Index for fast unsynced polling (used by sync.js)
create index if not exists clips_synced_idx on clips(synced) where synced = false;

-- ============================================================
-- 3. Storage bucket
-- Run this separately in the Supabase dashboard:
--   Storage → New bucket → Name: "clip-attachments" → Private
--
-- Or via SQL (requires pg_net / storage schema access):
-- insert into storage.buckets (id, name, public)
-- values ('clip-attachments', 'clip-attachments', false)
-- on conflict do nothing;
-- ============================================================

-- 4. RLS Policies (enable Row Level Security then allow anon key full access)
alter table projects enable row level security;
alter table clips     enable row level security;

-- Allow all operations with the anon/publishable key (no auth needed for this tool)
create policy "anon full access on projects"
  on projects for all
  using (true)
  with check (true);

create policy "anon full access on clips"
  on clips for all
  using (true)
  with check (true);

-- Storage policy: allow anon key to upload/download from clip-attachments
-- (Set this in Dashboard → Storage → clip-attachments → Policies)
-- Policy name: "anon full access"
-- Allowed operations: SELECT, INSERT, UPDATE, DELETE
-- Target roles: anon
-- USING expression: true
-- WITH CHECK expression: true
