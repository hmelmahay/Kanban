// Badge Tracker: office days against a weekly-average target, plus PTO / Flex / Float usage.
// Shared by the site page, where badges-supabase.js keeps entries in Supabase, and by the
// shareable single-file copy (badge-tracker-standalone/), where local-storage.js keeps them in
// the browser. Either one calls startTracker(storage) with { load, save }.

// Office attendance: an average of settings.weekly office days a week (3.5 unless changed on
// screen), over each month and over each quarter, in effect from Sep 28, 2026. It covers every
// month and quarter still open then (so September and Q3 2026 count); months that ended earlier
// fell under the old 33/quarter minimum. Days off shrink the target.
const WEEKLY_RULE_START = new Date(2026, 8, 28);
const EXCUSED = new Set(['pto', 'flex', 'float', 'holiday', 'off']);

// Weekly target and yearly allotments, set on screen and kept in this browser. `carry` is PTO
// carried over from the year before, in hours as the badge report gives it; the PTO tile adds it
// to the yearly allotment at HOURS_PER_DAY hours a day.
const SETTINGS_KEY = 'badge_settings_v1';
const DEFAULT_SETTINGS = { weekly: 3.5, pto: 20, flex: 8, float: 3, carry: 0 };
const SETTING_FIELDS = {   // setting: [input id, min, max]
  weekly: ['setWeekly', 0.5, 5],
  pto: ['setPto', 0, 365],
  flex: ['setFlex', 0, 365],
  float: ['setFloat', 0, 365],
  carry: ['setCarry', 0, 2000]
};
const HOURS_PER_DAY = 8;

const DAY_LABELS = { swipe: 'Swipe', not_swipe: 'No swipe', pto: 'PTO', flex: 'Flex', float: 'Float', holiday: 'Holiday', off: 'Off' };

// ── State ────────────────────────────────────────────────────────────────────
let storage = null;     // { load, save } handed to startTracker
let settings = loadSettings();
let days = {};          // { 'YYYY-MM-DD': {type, notes} }
let viewY, viewM;       // calendar view year/month (0-indexed month)
let editingDate = null;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const setStatus = msg => { $('syncStatus').textContent = msg; };

// ── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { /* storage unavailable */ }
  const s = { ...DEFAULT_SETTINGS };
  for (const [k, [, min, max]] of Object.entries(SETTING_FIELDS)) {
    if (Number.isFinite(saved[k]) && saved[k] >= min && saved[k] <= max) s[k] = saved[k];
  }
  return s;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
}
// Lets the site script change a default before entries load, e.g. this year's PTO carryover.
// A value saved from the screen still wins.
function setDefaults(overrides) {
  Object.assign(DEFAULT_SETTINGS, overrides);
  settings = loadSettings();
}
function renderSettings() {
  for (const [k, [id]] of Object.entries(SETTING_FIELDS)) $(id).value = settings[k];
}
for (const [k, [id, min, max]] of Object.entries(SETTING_FIELDS)) {
  $(id).addEventListener('change', () => {
    const v = parseFloat($(id).value);
    if (Number.isFinite(v) && v >= min && v <= max) {
      settings[k] = Math.round(v * 100) / 100;
      saveSettings();
    }
    if (storage) render();   // also puts back the saved value after an out-of-range entry
    else renderSettings();
  });
}

// ── Data ─────────────────────────────────────────────────────────────────────
// Called by the storage script once entries can be read (on the site, after sign-in).
async function startTracker(s) {
  storage = s;
  const today = new Date();
  viewY = today.getFullYear();
  viewM = today.getMonth();
  days = await storage.load();
  render();
}

