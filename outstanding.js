// ── Supabase config (shared with the rest of the site) ────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// How many past refreshes the history picker offers.
const HISTORY_LIMIT = 30;

// ── State ─────────────────────────────────────────────────────────────────────
let db = null;
let reports = [];   // [{ id, report_date, updated_at }] newest first

const $ = id => document.getElementById(id);
const setStatus = msg => { $('syncStatus').textContent = msg; };

const todayISO = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
    .from('outstanding_reports')
    .select('id, report_date, updated_at')
    .order('report_date', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) { setStatus('Load failed: ' + error.message); return false; }
  reports = data || [];
  return true;
}

async function loadReport(id) {
  const { data, error } = await db
    .from('outstanding_reports')
    .select('report_date, html, updated_at')
    .eq('id', id)
    .single();
  if (error) { setStatus('Load failed: ' + error.message); return null; }
  return data;
}

// The stored dashboard uses `minmax(440px, 1fr)` grid columns + 24px body
// padding, which overflow a phone. It renders in a sandboxed iframe, so we
// inject a small mobile-only guard into the HTML before showing it — collapsing
// the grid to one column and letting long code/paths wrap. Desktop is untouched.
const REPORT_FIT_GUARD = `<style>
@media (max-width: 700px){
  body{padding:14px!important}
  .wrap{max-width:100%!important}
  .grid{grid-template-columns:minmax(0,1fr)!important}
  code,pre{overflow-wrap:anywhere;white-space:pre-wrap}
  img,table{max-width:100%!important}
}
</style>`;

function fitReportHtml(html) {
  if (typeof html !== 'string') return html;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, REPORT_FIT_GUARD + '</head>')
    : REPORT_FIT_GUARD + html;
}

// ── Render ────────────────────────────────────────────────────────────────────
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
  // The stored document is static HTML written by the daily refresh.
  // sandbox="" keeps it inert regardless — no scripts, no navigation, no same-origin.
  frame.srcdoc = fitReportHtml(row.html);

  const age = daysAgo(row.report_date);
  const label = $('reportDate');
  label.textContent = age === 0
    ? `Refreshed today — ${prettyDate(row.report_date)}`
    : `From ${prettyDate(row.report_date)} — ${age} day${age === 1 ? '' : 's'} old`;
  label.classList.toggle('stale', age >= 2);

  setStatus(age === 0
    ? 'Everything still open across Steve’s builds — refreshed daily at 6:45am'
    : `Last refresh was ${prettyDate(row.report_date)} — the 6:45am job may not have run`);
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
