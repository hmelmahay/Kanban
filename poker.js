// ── Supabase config (shared with the rest of the site) ────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// How many past refreshes the history picker offers.
const HISTORY_LIMIT = 30;

// Weekly cadence: the through-date is normally ≤7 days old. Flag it stale once
// a second Friday run should have replaced it.
const STALE_DAYS = 9;

// ── State ─────────────────────────────────────────────────────────────────────
let db = null;
let reports = [];   // [{ id, report_date, updated_at }] newest first

const $ = id => document.getElementById(id);
const setStatus = msg => { $('syncStatus').textContent = msg; };

const prettyDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
};

const daysAgo = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / 86400000);
};

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

$('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('loginBtn').click();
});

$('signOutBtn').addEventListener('click', async () => { await db.auth.signOut(); showLogin(); });

async function initSupabase() {
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await db.auth.getSession();
    if (!session) { showLogin(); return false; }
    showApp();
    return true;
  } catch (e) {
    setStatus('Supabase unavailable');
    return false;
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadIndex() {
  const { data, error } = await db
    .from('poker_reports')
    .select('id, report_date, updated_at')
    .order('report_date', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) { setStatus('Load failed: ' + error.message); return false; }
  reports = data || [];
  return true;
}

async function loadReport(id) {
  const { data, error } = await db
    .from('poker_reports')
    .select('report_date, html, updated_at')
    .eq('id', id)
    .single();
  if (error) { setStatus('Load failed: ' + error.message); return null; }
  return data;
}

// ── Render ────────────────────────────────────────────────────────────────────
// The dashboard's tables are ~10 columns wide; on a phone they'd push the whole
// iframe document sideways. Injected before render so tables scroll in place.
const MOBILE_GUARD = `<style>
@media (max-width: 700px) {
  .wrap { padding: 18px 12px 60px; }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; white-space: nowrap; }
}
</style>`;

const withMobileGuard = html =>
  html.includes('</head>') ? html.replace('</head>', MOBILE_GUARD + '</head>') : MOBILE_GUARD + html;

function renderHistoryPicker(selectedId) {
  const sel = $('historyPicker');
  sel.innerHTML = '';
  reports.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    const age = daysAgo(r.report_date);
    const label = age === 0 ? 'Today' : age === 1 ? 'Yesterday' : `${age} days ago`;
    opt.textContent = `${prettyDate(r.report_date)} — ${label}`;
    if (String(r.id) === String(selectedId)) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.style.display = reports.length > 1 ? '' : 'none';
}

function renderReport(row) {
  const frame = $('reportFrame');
  const empty = $('reportEmpty');

  if (!row) {
    frame.removeAttribute('srcdoc');
    frame.style.display = 'none';
    empty.classList.remove('hidden');
    $('reportDate').textContent = 'Nothing posted yet';
    setStatus('No dashboard posted yet');
    return;
  }

  empty.classList.add('hidden');
  frame.style.display = '';
  // The stored document is static HTML written by the weekly engine run.
  // allow-scripts (still no same-origin, no navigation) keeps the dashboard's
  // Roast-mode toggle working while the document stays isolated.
  frame.srcdoc = withMobileGuard(row.html);

  const age = daysAgo(row.report_date);
  const label = $('reportDate');
  label.textContent = age === 0
    ? `Data through today — ${prettyDate(row.report_date)}`
    : `Data through ${prettyDate(row.report_date)} — ${age} day${age === 1 ? '' : 's'} ago`;
  label.classList.toggle('stale', age >= STALE_DAYS);

  setStatus(age < STALE_DAYS
    ? 'PokerNow player dashboard — refreshed Fridays at 3am'
    : `Last refresh covered ${prettyDate(row.report_date)} — the Friday 3am job may not have run`);
}

// ── Events ────────────────────────────────────────────────────────────────────
$('historyPicker').addEventListener('change', async e => {
  const row = await loadReport(e.target.value);
  renderReport(row);
});

$('refreshBtn').addEventListener('click', async () => {
  const btn = $('refreshBtn');
  btn.disabled = true; btn.textContent = 'Reloading…';
  await boot();
  btn.disabled = false; btn.textContent = 'Reload';
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  if (!await loadIndex()) return;
  if (!reports.length) { renderHistoryPicker(null); renderReport(null); return; }
  const latest = reports[0];
  renderHistoryPicker(latest.id);
  const row = await loadReport(latest.id);
  renderReport(row);
}

(async () => {
  if (await initSupabase()) await boot();
})();
