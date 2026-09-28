// ── Supabase config ───────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// Allotments
const QUOTA = { pto: 20, flex: 8, float: 3 };

// Office attendance: an average of 3.5 office days a week, over each month and over each quarter,
// in effect from Sep 28, 2026. It covers every month and quarter still open then (so September
// and Q3 2026 count); months that ended earlier fell under the old 33/quarter minimum.
// Days off shrink the target.
const WEEKLY_TARGET = 3.5;
const WEEKLY_RULE_START = new Date(2026, 8, 28);
const EXCUSED = new Set(['pto', 'flex', 'float', 'holiday', 'off']);

// ── State ────────────────────────────────────────────────────────────────────
let db = null;
let days = {};          // { 'YYYY-MM-DD': {type, notes} }
let viewY, viewM;       // calendar view year/month (0-indexed month)
let editingDate = null;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const setStatus = msg => { $('syncStatus').textContent = msg; };

// ── Auth ─────────────────────────────────────────────────────────────────────
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
    showApp();
    return true;
  } catch (e) {
    setStatus('Supabase unavailable');
    return false;
  }
}

// ── Data ─────────────────────────────────────────────────────────────────────
async function loadDays() {
  const { data, error } = await db.from('badge_days').select('day, type, notes').order('day');
  if (error) { setStatus('Load error: ' + error.message); return; }
  days = {};
  for (const r of data) days[r.day] = { type: r.type, notes: r.notes };
  setStatus(`Synced ${data.length} days`);
}

async function autofillFridays() {
  // Fill every Friday from 2025-01-01 through today (+90 days lookahead) with 'not_swipe' if no entry exists.
  const start = new Date(2025, 0, 1);
  const end = new Date();
  end.setDate(end.getDate() + 90);
  const rows = [];
  const d = new Date(start);
  while (d <= end) {
    if (d.getDay() === 5) {
      const iso = isoDate(d);
      if (!days[iso]) rows.push({ day: iso, type: 'not_swipe', notes: null });
    }
    d.setDate(d.getDate() + 1);
  }
  if (!rows.length) return;
  const { error } = await db.from('badge_days').upsert(rows, { onConflict: 'day', ignoreDuplicates: true });
  if (error) { console.warn('Friday autofill failed:', error.message); return; }
  for (const r of rows) days[r.day] = { type: r.type, notes: r.notes };
  setStatus(`Synced ${Object.keys(days).length} days (autofilled ${rows.length} Fridays)`);
}

async function upsertDay(date, type, notes) {
  if (!type) {
    const { error } = await db.from('badge_days').delete().eq('day', date);
    if (error) { alert('Delete failed: ' + error.message); return; }
    delete days[date];
  } else {
    const { error } = await db.from('badge_days').upsert({ day: date, type, notes: notes || null });
    if (error) { alert('Save failed: ' + error.message); return; }
    days[date] = { type, notes: notes || null };
  }
  render();
}

// ── Period helpers ───────────────────────────────────────────────────────────
function quarterOf(date) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return { q, year: date.getFullYear() };
}
function quarterRange(year, q) {
  const start = new Date(year, (q - 1) * 3, 1);
  const end = new Date(year, q * 3, 0);
  return { start, end };
}
function flexYearOf(date) {
  // Flex year runs Feb 20 through Feb 19
  const y = date.getFullYear();
  const cutoff = new Date(y, 1, 20); // Feb 20 of this year
  const startYear = date < cutoff ? y - 1 : y;
  return {
    startYear,
    start: new Date(startYear, 1, 20),
    end: new Date(startYear + 1, 1, 19),
    label: `${startYear}→${startYear + 1}`
  };
}

function countInRange(type, start, end) {
  let n = 0;
  for (const [d, rec] of Object.entries(days)) {
    if (rec.type !== type) continue;
    const dd = parseISO(d);
    if (dd >= start && dd <= end) n++;
  }
  return n;
}

// Office attendance in [start, end]. Workdays are weekdays that aren't days off; under the weekly
// rule the target is 3.5 office days per 5 workdays. `left` counts today (unless already badged)
// and later workdays; the pace so far leaves today out until you badge in.
function periodStats(start, end) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = { swipes: 0, workdays: 0, left: 0, weekly: end >= WEEKLY_RULE_START };
  let swipesSoFar = 0, workdaysSoFar = 0;
  const d = new Date(start);
  while (d <= end) {
    const rec = days[isoDate(d)];
    const swiped = !!rec && rec.type === 'swipe';
    const past = d < today, isToday = +d === +today;
    if (swiped) { s.swipes++; if (past || isToday) swipesSoFar++; }
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !(rec && EXCUSED.has(rec.type))) {
      s.workdays++;
      if (past || (isToday && swiped)) workdaysSoFar++;
      else s.left++;
    }
    d.setDate(d.getDate() + 1);
  }
  s.required = s.weekly ? Math.ceil(WEEKLY_TARGET * s.workdays / 5 - 1e-9) : null;
  s.pace = workdaysSoFar ? swipesSoFar / workdaysSoFar * 5 : null;
  return s;
}

