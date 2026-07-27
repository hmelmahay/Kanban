-- ============================================================
-- Smartsheet Export — On-Demand Run Queue
-- (already applied to the live project via migration
--  create_smartsheet_sync_requests; kept here for reference)
-- ============================================================

-- The "Run pull now" button on the Sheets page inserts a 'pending' row.
-- The Mac-side poller (smartsheet-run-poller.js) claims it, runs the export,
-- and writes back status + message, which the web UI then displays.
create table if not exists public.smartsheet_sync_requests (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'pending'
                 check (status in ('pending','running','done','error')),
  requested_by text,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  message      text
);

create index if not exists smartsheet_sync_requests_pending_idx
  on public.smartsheet_sync_requests (requested_at)
  where status = 'pending';

alter table public.smartsheet_sync_requests enable row level security;

-- Full access for authenticated users (mirrors smartsheet_exports).
-- The Mac poller uses the service-role key, which bypasses RLS.
create policy "authed all smartsheet_sync_requests"
  on public.smartsheet_sync_requests for all
  to authenticated
  using (true)
  with check (true);
