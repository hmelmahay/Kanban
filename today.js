// ── Today hub ─────────────────────────────────────────────────────────────────
// One page to open first thing: what's overdue, what's due today, what's in
// flight, what's coming — across every board — plus badge status and a quick
// capture box. Reads/writes the same Supabase tables as the Kanban board.

const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

const QUARTER_MIN    = 33;   // badge swipes required per quarter (mirrors badges.js)
const DOING_WIP_LIMIT = 3;   // mirrors script.js
const WEEK_AHEAD_DAYS = 7;
const AUTO_REFRESH_MS = 60000;

const STATUSES = ['todo', 'ondeck', 'doing', 'done'];
const STATUS_LABEL = { pending: 'Pending', todo: 'To Do', ondeck: 'On Deck', doing: 'Doing', done: 'Done' };
const PRIORITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const CHECKLIST_RE = /^(\s*)-\s*\[([ xX])\]\s*(.*)$/;

// ── State ─────────────────────────────────────────────────────────────────────
let db = null;
let boards = [];
let tasks = [];        // every non-done task, all boards
let badgeDays = {};    // { 'YYYY-MM-DD': type } for the current quarter
let popoverEl = null;
let undoState = null;  // { id, prev: {...} } for the toast
let toastTimer = null;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const setStatus = msg => { $('syncStatus').textContent = msg; };

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
function addDays(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return isoDate(d); }
function daysBetween(fromISO, toISO) {
  return Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000);
}
function boardName(id) { return boards.find(b => b.id === id)?.name || ''; }

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
    showApp();
    return true;
  } catch (e) {
    setStatus('Supabase unavailable');
    return false;
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function loadAll() {
  const { start } = currentQuarter();
  const [b, t, bd] = await Promise.all([
    db.from('boards').select('*').order('created_at'),
    db.from('tasks').select('*').neq('status', 'done'),
    db.from('badge_days').select('day, type').gte('day', isoDate(start)),
  ]);
  if (b.error || t.error || bd.error) {
    setStatus('Load error: ' + (b.error || t.error || bd.error).message);
    return false;
  }
  boards = b.data || [];
  tasks = t.data || [];
  badgeDays = {};
  for (const r of bd.data || []) badgeDays[r.day] = r.type;
  await autoMoveTodayTasks();
  setStatus(`Synced ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
  return true;
}

// Same rule the board applies on load: anything in To Do / On Deck whose due
// date has arrived becomes today's work.
async function autoMoveTodayTasks() {
  const today = todayISO();
  const toMove = tasks.filter(t =>
    (t.status === 'todo' || t.status === 'ondeck') && t.due_date && t.due_date <= today
  );
  for (const t of toMove) {
    await updateTask(t.id, { status: 'doing', sort_order: nextSortOrder('doing', t.board_id) });
  }
}

function nextSortOrder(status, boardId) {
  const siblings = tasks.filter(t => t.status === status && t.board_id === boardId);
  return siblings.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0) + 1000;
}

async function updateTask(id, changes) {
  const t = tasks.find(x => x.id === id);
  if (!t) return false;
  if (changes.status && changes.status !== t.status && !changes.status_since) {
    changes.status_since = new Date().toISOString();
  }
  if (changes.status === 'done' && !changes.completed_at) changes.completed_at = todayISO();
  else if (changes.status && changes.status !== 'done') changes.completed_at = null;
  const { error } = await db.from('tasks').update(changes).eq('id', id);
  if (error) { alert('Update failed: ' + error.message); return false; }
  Object.assign(t, changes);
  return true;
}

// ── Recurring (mirrors script.js so completing from here spawns the next one) ──
function parseRecurring(val) {
  if (!val) return { unit: '', n: 1 };
  const m = val.match(/^(\d+)-(weekly|monthly)$/);
  if (m) return { unit: m[2], n: parseInt(m[1]) };
  return ['daily', 'weekly', 'monthly'].includes(val) ? { unit: val, n: 1 } : { unit: '', n: 1 };
}
function recurringLabel(val) {
  const { unit, n } = parseRecurring(val);
  if (!unit) return '';
  if (unit === 'daily') return 'Daily';
  if (unit === 'weekly') return n === 1 ? 'Weekly' : `Every ${n} Weeks`;
  return n === 1 ? 'Monthly' : `Every ${n} Months`;
}
function nextDueDate(iso, freq) {
  const d = new Date(iso + 'T00:00:00');
  const { unit, n } = parseRecurring(freq);
  if (unit === 'daily') d.setDate(d.getDate() + n);
  if (unit === 'weekly') d.setDate(d.getDate() + 7 * n);
  if (unit === 'monthly') d.setMonth(d.getMonth() + n);
  return isoDate(d);
}
function resetChecklist(notes) {
  if (!notes) return notes;
  return notes.split('\n').map(line => {
    const m = line.match(CHECKLIST_RE);
    return m ? `${m[1]}- [ ] ${m[3]}` : line;
  }).join('\n');
}
function checklistProgress(notes) {
  if (!notes) return null;
  let total = 0, done = 0;
  for (const line of notes.split('\n')) {
    const m = line.match(CHECKLIST_RE);
    if (!m) continue;
    total++;
    if (m[2].trim().toLowerCase() === 'x') done++;
  }
  return total ? { done, total } : null;
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function markDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const prev = { status: t.status, completed_at: t.completed_at, sort_order: t.sort_order, status_since: t.status_since };
  const row = document.querySelector(`.hub-row[data-id="${id}"]`);
  row?.classList.add('leaving');
  const ok = await updateTask(id, { status: 'done', sort_order: Date.now() });
  if (!ok) { row?.classList.remove('leaving'); return; }

  let spawned = null;
  if (t.due_date && parseRecurring(t.recurring).unit) {
    spawned = {
      id: crypto.randomUUID(),
      board_id: t.board_id,
      title: t.title,
      priority: t.priority,
      due_date: nextDueDate(t.due_date, t.recurring),
      status: 'todo',
      recurring: t.recurring,
      notes: resetChecklist(t.notes),
      sort_order: nextSortOrder('todo', t.board_id),
      is_accomplishment: false,
      home_only: !!t.home_only,
      created_at: new Date().toISOString(),
    };
    const { error } = await db.from('tasks').insert(spawned);
    if (error) { alert('Could not create the next occurrence: ' + error.message); spawned = null; }
    else tasks.push(spawned);
  }

  showToast(`Done: ${t.title}`, async () => {
    await updateTask(id, prev);
    if (spawned) {
      await db.from('tasks').delete().eq('id', spawned.id);
      tasks = tasks.filter(x => x.id !== spawned.id);
    }
    render();
  });
  setTimeout(render, 160);
}

function showToast(msg, onUndo) {
  clearTimeout(toastTimer);
  $('toastMsg').textContent = msg;
  undoState = onUndo;
  $('toast').classList.remove('hidden');
  toastTimer = setTimeout(hideToast, 7000);
}
function hideToast() { $('toast').classList.add('hidden'); undoState = null; }
$('toastUndo').addEventListener('click', async () => {
  const fn = undoState;
  hideToast();
  if (fn) await fn();
});

// ── Snooze popover ────────────────────────────────────────────────────────────
function closePopover() { if (popoverEl) { popoverEl.remove(); popoverEl = null; } }
function openPopover(anchor, html, key) {
  closePopover();
  popoverEl = document.createElement('div');
  popoverEl.className = 'popover';
  popoverEl.dataset.for = key;
  popoverEl.innerHTML = html;
  document.body.appendChild(popoverEl);
  const r = anchor.getBoundingClientRect();
  const pw = popoverEl.offsetWidth, ph = popoverEl.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - pw - 8);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
  popoverEl.style.left = Math.max(8, left) + 'px';
  popoverEl.style.top = Math.max(8, top) + 'px';
  return popoverEl;
}
document.addEventListener('click', e => {
  if (!popoverEl || popoverEl.contains(e.target) || e.target.closest('.snooze-btn')) return;
  closePopover();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });

function snoozeOptions() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return isoDate(d); };
  const dow = today.getDay();
  const month = new Date(today); month.setMonth(month.getMonth() + 1);
  return [
    { label: 'Tomorrow',    value: add(1) },
    { label: 'Next Monday', value: add(((8 - dow) % 7) || 7) },
    { label: 'In 1 week',   value: add(7) },
    { label: 'In 1 month',  value: isoDate(month) },
    { label: 'No due date', value: null },
  ];
}

function openSnoozeMenu(btn, id) {
  if (popoverEl && popoverEl.dataset.for === 'snooze-' + id) { closePopover(); return; }
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const sub = t.status === 'doing' ? 'Moves the card back to On Deck until then.' : '';
  const html =
    `<div class="popover-title">Snooze${t.due_date ? ` · due ${formatDate(t.due_date)}` : ''}</div>` +
    (sub ? `<div class="popover-hint">${sub}</div>` : '') +
    snoozeOptions().map(o =>
      `<button type="button" class="popover-item" data-value="${o.value ?? ''}">` +
        `<span>${o.label}</span>${o.value ? `<span class="popover-sub">${formatDate(o.value)}</span>` : ''}` +
      `</button>`
    ).join('');
  const el = openPopover(btn, html, 'snooze-' + id);
  el.querySelectorAll('.popover-item').forEach(b => b.addEventListener('click', async () => {
    const value = b.dataset.value || null;
    closePopover();
    const changes = { due_date: value };
    if (t.status === 'doing' && value && value > todayISO()) {
      changes.status = 'ondeck';
      changes.sort_order = nextSortOrder('ondeck', t.board_id);
    }
    await updateTask(id, changes);
    render();
  }));
}

document.addEventListener('click', e => {
  const snooze = e.target.closest('.snooze-btn');
  if (snooze) { e.stopPropagation(); openSnoozeMenu(snooze, snooze.dataset.id); return; }
  const done = e.target.closest('.done-btn');
  if (done) { e.stopPropagation(); markDone(done.dataset.id); }
});

// ── Quick capture ─────────────────────────────────────────────────────────────
function renderCaptureBoards() {
  const sel = $('captureBoard');
  const saved = localStorage.getItem('hub_capture_board');
  sel.innerHTML = boards.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  if (boards.some(b => b.id === saved)) sel.value = saved;
}
$('captureBoard').addEventListener('change', () => localStorage.setItem('hub_capture_board', $('captureBoard').value));

async function capture() {
  const title = $('captureTitle').value.trim();
  if (!title) { $('captureTitle').focus(); return; }
  const boardId = $('captureBoard').value;
  if (!boardId) return;
  const due = $('captureDue').value || null;
  const status = due && due <= todayISO() ? 'doing' : 'todo';
  const task = {
    id: crypto.randomUUID(),
    board_id: boardId,
    title,
    priority: $('capturePriority').value,
    due_date: due,
    status,
    recurring: '',
    notes: '',
    sort_order: nextSortOrder(status, boardId),
    is_accomplishment: false,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db.from('tasks').insert(task).select().single();
  if (error) { alert('Could not add: ' + error.message); return; }
  tasks.push(data);
  $('captureTitle').value = '';
  $('captureDue').value = '';
  $('capturePriority').value = 'Medium';
  render();
  setStatus(`Added to ${boardName(boardId)}`);
}
$('captureBtn').addEventListener('click', capture);
$('captureTitle').addEventListener('keydown', e => { if (e.key === 'Enter') capture(); });

// ── Badge ─────────────────────────────────────────────────────────────────────
function currentQuarter() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return { q, year: now.getFullYear(), start: new Date(now.getFullYear(), (q - 1) * 3, 1), end: new Date(now.getFullYear(), q * 3, 0) };
}
function weekdaysAfterToday(to) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
  let n = 0;
  while (d <= to) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}
const BADGE_LABEL = { swipe: 'Badged in', not_swipe: 'No swipe', pto: 'PTO', flex: 'Flex', float: 'Float', holiday: 'Holiday', off: 'Off' };

function renderBadge() {
  const today = todayISO();
  const rec = badgeDays[today];
  const btn = $('badgeBtn');
  if (rec === 'swipe') {
    $('badgeToday').textContent = '✅ Badged in today';
    btn.textContent = 'Undo badge-in';
    btn.classList.replace('btn-primary', 'btn-outline');
  } else {
    $('badgeToday').textContent = rec ? `Today logged as: ${BADGE_LABEL[rec] || rec}` : 'Nothing logged for today yet.';
    btn.textContent = 'Badge In Today';
    btn.classList.replace('btn-outline', 'btn-primary');
  }

  const { q, year, end } = currentQuarter();
  const swipes = Object.values(badgeDays).filter(t => t === 'swipe').length;
  const needed = Math.max(0, QUARTER_MIN - swipes);
  const left = weekdaysAfterToday(end);
  $('badgeQLabel').textContent = `Q${q} ${year} swipes`;
  $('badgeQCount').textContent = `${swipes} / ${QUARTER_MIN}`;
  $('badgeQBar').style.width = Math.min(100, swipes / QUARTER_MIN * 100) + '%';
  $('badgeQSub').textContent = needed === 0
    ? `Target met · ${left} weekdays left in the quarter`
    : `${needed} more needed · ${left} weekdays left`;
  const sec = $('sec-badge');
  sec.classList.remove('ok', 'warn', 'bad');
  if (swipes >= QUARTER_MIN) sec.classList.add('ok');
  else if (needed > left) sec.classList.add('bad');
  else if (needed > left * 0.7) sec.classList.add('warn');
  return { swipes, needed, left, state: sec.classList.contains('bad') ? 'bad' : sec.classList.contains('warn') ? 'warn' : swipes >= QUARTER_MIN ? 'ok' : '' };
}

$('badgeBtn').addEventListener('click', async () => {
  const today = todayISO();
  if (badgeDays[today] === 'swipe') {
    const { error } = await db.from('badge_days').delete().eq('day', today);
    if (error) { alert('Failed: ' + error.message); return; }
    delete badgeDays[today];
  } else {
    const { error } = await db.from('badge_days').upsert({ day: today, type: 'swipe', notes: null });
    if (error) { alert('Failed: ' + error.message); return; }
    badgeDays[today] = 'swipe';
  }
  render();
});

// ── Render ────────────────────────────────────────────────────────────────────
function priorityDueCompare(a, b) {
  const pa = PRIORITY_RANK[a.priority] ?? 99, pb = PRIORITY_RANK[b.priority] ?? 99;
  if (pa !== pb) return pa - pb;
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}
function dueThenPriority(a, b) {
  const c = (a.due_date || '').localeCompare(b.due_date || '');
  return c !== 0 ? c : priorityDueCompare(a, b);
}

function dueBadge(t, today) {
  if (!t.due_date) return '';
  const diff = daysBetween(today, t.due_date);
  if (diff < 0)  return `<span class="badge badge-overdue">${-diff}d overdue · ${formatDate(t.due_date)}</span>`;
  if (diff === 0) return `<span class="badge badge-date">Today</span>`;
  if (diff === 1) return `<span class="badge badge-date">Tomorrow</span>`;
  const dow = new Date(t.due_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
  return `<span class="badge badge-date">${dow} ${formatDate(t.due_date)}</span>`;
}

function renderRow(t, today, opts = {}) {
  const check = checklistProgress(t.notes);
  return `
    <div class="hub-row prio-${t.priority}" data-id="${t.id}">
      <div class="hub-row-main">
        <div class="hub-row-title">${escHtml(t.title)}</div>
        <div class="hub-row-meta">
          <span class="badge priority-${t.priority}">${t.priority}</span>
          <span class="badge badge-board">${escHtml(boardName(t.board_id))}</span>
          ${opts.showStatus !== false ? `<span class="badge badge-status">${STATUS_LABEL[t.status] || t.status}</span>` : ''}
          ${dueBadge(t, today)}
          ${check ? `<span class="badge badge-check">☑ ${check.done}/${check.total}</span>` : ''}
          ${t.home_only ? `<span class="badge badge-home">&#127968; Home</span>` : ''}
          ${t.recurring && recurringLabel(t.recurring) ? `<span class="badge badge-recurring">${recurringLabel(t.recurring)}</span>` : ''}
        </div>
      </div>
      <div class="hub-row-actions">
        ${opts.pending ? '' : `<button class="btn btn-icon done-btn" data-id="${t.id}" title="Mark done">&#10003;</button>`}
        ${opts.pending ? '' : `<button class="btn btn-icon snooze-btn" data-id="${t.id}" title="Snooze — push the due date">&#9200;</button>`}
        <a class="btn btn-icon" href="index.html?board=${t.board_id}&task=${t.id}" title="Open on the board">&#8599;</a>
      </div>
    </div>`;
}

function renderList(listId, cntId, items, empty, today, opts) {
  $(listId).innerHTML = items.length ? items.map(t => renderRow(t, today, opts)).join('') : `<div class="hub-empty">${empty}</div>`;
  const c = $(cntId);
  c.textContent = items.length;
  c.classList.toggle('nonzero', items.length > 0);
}

function render() {
  const today = todayISO();
  const weekEnd = addDays(WEEK_AHEAD_DAYS);
  const now = new Date();
  const h = now.getHours();
  $('hubGreeting').textContent = h < 12 ? 'Good morning, Steve' : h < 17 ? 'Good afternoon, Steve' : 'Good evening, Steve';
  $('hubDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'pending');
  const overdue  = open.filter(t => t.due_date && t.due_date < today).sort(dueThenPriority);
  const dueToday = open.filter(t => t.due_date === today).sort(priorityDueCompare);
  const doing    = open.filter(t => t.status === 'doing' && !(t.due_date && t.due_date <= today)).sort(priorityDueCompare);
  const week     = open.filter(t => t.due_date && t.due_date > today && t.due_date <= weekEnd).sort(dueThenPriority);
  const pending  = tasks.filter(t => t.status === 'pending').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const doingTotal = open.filter(t => t.status === 'doing').length;

  renderList('list-overdue', 'cnt-overdue', overdue, 'Nothing overdue 🎉', today);
  renderList('list-today',   'cnt-today',   dueToday, 'Nothing due today.', today);
  renderList('list-doing',   'cnt-doing',   doing, doingTotal ? 'Everything in Doing is listed above.' : 'Nothing in progress.', today, { showStatus: false });
  renderList('list-week',    'cnt-week',    week, `Nothing due in the next ${WEEK_AHEAD_DAYS} days.`, today);
  renderList('list-pending', 'cnt-pending', pending, 'Nothing awaiting approval.', today, { pending: true, showStatus: false });

  const badge = renderBadge();

  const stat = (n, label, cls = '', href = null) =>
    `<${href ? `a href="${href}"` : 'div'} class="hub-stat ${cls}"><span class="hub-stat-n">${n}</span><span class="hub-stat-label">${label}</span></${href ? 'a' : 'div'}>`;
  $('hubStats').innerHTML =
    stat(overdue.length, 'Overdue', overdue.length ? 'bad' : 'ok', '#sec-overdue') +
    stat(dueToday.length, 'Due today', dueToday.length ? 'warn' : '', '#sec-today') +
    stat(doingTotal, 'Doing', doingTotal > DOING_WIP_LIMIT ? 'warn' : '', '#sec-doing') +
    stat(week.length, 'This week', '', '#sec-week') +
    stat(pending.length, 'Pending', pending.length ? 'warn' : '', 'index.html') +
    stat(`${badge.swipes}/${QUARTER_MIN}`, 'Badge qtr', badge.state, 'badges.html');
}

// ── Refresh ───────────────────────────────────────────────────────────────────
function busy() {
  if (popoverEl) return true;
  if (!$('toast').classList.contains('hidden')) return true;
  const ae = document.activeElement;
  return !!ae && ae.closest && !!ae.closest('.hub-capture') && ae.tagName === 'INPUT' && ae.value;
}
async function refresh() {
  if (!db || document.hidden || busy()) return;
  try { if (await loadAll()) render(); } catch (e) { /* retry next tick */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', refresh);

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  if (!(await loadAll())) return;
  renderCaptureBoards();
  render();
}

(async () => {
  if (await initSupabase()) {
    await boot();
    setInterval(refresh, AUTO_REFRESH_MS);
  }
})();