// Rounds down so 3.46 shows as 3.4, never as a 3.5 that still misses the target.
const fmtAvg = v => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "X / N" tile: days still needed, workdays left, bar, and color. Warn when behind the pace
// that finishes on target, bad when the target is out of reach.
function renderTarget(tile, bar, sub, s, period) {
  const needed = Math.max(0, s.required - s.swipes);
  const left = `${plural(s.left, 'workday')} left`;
  sub.textContent = needed === 0 ? `Target met. ${left} in ${period}.` : `${needed} more needed · ${left}`;
  bar.style.width = (s.required ? Math.min(100, s.swipes / s.required * 100) : 100) + '%';
  tile.classList.remove('ok', 'warn', 'bad');
  if (needed === 0) tile.classList.add('ok');
  else if (needed > s.left) tile.classList.add('bad');
  else if (needed > s.left * WEEKLY_TARGET / 5) tile.classList.add('warn');
}

// Avg/week tile: pace so far against the weekly target.
function renderPace(tile, valueEl, subEl, s) {
  valueEl.textContent = s.pace == null ? '—' : fmtAvg(s.pace);
  subEl.textContent = `so far · target ≥ ${WEEKLY_TARGET}`;
  tile.classList.remove('ok', 'bad');
  if (s.pace != null) tile.classList.add(s.pace >= WEEKLY_TARGET ? 'ok' : 'bad');
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  renderHero();
  renderTiles();
  renderCalendar();
  renderRecent();
}

function renderHero() {
  const today = new Date();
  $('heroDate').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const todayISO = isoDate(today);
  const rec = days[todayISO];
  const btn = $('swipeInBtn');
  if (rec && rec.type === 'swipe') {
    $('heroStatus').textContent = '✅ Badged in today';
    btn.textContent = 'Undo badge-in';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline');
  } else if (rec) {
    $('heroStatus').textContent = `Today logged as: ${labelOf(rec.type)}`;
    btn.textContent = 'Badge In Today';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-outline');
  } else {
    $('heroStatus').textContent = 'Nothing logged yet for today.';
    btn.textContent = 'Badge In Today';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-outline');
  }
}

function labelOf(t) {
  return { swipe: 'Swipe', not_swipe: 'No swipe', pto: 'PTO', flex: 'Flex', float: 'Float', holiday: 'Holiday', off: 'Off' }[t] || t;
}

function renderTiles() {
  const today = new Date();
  // Quarter: office days against its target, and pace so far
  const { q, year } = quarterOf(today);
  const { start, end } = quarterRange(year, q);
  const qs = periodStats(start, end);
  $('qLabel').textContent = `Q${q} ${year}`;
  $('qCount').textContent = qs.swipes;
  $('qTarget').textContent = qs.required;
  renderTarget($('tileQuarter'), $('qBar'), $('qSub'), qs, 'quarter');
  renderPace($('tileQuarterAvg'), $('qAvg'), $('qAvgSub'), qs);

  // Month: same
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const ms = periodStats(mStart, mEnd);
  $('mLabel').textContent = mStart.toLocaleDateString(undefined, { month: 'long' });
  $('mCount').textContent = ms.swipes;
  $('mTarget').textContent = ms.required;
  renderTarget($('tileMonth'), $('mBar'), $('mSub'), ms, 'month');
  renderPace($('tileMonthAvg'), $('mAvg'), $('mAvgSub'), ms);

  // PTO (calendar year)
  const yStart = new Date(today.getFullYear(), 0, 1);
  const yEnd = new Date(today.getFullYear(), 11, 31);
  $('ptoYear').textContent = today.getFullYear();
  const ptoUsed = countInRange('pto', yStart, yEnd);
  $('ptoUsed').textContent = ptoUsed;
  $('ptoSub').textContent = `${QUOTA.pto - ptoUsed} days remaining`;

  // Flex (Feb 20 - Feb 19)
  const fy = flexYearOf(today);
  const flexUsed = countInRange('flex', fy.start, fy.end);
  $('flexUsed').textContent = flexUsed;
  $('flexSub').textContent = `${fy.label} · ${QUOTA.flex - flexUsed} left`;

  // Float (calendar year)
  $('floatYear').textContent = today.getFullYear();
  const floatUsed = countInRange('float', yStart, yEnd);
  $('floatUsed').textContent = floatUsed;
  $('floatSub').textContent = `${QUOTA.float - floatUsed} days remaining`;
}

