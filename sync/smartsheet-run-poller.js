#!/usr/bin/env node
/**
 * Smartsheet Export — On-Demand Runner
 *
 * Polls Supabase table `smartsheet_sync_requests` for a queued run (created by
 * the "Run pull now" button on the Sheets page), claims it, runs the Smartsheet
 * export command, and writes the result back so the web UI can show it.
 *
 * ── Wiring it to your export ────────────────────────────────────────────────
 * Set the command that performs the 6pm pull via the SMARTSHEET_EXPORT_CMD env
 * var (or edit RUN_COMMAND below). Example:
 *   SMARTSHEET_EXPORT_CMD="/usr/local/bin/node /Users/steve/workpm/smartsheet-export.js"
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 * Single pass (default): checks once and exits. Schedule via launchd
 *   StartInterval (e.g. every 60s), the same way the clip sync is scheduled, so
 *   a queued request is picked up within ~a minute.
 * Watch mode: `node smartsheet-run-poller.js --watch` loops every POLL_INTERVAL_MS
 *   (~20s) in a single long-lived process.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
// Service-role key (bypasses RLS), read from the same file the clip sync uses.
const SUPABASE_KEY = fs.readFileSync('/Users/steve/.config/worksync/service_key', 'utf8').trim();

// The command that performs the Smartsheet export — the same one the 6pm job runs.
const RUN_COMMAND = process.env.SMARTSHEET_EXPORT_CMD
  || 'echo "SMARTSHEET_EXPORT_CMD is not set — nothing to run"';

const POLL_INTERVAL_MS = 20000;
const TABLE = 'smartsheet_sync_requests';

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// Claim and run the oldest pending request, if any. Returns true if one ran.
async function processOne(db) {
  const { data: pending, error: selErr } = await db
    .from(TABLE)
    .select('id')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(1);
  if (selErr) { log('ERROR selecting: ' + selErr.message); return false; }
  if (!pending || !pending.length) return false;

  const id = pending[0].id;

  // Atomic claim: only transition if still pending (guards against a double-run).
  const { data: claimed, error: claimErr } = await db
    .from(TABLE)
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending')
    .select('id');
  if (claimErr) { log('ERROR claiming: ' + claimErr.message); return false; }
  if (!claimed || !claimed.length) return false; // already claimed elsewhere

  log(`Claimed request ${id} — running export…`);
  try {
    const out = execSync(RUN_COMMAND, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = (out.trim().split('\n').pop() || 'Export finished.').slice(0, 300);
    await db.from(TABLE)
      .update({ status: 'done', finished_at: new Date().toISOString(), message: tail })
      .eq('id', id);
    log(`Request ${id} done.`);
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || 'Export failed')
      .toString().trim().slice(-300);
    await db.from(TABLE)
      .update({ status: 'error', finished_at: new Date().toISOString(), message: msg })
      .eq('id', id);
    log(`Request ${id} errored: ${msg}`);
  }
  return true;
}

async function main() {
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!process.argv.includes('--watch')) { await processOne(db); return; }
  log(`Watch mode — polling every ${POLL_INTERVAL_MS / 1000}s`);
  for (;;) {
    try { await processOne(db); } catch (e) { log('Loop error: ' + e.message); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch(err => { log('FATAL: ' + err.message); process.exit(1); });
