// ── Supabase config (shared with the rest of the site) ────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// ── State ─────────────────────────────────────────────────────────────────────
let db = null;
let sheets = [];
let currentEmail = null;
let runPollTimer = null;

const $ = id => document.getElementById(id);
const setStatus = msg => { $('syncStatus').textContent = msg; };
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Auth ──────────────────────────────────────────────────────────────────────
function showApp() { $('loginOverlay').classList.add('hidden'); }
function showLogin(msg) {
  $('loginOverlay').classList.remove('hidden');
  const err = $('loginError');
  if (msg) { err.textContent = msg; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
}

$('loginBtn').addEventListener('click', async () => {
  const btn = $('loginBtn');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) { showLogin('Enter email and password.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { showLogin(error.message); return; }
  showApp();
  await boot();
});
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
$('signOutBtn').addEventListener('click', async () => { await db.auth.signOut(); showLogin(); });

async function initSupabase() {
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await db.auth.getSession();
    if (!session) { showLogin(); return false; }
    currentEmail = session.user?.email || null;
    showApp();
    return true;
  } catch (e) {
    setStatus('Supabase unavailable');
    return false;
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadSheets() {
  const { data, error } = await db
    .from('smartsheet_exports')
    .select('id, label, sheet_id, enabled, sort_order, destination');
  if (error) { setStatus('Load failed: ' + error.message); return; }
  sheets = data || [];
  // Alphabetical by filename; unlabeled (auto-titled) rows sink to the bottom.
  sheets.sort((a, b) => {
    if (!a.label !== !b.label) return a.label ? -1 : 1;
    return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' })
      || String(a.sheet_id).localeCompare(String(b.sheet_id));
  });
  render();
}

function render() {
  const tbody = $('sheetsTbody');
  if (!sheets.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No sheets yet. Add one above.</td></tr>';
  } else {
    tbody.innerHTML = sheets.map(s => `
      <tr data-id="${s.id}" class="${s.enabled ? '' : 'row-off'}">
        <td class="col-on">
          <label class="switch" title="${s.enabled ? 'Included in the daily pull' : 'Skipped'}">
            <input type="checkbox" class="toggle" ${s.enabled ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
        </td>
        <td class="cell-label">${s.label ? escHtml(s.label) : '<span class="auto">(auto from Smartsheet title)</span>'}</td>
        <td class="cell-id"><code>${escHtml(s.sheet_id)}</code></td>
        <td class="col-dest">
          <select class="dest form-select">
            <option value="current" ${s.destination !== 'reference' ? 'selected' : ''}>Current</option>
            <option value="reference" ${s.destination === 'reference' ? 'selected' : ''}>Reference</option>
          </select>
        </td>
        <td class="col-act"><button class="btn btn-danger-outline btn-tiny del">Remove</button></td>
      </tr>`).join('');
  }
  const enabled = sheets.filter(s => s.enabled).length;
  $('enabledCount').textContent = enabled;
  $('totalCount').textContent = sheets.length;
  renderMaster(enabled);
}

function renderMaster(enabled) {
  const total = sheets.length;
  const sw = $('masterSwitch');
  const cb = $('masterToggle');
  cb.disabled = total === 0;
  // Checked when every sheet is on; "partial" styling when some (but not all) are on.
  cb.checked = total > 0 && enabled === total;
  sw.classList.toggle('partial', enabled > 0 && enabled < total);
}

async function addSheet() {
  const btn = $('addBtn');
  const rawId = $('newSheetId').value.trim();
  const label = $('newLabel').value.trim();
  const destination = $('newDest').value;
  if (!/^\d{6,}$/.test(rawId)) {
    setStatus('Enter a valid numeric Smartsheet ID.');
    $('newSheetId').focus();
    return;
  }
  if (sheets.some(s => s.sheet_id === rawId)) {
    setStatus('That sheet ID is already in the list.');
    return;
  }
  btn.disabled = true; btn.textContent = 'Adding…';
  const maxOrder = sheets.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);
  const { error } = await db.from('smartsheet_exports').insert({
    sheet_id: rawId,
    label: label || null,
    enabled: true,
    sort_order: maxOrder + 10,
    destination,
  });
  btn.disabled = false; btn.textContent = 'Add Sheet';
  if (error) { setStatus('Add failed: ' + error.message); return; }
  $('newSheetId').value = '';
  $('newLabel').value = '';
  setStatus('Added — it joins the next 6pm pull.');
  await loadSheets();
}

async function toggleSheet(id, enabled) {
  const { error } = await db.from('smartsheet_exports').update({ enabled }).eq('id', id);
  if (error) { setStatus('Update failed: ' + error.message); await loadSheets(); return; }
  const s = sheets.find(x => x.id === id);
  if (s) s.enabled = enabled;
  render();
}

async function toggleAll(enabled) {
  if (!sheets.length) return;
  const ids = sheets.map(s => s.id);
  const { error } = await db.from('smartsheet_exports').update({ enabled }).in('id', ids);
  if (error) { setStatus('Update failed: ' + error.message); await loadSheets(); return; }
  sheets.forEach(s => { s.enabled = enabled; });
  setStatus(enabled
    ? 'All sheets on — every sheet joins the daily pull.'
    : 'All sheets off — the daily pull is paused for every sheet.');
  render();
}

async function changeDest(id, destination) {
  const { error } = await db.from('smartsheet_exports').update({ destination }).eq('id', id);
  if (error) { setStatus('Update failed: ' + error.message); await loadSheets(); return; }
  const s = sheets.find(x => x.id === id);
  if (s) s.destination = destination;
  setStatus(`Saved — now goes to ${destination === 'reference' ? 'Reference' : 'Current'}.`);
}

async function deleteSheet(id) {
  const s = sheets.find(x => x.id === id);
  const name = s?.label || s?.sheet_id || 'this sheet';
  if (!confirm(`Remove "${name}" from the daily export?`)) return;
  const { error } = await db.from('smartsheet_exports').delete().eq('id', id);
  if (error) { setStatus('Remove failed: ' + error.message); return; }
  setStatus('Removed.');
  await loadSheets();
}

// ── On-demand run ───────────────────────────────────────────────────────────────
// The "Run pull now" button queues a request row; the Mac-side poller claims it,
// runs the export, and writes status/message back, which we surface here.
const RUN_TABLE = 'smartsheet_sync_requests';
const fmtTime = ts => ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

function setRunStatus(msg, cls = '') {
  const el = $('runStatus');
  el.textContent = msg;
  el.className = 'run-status' + (cls ? ' ' + cls : '');
}

// Reflect one request row's state in the UI. Returns true once the row is terminal.
function applyRunState(row) {
  const btn = $('runNowBtn');
  if (!row) return false;
  if (row.status === 'pending') { setRunStatus('Queued — waiting for the runner…'); return false; }
  if (row.status === 'running') { setRunStatus('Running…'); return false; }
  if (row.status === 'done') {
    setRunStatus(`✓ Completed ${fmtTime(row.finished_at)}${row.message ? ' — ' + row.message : ''}`, 'ok');
    btn.disabled = false; btn.textContent = 'Run pull now';
    return true;
  }
  if (row.status === 'error') {
    setRunStatus(`⚠ ${row.message || 'Run failed'} (${fmtTime(row.finished_at)})`, 'err');
    btn.disabled = false; btn.textContent = 'Run pull now';
    return true;
  }
  return false;
}

function stopRunPoll() { if (runPollTimer) { clearInterval(runPollTimer); runPollTimer = null; } }

// Poll a queued request until it finishes (or we give up waiting on an offline runner).
function pollRun(id) {
  stopRunPoll();
  let ticks = 0;
  const MAX_TICKS = 60; // ~3 min at 3s
  runPollTimer = setInterval(async () => {
    ticks++;
    const { data, error } = await db.from(RUN_TABLE)
      .select('status, message, finished_at').eq('id', id).single();
    if (error) return; // transient — try again next tick
    if (applyRunState(data)) { stopRunPoll(); return; }
    if (ticks >= MAX_TICKS) {
      stopRunPoll();
      setRunStatus('Still queued — the runner may be offline. It will pick this up when it next runs.', 'err');
      $('runNowBtn').disabled = false; $('runNowBtn').textContent = 'Run pull now';
    }
  }, 3000);
}

async function requestRun() {
  const btn = $('runNowBtn');
  btn.disabled = true; btn.textContent = 'Requesting…';
  setRunStatus('Requesting…');

  // Don't stack duplicates — if a run is already outstanding, just watch it.
  const { data: outstanding } = await db.from(RUN_TABLE)
    .select('id, status').in('status', ['pending', 'running'])
    .order('requested_at', { ascending: false }).limit(1);
  if (outstanding && outstanding.length) {
    setRunStatus('A run is already queued — watching it…');
    pollRun(outstanding[0].id);
    return;
  }

  const { data, error } = await db.from(RUN_TABLE)
    .insert({ status: 'pending', requested_by: currentEmail })
    .select('id').single();
  if (error) {
    setRunStatus('Could not queue the run: ' + error.message, 'err');
    btn.disabled = false; btn.textContent = 'Run pull now';
    return;
  }
  setRunStatus('Queued — waiting for the runner…');
  pollRun(data.id);
}

// On load, show the most recent request's outcome (and resume watching if active).
async function loadLastRun() {
  const { data } = await db.from(RUN_TABLE)
    .select('id, status, message, requested_at, finished_at')
    .order('requested_at', { ascending: false }).limit(1);
  if (!data || !data.length) return;
  const row = data[0];
  if (row.status === 'pending' || row.status === 'running') {
    $('runNowBtn').disabled = true; $('runNowBtn').textContent = 'Requesting…';
    applyRunState(row);
    pollRun(row.id);
  } else if (row.status === 'done') {
    setRunStatus(`Last run: ✓ ${fmtTime(row.finished_at)}${row.message ? ' — ' + row.message : ''}`, 'ok');
  } else if (row.status === 'error') {
    setRunStatus(`Last run: ⚠ ${row.message || 'failed'} (${fmtTime(row.finished_at)})`, 'err');
  }
}

// ── Events ─────────────────────────────────────────────────────────────────────
$('addBtn').addEventListener('click', addSheet);
$('runNowBtn').addEventListener('click', requestRun);
$('masterToggle').addEventListener('change', e => toggleAll(e.target.checked));
$('newSheetId').addEventListener('keydown', e => { if (e.key === 'Enter') addSheet(); });
$('newLabel').addEventListener('keydown', e => { if (e.key === 'Enter') addSheet(); });
$('sheetsTbody').addEventListener('click', e => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.classList.contains('del')) deleteSheet(id);
});
$('sheetsTbody').addEventListener('change', e => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  if (e.target.classList.contains('toggle')) toggleSheet(row.dataset.id, e.target.checked);
  else if (e.target.classList.contains('dest')) changeDest(row.dataset.id, e.target.value);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  await loadSheets();
  await loadLastRun();
}

(async () => {
  const ok = await initSupabase();
  if (ok) await boot();
})();