function renderCalendar() {
  const grid = $('calGrid');
  grid.innerHTML = '';
  const first = new Date(viewY, viewM, 1);
  const last = new Date(viewY, viewM + 1, 0);
  $('calTitle').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  renderMonthStatus(first, last);

  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  for (let i = 0; i < first.getDay(); i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell blank';
    grid.appendChild(el);
  }

  const todayISO = isoDate(new Date());
  for (let day = 1; day <= last.getDate(); day++) {
    const d = new Date(viewY, viewM, day);
    const iso = isoDate(d);
    const rec = days[iso];
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (rec) cell.classList.add('t-' + rec.type);
    if (iso === todayISO) cell.classList.add('today');
    if (d.getDay() === 0 || d.getDay() === 6) cell.classList.add('weekend');
    cell.innerHTML = `<div class="cal-daynum">${day}</div>` + (rec ? `<div class="cal-tag">${labelOf(rec.type)}</div>` : '');
    if (rec && rec.notes) {
      const n = document.createElement('div');
      n.className = 'cal-note';
      n.textContent = '📝';
      n.title = rec.notes;
      cell.appendChild(n);
    }
    cell.addEventListener('click', () => openDayModal(iso));
    grid.appendChild(cell);
  }
}

// One-line result for the month shown in the calendar.
function renderMonthStatus(first, last) {
  const el = $('calStatus');
  const s = periodStats(first, last);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  el.classList.remove('ok', 'bad');
  if (first > today) {
    el.textContent = s.weekly ? `${plural(s.required, 'office day')} needed · ${plural(s.workdays, 'workday')} after days off` : '';
    return;
  }
  const done = last < today;
  const avg = done ? (s.workdays ? s.swipes / s.workdays * 5 : null) : s.pace;
  const avgTxt = avg == null ? '' : ` · ${fmtAvg(avg)}/week${done ? '' : ' so far'}`;
  if (!s.weekly) {
    el.textContent = `${plural(s.swipes, 'office day')}${avgTxt} · before the ${WEEKLY_TARGET}/week rule`;
    return;
  }
  const needed = Math.max(0, s.required - s.swipes);
  el.textContent = `${s.swipes} of ${plural(s.required, 'office day')}${avgTxt} · `
    + (needed === 0 ? 'target met' : done ? 'missed' : `${needed} more needed`);
  if (needed === 0) el.classList.add('ok');
  else if (done || needed > s.left) el.classList.add('bad');
}

function renderRecent() {
  const list = $('recentList');
  const entries = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);
  if (!entries.length) { list.textContent = 'No entries yet.'; return; }
  list.innerHTML = '';
  for (const [d, rec] of entries) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = `<div>${d}</div><div><span class="recent-type t-${rec.type}">${labelOf(rec.type)}</span></div><div>${rec.notes ? rec.notes.replace(/</g, '&lt;') : ''}</div>`;
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openDayModal(d));
    list.appendChild(row);
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────
function openDayModal(iso) {
  editingDate = iso;
  const d = parseISO(iso);
  $('dayModalTitle').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const rec = days[iso];
  $('dayType').value = rec ? rec.type : '';
  $('dayNotes').value = rec && rec.notes ? rec.notes : '';
  $('dayModal').classList.remove('hidden');
}
$('dayCancelBtn').addEventListener('click', () => $('dayModal').classList.add('hidden'));
$('daySaveBtn').addEventListener('click', async () => {
  const t = $('dayType').value;
  const notes = $('dayNotes').value.trim();
  await upsertDay(editingDate, t, notes);
  $('dayModal').classList.add('hidden');
});

// ── Actions ──────────────────────────────────────────────────────────────────
$('swipeInBtn').addEventListener('click', async () => {
  const todayISO = isoDate(new Date());
  const rec = days[todayISO];
  if (rec && rec.type === 'swipe') {
    await upsertDay(todayISO, null);
  } else {
    await upsertDay(todayISO, 'swipe', null);
  }
});
$('markTodayBtn').addEventListener('click', () => openDayModal(isoDate(new Date())));
$('calPrev').addEventListener('click', () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderCalendar(); });
$('calNext').addEventListener('click', () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderCalendar(); });

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const today = new Date();
  viewY = today.getFullYear();
  viewM = today.getMonth();
  await loadDays();
  await autofillFridays();
  render();
}

(async () => {
  const ok = await initSupabase();
  if (ok) await boot();
})();