async function upsertDay(date, type, notes) {
  notes = notes || null;
  if (!(await storage.save(date, type, notes))) return;
  if (type) days[date] = { type, notes };
  else delete days[date];
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
// rule the target is settings.weekly office days per 5 workdays. `left` counts today (unless
// already badged) and later workdays. The pace so far leaves today out until you badge in:
// `pace` leaves days off out, `rawPace` counts them as missed.
function periodStats(start, end) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const s = { swipes: 0, workdays: 0, left: 0, weekly: end >= WEEKLY_RULE_START };
  let swipesSoFar = 0, workdaysSoFar = 0, weekdaysSoFar = 0;
  const d = new Date(start);
  while (d <= end) {
    const rec = days[isoDate(d)];
    const swiped = !!rec && rec.type === 'swipe';
    const past = d < today, isToday = +d === +today;
    const elapsed = past || (isToday && swiped);
    if (swiped) { s.swipes++; if (past || isToday) swipesSoFar++; }
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      if (elapsed) weekdaysSoFar++;
      if (!(rec && EXCUSED.has(rec.type))) {
        s.workdays++;
        if (elapsed) workdaysSoFar++;
        else s.left++;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  s.required = s.weekly ? Math.ceil(settings.weekly * s.workdays / 5 - 1e-9) : null;
  s.pace = workdaysSoFar ? swipesSoFar / workdaysSoFar * 5 : null;
  s.rawPace = weekdaysSoFar ? swipesSoFar / weekdaysSoFar * 5 : null;
  return s;
}

// Rounds down so 3.46 shows as 3.4, never as a 3.5 that still misses the target.
const fmtAvg = v => (Math.floor(v * 10 + 1e-9) / 10).toFixed(1);
// Day counts that hours carried over can make fractional: 24.33, never 24.33375.
const fmtDays = v => String(Math.round(v * 100) / 100);
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
  else if (needed > s.left * settings.weekly / 5) tile.classList.add('warn');
}

// Avg/week tile: pace so far against the weekly target, once with days off left out and once
// with them counted as missed.
function renderPace(valueEl, rawEl, subEl, s) {
  setPace(valueEl, s.pace);
  setPace(rawEl, s.rawPace);
  subEl.textContent = `so far · target ≥ ${settings.weekly}`;
}
function setPace(el, v) {
  el.textContent = v == null ? '—' : fmtAvg(v);
  el.classList.remove('ok', 'bad');
  if (v != null) el.classList.add(v >= settings.weekly ? 'ok' : 'bad');
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  renderSettings();
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
  return DAY_LABELS[t] || t;
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
  renderPace($('qAvg'), $('qAvgRaw'), $('qAvgSub'), qs);

  // Month: same
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const ms = periodStats(mStart, mEnd);
  $('mLabel').textContent = mStart.toLocaleDateString(undefined, { month: 'long' });
  $('mCount').textContent = ms.swipes;
  $('mTarget').textContent = ms.required;
  renderTarget($('tileMonth'), $('mBar'), $('mSub'), ms, 'month');
  renderPace($('mAvg'), $('mAvgRaw'), $('mAvgSub'), ms);

  // PTO (calendar year): the yearly allotment plus the hours carried over from the year before
  const yStart = new Date(today.getFullYear(), 0, 1);
  const yEnd = new Date(today.getFullYear(), 11, 31);
  $('ptoYear').textContent = today.getFullYear();
  const ptoUsed = countInRange('pto', yStart, yEnd);
  const carryDays = settings.carry / HOURS_PER_DAY;
  const ptoQuota = settings.pto + carryDays;
  $('ptoUsed').textContent = ptoUsed;
  $('ptoQuota').textContent = fmtDays(ptoQuota);
  const ptoSub = $('ptoSub');
  ptoSub.textContent = `${fmtDays(ptoQuota - ptoUsed)} days remaining`
    + (settings.carry ? ` · ${settings.carry} h carried over` : '');
  ptoSub.title = settings.carry
    ? `${settings.pto} days + ${settings.carry} hours carried over from ${today.getFullYear() - 1}`
      + ` = ${fmtDays(ptoQuota)} days at ${HOURS_PER_DAY} hours a day`
    : '';

  // Flex (Feb 20 - Feb 19)
  const fy = flexYearOf(today);
  const flexUsed = countInRange('flex', fy.start, fy.end);
  $('flexUsed').textContent = flexUsed;
  $('flexQuota').textContent = settings.flex;
  $('flexSub').textContent = `${fy.label} · ${settings.flex - flexUsed} left`;

  // Float (calendar year)
  $('floatYear').textContent = today.getFullYear();
  const floatUsed = countInRange('float', yStart, yEnd);
  $('floatUsed').textContent = floatUsed;
  $('floatQuota').textContent = settings.float;
  $('floatSub').textContent = `${settings.float - floatUsed} days remaining`;
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
    cell.innerHTML = `<div class="cal-daynum">${day}</div>`;
    if (rec && rec.notes) {
      const n = document.createElement('div');
      n.className = 'cal-note';
      n.textContent = rec.notes;
      n.title = rec.notes;
      cell.appendChild(n);
    }
    if (rec) cell.insertAdjacentHTML('beforeend', `<div class="cal-tag">${labelOf(rec.type)}</div>`);
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
    el.textContent = `${plural(s.swipes, 'office day')}${avgTxt} · before the ${settings.weekly}/week rule`;
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
