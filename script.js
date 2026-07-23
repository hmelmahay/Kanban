// ── Supabase config ───────────────────────────────────────────────────────────
// Paste your Supabase project URL and anon key here.
// Leave blank to use localStorage only.
const SUPABASE_URL  = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// ── State ─────────────────────────────────────────────────────────────────────
let db       = null;   // Supabase client (null = localStorage mode)
let boards   = [];     // [{id, name}]
let tasks    = [];     // current board's tasks
let boardId  = null;   // active board id
let draggedId      = null;
let allBoardsMode  = false;

const BOARDS_KEY = 'kanban_boards_v2';
const tasksKey   = id => `kanban_tasks_v2_${id}`;

// ── Auth ──────────────────────────────────────────────────────────────────────

function showApp() {
  document.getElementById('loginOverlay').classList.add('hidden');
}

function showLogin(msg) {
  document.getElementById('loginOverlay').classList.remove('hidden');
  const err = document.getElementById('loginError');
  if (msg) { err.textContent = msg; err.style.display = 'block'; }
  else       { err.style.display = 'none'; }
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const btn      = document.getElementById('loginBtn');
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showLogin('Enter your email and password.'); return; }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = 'Sign In';
  if (error) { showLogin(error.message); return; }
  showApp();
});

document.getElementById('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await db.auth.signOut();
  showLogin();
});

// ── Supabase init ─────────────────────────────────────────────────────────────

async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    // Check for existing session
    const { data: { session } } = await db.auth.getSession();
    if (!session) { showLogin(); return false; }
    showApp();
    setStatus('Connected to Supabase');
    return true;
  } catch (e) {
    console.warn('Supabase unavailable:', e.message);
    db = null;
    setStatus('Local mode (Supabase not configured)');
    return false;
  }
}

function setStatus(msg) {
  document.getElementById('syncStatus').textContent = msg;
}

// ── Boards ────────────────────────────────────────────────────────────────────

async function loadBoards() {
  if (db) {
    const { data, error } = await db.from('boards').select('*').order('created_at');
    if (!error) boards = data;
  } else {
    boards = JSON.parse(localStorage.getItem(BOARDS_KEY) || '[]');
  }

  if (boards.length === 0) {
    await createBoard('My Board');
    return;
  }

  const savedId = localStorage.getItem('kanban_active_board');
  boardId = boards.find(b => b.id === savedId) ? savedId : boards[0].id;
  renderBoardSelect();
  await loadTasks();
}

async function createBoard(name) {
  const id = uid();
  const board = { id, name, created_at: new Date().toISOString() };
  if (db) {
    const { error } = await db.from('boards').insert(board);
    if (error) { alert('Error creating board: ' + error.message); return; }
    const { data } = await db.from('boards').select('*').order('created_at');
    if (data) boards = data;
  } else {
    boards.push(board);
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  }
  boardId = id;
  renderBoardSelect();
  tasks = [];
  renderAll();
}

async function renameBoard(newName) {
  const board = boards.find(b => b.id === boardId);
  if (!board) return;
  board.name = newName;
  if (db) {
    await db.from('boards').update({ name: newName }).eq('id', boardId);
  } else {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  }
  renderBoardSelect();
}

async function deleteBoard() {
  if (boards.length <= 1) { alert('Cannot delete the only board.'); return; }
  if (!confirm('Delete this board and all its tasks?')) return;
  if (db) {
    await db.from('tasks').delete().eq('board_id', boardId);
    await db.from('boards').delete().eq('id', boardId);
  } else {
    localStorage.removeItem(tasksKey(boardId));
    boards = boards.filter(b => b.id !== boardId);
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  }
  boards = boards.filter(b => b.id !== boardId);
  boardId = boards[0].id;
  renderBoardSelect();
  await loadTasks();
}

function renderBoardSelect() {
  const tabs = document.getElementById('boardTabs');
  const activeVal = allBoardsMode ? '__all__' : boardId;
  const items = [{ id: '__all__', name: 'All Boards' }, ...boards];
  tabs.innerHTML = items.map(b => {
    const isActive = b.id === activeVal;
    return `<button type="button" class="board-tab${isActive ? ' active' : ''}" data-board-id="${escAttr(b.id)}" role="tab" aria-selected="${isActive}">${escHtml(b.name)}</button>`;
  }).join('');
}

function setAllBoardsUI() {
  const isAll = allBoardsMode;
  document.getElementById('formBar').style.display = isAll ? 'none' : '';
  document.getElementById('renameBoardBtn').disabled = isAll;
  document.getElementById('deleteBoardBtn').disabled = isAll;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

async function loadAllTasks() {
  if (db) {
    const { data, error } = await db.from('tasks').select('*').order('created_at');
    if (!error) tasks = data;
  } else {
    tasks = boards.flatMap(b =>
      JSON.parse(localStorage.getItem(tasksKey(b.id)) || '[]')
    );
  }
  await autoMoveTodayTasks();
  renderAll();
}

async function loadTasks() {
  if (db) {
    const { data, error } = await db.from('tasks')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at');
    if (!error) tasks = data;
  } else {
    tasks = JSON.parse(localStorage.getItem(tasksKey(boardId)) || '[]');
  }
  await autoMoveTodayTasks();
  renderAll();
}

async function autoMoveTodayTasks() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toMove = tasks.filter(t =>
    (t.status === 'todo' || t.status === 'ondeck') && t.due_date && t.due_date <= today
  );
  for (const t of toMove) {
    await updateTask(t.id, { status: 'doing', sort_order: nextSortOrder('doing', t.board_id) });
  }
}

async function addTask(task) {
  if (db) {
    const { data, error } = await db.from('tasks').insert(task).select().single();
    if (error) { alert('Error adding task: ' + error.message); return; }
    tasks.push(data);
  } else {
    tasks.push(task);
    saveTasks();
  }
  renderAll();
}

async function updateTask(id, changes) {
  if (changes.status === 'done' && !changes.completed_at) {
    changes.completed_at = new Date().toISOString().split('T')[0];
  } else if (changes.status && changes.status !== 'done') {
    changes.completed_at = null;
  }
  if (db) {
    const { error } = await db.from('tasks').update(changes).eq('id', id);
    if (error) { alert('Error updating task: ' + error.message); return; }
  }
  const t = tasks.find(t => t.id === id);
  if (t) Object.assign(t, changes);
  if (!db) saveTasksFor(t?.board_id || boardId);

  // Spawn next occurrence when a recurring task is completed
  if (changes.status === 'done' && t?.recurring && t?.due_date) {
    const next = nextDueDate(t.due_date, t.recurring);
    await addTask({
      id:         uid(),
      board_id:   boardId,
      title:      t.title,
      priority:   t.priority,
      due_date:   next,
      status:     'todo',
      recurring:  t.recurring,
      notes:      resetChecklist(t.notes),
      sort_order: nextSortOrder('todo'),
      is_accomplishment: false,
      created_at: new Date().toISOString(),
    });
    return; // addTask calls renderAll
  }

  renderAll();
}

function parseRecurring(val) {
  if (!val) return { unit: '', n: 1 };
  const m = val.match(/^(\d+)-(weekly|monthly)$/);
  if (m) return { unit: m[2], n: parseInt(m[1]) };
  return { unit: val, n: 1 };
}

function recurringLabel(val) {
  const { unit, n } = parseRecurring(val);
  if (!unit) return '';
  if (unit === 'daily') return 'Daily';
  if (unit === 'weekly')  return n === 1 ? 'Weekly'  : `Every ${n} Weeks`;
  if (unit === 'monthly') return n === 1 ? 'Monthly' : `Every ${n} Months`;
  return val;
}

function buildRecurringValue(selectId, intervalId) {
  const unit = document.getElementById(selectId).value;
  if (!unit || unit === 'daily') return unit;
  const n = parseInt(document.getElementById(intervalId).value) || 1;
  return n > 1 ? `${n}-${unit}` : unit;
}

function syncIntervalInput(selectId, intervalId) {
  const unit = document.getElementById(selectId).value;
  const inp = document.getElementById(intervalId);
  inp.style.display = (unit === 'weekly' || unit === 'monthly') ? 'inline-block' : 'none';
}

function nextDueDate(iso, freq) {
  const d = new Date(iso + 'T00:00:00');
  const { unit, n } = parseRecurring(freq);
  if (unit === 'daily')   d.setDate(d.getDate() + n);
  if (unit === 'weekly')  d.setDate(d.getDate() + 7 * n);
  if (unit === 'monthly') d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
}

async function deleteTask(id) {
  if (db) {
    const { error } = await db.from('tasks').delete().eq('id', id);
    if (error) { alert('Error deleting task: ' + error.message); return; }
  }
  const deleted = tasks.find(t => t.id === id);
  tasks = tasks.filter(t => t.id !== id);
  if (!db) saveTasksFor(deleted?.board_id || boardId);
  renderAll();
}

async function duplicateTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const copy = {
    id:         uid(),
    board_id:   t.board_id,
    title:      t.title + ' (copy)',
    priority:   t.priority,
    due_date:   t.due_date,
    status:     'todo',
    recurring:  t.recurring,
    notes:      t.notes,
    sort_order: nextSortOrder('todo', t.board_id),
    is_accomplishment: false,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  await addTask(copy);
}

function saveTasks() {
  localStorage.setItem(tasksKey(boardId), JSON.stringify(tasks));
}

function saveTasksFor(bid) {
  const boardTasks = tasks.filter(t => t.board_id === bid);
  localStorage.setItem(tasksKey(bid), JSON.stringify(boardTasks));
}

// ── Render ────────────────────────────────────────────────────────────────────

const STATUSES = ['todo', 'ondeck', 'doing', 'done'];
const REORDERABLE = new Set(['todo', 'ondeck', 'doing']);

function renderAll() {
  const pFilter = document.getElementById('priorityFilter').value;

  const visible = tasks.filter(t => {
    return !pFilter || t.priority === pFilter;
  });

  STATUSES.forEach(status => {
    const col = document.getElementById('col-' + status);
    const colTasks = visible
      .filter(t => t.status === status)
      .sort((a, b) => {
        // To Do, On Deck, Doing: manual sort_order (drag to reorder freely)
        if (REORDERABLE.has(status)) {
          return (a.sort_order ?? Number.MAX_SAFE_INTEGER) -
                 (b.sort_order ?? Number.MAX_SAFE_INTEGER);
        }
        // Done: keep due-date sort
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });
    document.getElementById('count-' + status).textContent =
      tasks.filter(t => t.status === status).length;

    if (colTasks.length === 0) {
      col.innerHTML = `<div class="empty-state">No tasks</div>`;
      return;
    }

    col.innerHTML = colTasks.map(renderTask).join('');

    col.querySelectorAll('.task').forEach(el => {
      el.addEventListener('dragstart', onDragStart);
      el.addEventListener('dragend', onDragEnd);
    });

    col.querySelectorAll('.edit-task-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openEditModal(e.currentTarget.dataset.id);
      });
    });

    col.querySelectorAll('.delete-task-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteTask(e.currentTarget.dataset.id);
      });
    });

    col.querySelectorAll('.duplicate-task-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        duplicateTask(e.currentTarget.dataset.id);
      });
    });

    col.querySelectorAll('.note-checkbox').forEach(cb => {
      cb.addEventListener('click', e => {
        e.stopPropagation();
        toggleChecklistItem(cb.dataset.task, parseInt(cb.dataset.line, 10));
      });
      cb.addEventListener('mousedown', e => e.stopPropagation());
    });

    col.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        updateTask(id, { is_accomplishment: !task.is_accomplishment });
      });
      btn.addEventListener('mousedown', e => e.stopPropagation());
    });

    col.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { id, dir } = e.currentTarget.dataset;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const idx = STATUSES.indexOf(task.status);
        const next = STATUSES[idx + Number(dir)];
        if (next) updateTask(id, { status: next, sort_order: nextSortOrder(next, task.board_id) });
      });
    });
  });

  renderPendingColumn(visible);
}

// ── Pending Approval column (auto-posted action items await review here) ───────
const PENDING = 'pending';

function renderPendingColumn(visible) {
  const col = document.getElementById('col-' + PENDING);
  if (!col) return;

  const pendingTasks = visible
    .filter(t => t.status === PENDING)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

  document.getElementById('count-' + PENDING).textContent =
    tasks.filter(t => t.status === PENDING).length;

  if (pendingTasks.length === 0) {
    col.innerHTML = `<div class="empty-state">Nothing awaiting approval</div>`;
    return;
  }

  col.innerHTML = pendingTasks.map(renderPendingTask).join('');

  col.querySelectorAll('.task').forEach(el => {
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);
  });

  col.querySelectorAll('.edit-task-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(e.currentTarget.dataset.id);
    });
  });

  col.querySelectorAll('.delete-task-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteTask(e.currentTarget.dataset.id);
    });
  });

  col.querySelectorAll('.note-checkbox').forEach(cb => {
    cb.addEventListener('click', e => {
      e.stopPropagation();
      toggleChecklistItem(cb.dataset.task, parseInt(cb.dataset.line, 10));
    });
    cb.addEventListener('mousedown', e => e.stopPropagation());
  });

  col.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { id, target } = e.currentTarget.dataset;
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      updateTask(id, { status: target, sort_order: nextSortOrder(target, task.board_id) });
    });
  });
}

function renderPendingTask(t) {
  const due = t.due_date ? formatDate(t.due_date) : null;
  const overdue = isOverdue(t.due_date);
  const dateBadge = due
    ? `<span class="badge ${overdue ? 'badge-overdue' : 'badge-date'}">${overdue ? 'Overdue: ' : ''}${due}</span>`
    : '';

  return `
    <div class="task" draggable="true" data-id="${t.id}">
      <div class="task-title">${escHtml(t.title)}</div>
      <div class="task-meta">
        <span class="badge priority-${t.priority}">${t.priority}</span>
        ${allBoardsMode ? `<span class="badge badge-board">${escHtml(boards.find(b => b.id === t.board_id)?.name || '')}</span>` : ''}
        ${dateBadge}
        ${t.recurring ? `<span class="badge badge-recurring">${recurringLabel(t.recurring)}</span>` : ''}
      </div>
      ${t.notes ? `<div class="task-notes">${renderNotes(t.notes, t.id)}</div>` : ''}
      <div class="approve-row">
        <span class="approve-label">&#10003; Approve&nbsp;→</span>
        <button class="btn btn-approve approve-btn" data-id="${t.id}" data-target="todo" title="Approve into To Do">To Do</button>
        <button class="btn btn-approve approve-btn" data-id="${t.id}" data-target="ondeck" title="Approve into On Deck">On Deck</button>
        <button class="btn btn-approve approve-btn" data-id="${t.id}" data-target="doing" title="Approve into Doing">Doing</button>
        <button class="btn btn-icon edit-task-btn" data-id="${t.id}" title="Edit before approving">&#9998;</button>
        <button class="btn btn-icon-danger delete-task-btn" data-id="${t.id}" title="Remove (do not approve)">&#x2715;</button>
      </div>
    </div>
  `;
}

function renderTask(t) {
  const idx = STATUSES.indexOf(t.status);
  const done = t.status === 'done';
  const due = t.due_date ? formatDate(t.due_date) : null;
  const overdue = !done && isOverdue(t.due_date);
  const dateBadge = done
    ? (t.completed_at ? `<span class="badge badge-done-date">Done ${formatDate(t.completed_at)}</span>` : '')
    : due ? `<span class="badge ${overdue ? 'badge-overdue' : 'badge-date'}">${overdue ? 'Overdue: ' : ''}${due}</span>` : '';

  const starred = !!t.is_accomplishment;
  const starTitle = starred ? 'Unflag as accomplishment' : 'Flag as accomplishment (include in status report)';

  return `
    <div class="task${starred ? ' task-accomplishment' : ''}" draggable="true" data-id="${t.id}">
      <div class="task-title">${escHtml(t.title)}</div>
      <div class="task-meta">
        <span class="badge priority-${t.priority}">${t.priority}</span>
        ${allBoardsMode ? `<span class="badge badge-board">${escHtml(boards.find(b => b.id === t.board_id)?.name || '')}</span>` : ''}
        ${dateBadge}
        ${t.recurring ? `<span class="badge badge-recurring">${recurringLabel(t.recurring)}</span>` : ''}
        ${starred ? `<span class="badge badge-accomplishment" title="Flagged as accomplishment">&#9733; Accomplishment</span>` : ''}
      </div>
      ${t.notes ? `<div class="task-notes">${renderNotes(t.notes, t.id)}</div>` : ''}
      <div class="task-actions">
        ${t.created_at ? `<span class="task-created" title="Created ${formatCreated(t.created_at)}">${formatCreated(t.created_at)}</span>` : ''}
        <button class="star-btn${starred ? ' starred' : ''}" data-id="${t.id}" title="${starTitle}">${starred ? '&#9733;' : '&#9734;'}</button>
        ${idx > 0 ? `<button class="btn btn-icon move-btn" data-id="${t.id}" data-dir="-1" title="Move left">&#8592;</button>` : ''}
        ${idx < STATUSES.length - 1 ? `<button class="btn btn-icon move-btn" data-id="${t.id}" data-dir="1" title="Move right">&#8594;</button>` : ''}
        <button class="btn btn-icon edit-task-btn" data-id="${t.id}" title="Edit">&#9998;</button>
        <button class="btn btn-icon duplicate-task-btn" data-id="${t.id}" title="Duplicate">&#x2398;</button>
        <button class="btn btn-icon-danger delete-task-btn" data-id="${t.id}" title="Delete">&#x2715;</button>
      </div>
    </div>
  `;
}

// ── Checklist in notes ────────────────────────────────────────────────────────

const CHECKLIST_RE = /^(\s*)-\s*\[([ xX])\]\s*(.*)$/;

function renderNotes(notes, taskId) {
  return notes.split('\n').map((line, idx) => {
    const m = line.match(CHECKLIST_RE);
    if (m) {
      const checked = m[2].trim().toLowerCase() === 'x';
      return `<label class="note-check${checked ? ' note-check-done' : ''}">
        <input type="checkbox" class="note-checkbox" data-task="${taskId}" data-line="${idx}" ${checked ? 'checked' : ''} />
        <span>${escHtml(m[3])}</span>
      </label>`;
    }
    return line.trim() ? `<div class="note-line">${escHtml(line)}</div>` : '';
  }).join('');
}

function parseNotesForEdit(notes) {
  const items = [];
  const textLines = [];
  for (const line of (notes || '').split('\n')) {
    const m = line.match(CHECKLIST_RE);
    if (m) items.push({ text: m[3], checked: m[2].trim().toLowerCase() === 'x' });
    else textLines.push(line);
  }
  return { text: textLines.join('\n').replace(/\n+$/, ''), items };
}

function serializeNotesFromEdit(text, items) {
  const itemLines = items
    .filter(it => it.text.trim())
    .map(it => `- [${it.checked ? 'x' : ' '}] ${it.text.trim()}`);
  const t = (text || '').trim();
  if (!itemLines.length) return t;
  if (!t) return itemLines.join('\n');
  return t + '\n' + itemLines.join('\n');
}

function checklistRow(item) {
  const row = document.createElement('div');
  row.className = 'checklist-row';
  row.innerHTML = `
    <input type="checkbox" ${item.checked ? 'checked' : ''} />
    <input type="text" class="checklist-text" placeholder="Step" />
    <button type="button" class="btn btn-icon-danger checklist-remove" title="Remove">&#x2715;</button>
  `;
  row.querySelector('.checklist-text').value = item.text;
  return row;
}

function renderChecklistEditor(items) {
  const c = document.getElementById('editChecklist');
  c.innerHTML = '';
  items.forEach(item => c.appendChild(checklistRow(item)));
}

function readChecklistFromEditor() {
  return [...document.querySelectorAll('#editChecklist .checklist-row')].map(row => ({
    text: row.querySelector('.checklist-text').value,
    checked: row.querySelector('input[type=checkbox]').checked,
  }));
}

function resetChecklist(notes) {
  if (!notes) return notes;
  return notes.split('\n').map(line => {
    const m = line.match(CHECKLIST_RE);
    return m ? `${m[1]}- [ ] ${m[3]}` : line;
  }).join('\n');
}

async function toggleChecklistItem(taskId, lineIdx) {
  const t = tasks.find(t => t.id === taskId);
  if (!t || !t.notes) return;
  const lines = t.notes.split('\n');
  const m = lines[lineIdx]?.match(CHECKLIST_RE);
  if (!m) return;
  const checked = m[2].trim().toLowerCase() === 'x';
  lines[lineIdx] = `${m[1]}- [${checked ? ' ' : 'x'}] ${m[3]}`;
  await updateTask(taskId, { notes: lines.join('\n') });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) { return escHtml(s); }

function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// Compact created-date (M/D/YY) from a full timestamp column.
function formatCreated(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return '';
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso + 'T23:59:59') < new Date();
}

// ── Add Task ──────────────────────────────────────────────────────────────────

document.getElementById('addTaskBtn').addEventListener('click', async () => {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { document.getElementById('taskTitle').focus(); return; }

  const status = document.getElementById('taskStatus').value;
  const task = {
    id:         uid(),
    board_id:   boardId,
    title,
    priority:   document.getElementById('taskPriority').value,
    due_date:   document.getElementById('taskDueDate').value || null,
    status,
    recurring:  buildRecurringValue('taskRecurring', 'taskRecurringInterval'),
    notes:      document.getElementById('taskNotes').value.trim(),
    sort_order: nextSortOrder(status),
    is_accomplishment: false,
    created_at: new Date().toISOString(),
  };

  await addTask(task);

  document.getElementById('taskTitle').value     = '';
  document.getElementById('taskDueDate').value   = '';
  document.getElementById('taskNotes').value     = '';
  document.getElementById('taskRecurring').value = '';
  syncIntervalInput('taskRecurring', 'taskRecurringInterval');
  document.getElementById('taskPriority').value  = 'Medium';
  document.getElementById('taskStatus').value    = 'todo';
  document.getElementById('taskTitle').focus();
});

document.getElementById('taskTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addTaskBtn').click();
});

// ── Board controls ────────────────────────────────────────────────────────────

document.getElementById('boardTabs').addEventListener('click', async e => {
  const btn = e.target.closest('.board-tab');
  if (!btn) return;
  const val = btn.dataset.boardId;
  allBoardsMode = val === '__all__';
  if (allBoardsMode) {
    await loadAllTasks();
  } else {
    boardId = val;
    localStorage.setItem('kanban_active_board', boardId);
    await loadTasks();
  }
  renderBoardSelect();
  setAllBoardsUI();
});

document.getElementById('newBoardBtn').addEventListener('click', async () => {
  const name = prompt('Board name:');
  if (name && name.trim()) await createBoard(name.trim());
});

document.getElementById('renameBoardBtn').addEventListener('click', async () => {
  const current = boards.find(b => b.id === boardId)?.name || '';
  const name = prompt('New name:', current);
  if (name && name.trim()) await renameBoard(name.trim());
});

document.getElementById('deleteBoardBtn').addEventListener('click', deleteBoard);

// ── Search / Filter ───────────────────────────────────────────────────────────

document.getElementById('priorityFilter').addEventListener('change', renderAll);

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function nextSortOrder(status, bid = boardId) {
  const siblings = tasks.filter(t => t.status === status && t.board_id === bid);
  const max = siblings.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0);
  return max + 1000;
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.task:not(.dragging)')];
  let closest = { offset: -Infinity, element: null };
  for (const child of cards) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

function computeSortOrder(newStatus, afterElement, draggedTaskId) {
  const siblings = tasks
    .filter(t => t.status === newStatus && t.id !== draggedTaskId)
    .sort((a, b) =>
      (a.sort_order ?? Number.MAX_SAFE_INTEGER) -
      (b.sort_order ?? Number.MAX_SAFE_INTEGER)
    );
  if (!afterElement) {
    const last = siblings[siblings.length - 1];
    return (last?.sort_order ?? 0) + 1000;
  }
  const afterId = afterElement.dataset.id;
  const afterIdx = siblings.findIndex(t => t.id === afterId);
  const nextTask = siblings[afterIdx];
  const prevTask = siblings[afterIdx - 1];
  const nextOrder = nextTask?.sort_order ?? ((prevTask?.sort_order ?? 0) + 2000);
  const prevOrder = prevTask?.sort_order ?? (nextOrder - 2000);
  return (prevOrder + nextOrder) / 2;
}

function onDragStart(e) {
  draggedId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  draggedId = null;
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
  document.querySelectorAll('.task.drop-before').forEach(el => el.classList.remove('drop-before'));
  document.querySelectorAll('.column-body.drop-end').forEach(el => el.classList.remove('drop-end'));
}

document.querySelectorAll('.column').forEach(col => {
  const body = col.querySelector('.column-body');

  col.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('drag-over');

    // Show insertion indicator for reorder-enabled columns
    const status = col.dataset.status;
    if (REORDERABLE.has(status)) {
      const after = getDragAfterElement(body, e.clientY);
      body.querySelectorAll('.task.drop-before').forEach(el => el.classList.remove('drop-before'));
      if (after) {
        after.classList.add('drop-before');
        body.classList.remove('drop-end');
      } else {
        body.classList.add('drop-end');
      }
    }
  });

  col.addEventListener('dragleave', e => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
      body.querySelectorAll('.task.drop-before').forEach(el => el.classList.remove('drop-before'));
      body.classList.remove('drop-end');
    }
  });

  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    body.querySelectorAll('.task.drop-before').forEach(el => el.classList.remove('drop-before'));
    body.classList.remove('drop-end');
    if (!draggedId) return;

    const newStatus = col.dataset.status;
    const task = tasks.find(t => t.id === draggedId);
    if (!task) return;

    const changes = {};
    if (task.status !== newStatus) changes.status = newStatus;

    if (REORDERABLE.has(newStatus)) {
      const after = getDragAfterElement(body, e.clientY);
      changes.sort_order = computeSortOrder(newStatus, after, draggedId);
    } else if (changes.status) {
      // Moving into Done: append to end so re-promotion preserves a sensible order
      changes.sort_order = nextSortOrder(newStatus, task.board_id);
    }

    if (Object.keys(changes).length) updateTask(draggedId, changes);
  });
});

// ── Edit Modal ────────────────────────────────────────────────────────────────

let editingTaskId = null;

function openEditModal(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  editingTaskId = id;
  document.getElementById('editTitle').value    = t.title;
  document.getElementById('editPriority').value = t.priority;
  document.getElementById('editDueDate').value  = t.due_date || '';
  document.getElementById('editStatus').value   = t.status;
  const { unit: rUnit, n: rN } = parseRecurring(t.recurring || '');
  document.getElementById('editRecurring').value = rUnit;
  document.getElementById('editRecurringInterval').value = rN;
  syncIntervalInput('editRecurring', 'editRecurringInterval');
  document.getElementById('editAccomplishment').checked = !!t.is_accomplishment;
  const parsed = parseNotesForEdit(t.notes);
  document.getElementById('editNotes').value = parsed.text;
  renderChecklistEditor(parsed.items);
  document.getElementById('editModalBackdrop').classList.add('open');
  document.getElementById('editTitle').focus();
}

function closeEditModal() {
  document.getElementById('editModalBackdrop').classList.remove('open');
  editingTaskId = null;
}

document.getElementById('addChecklistBtn').addEventListener('click', () => {
  const c = document.getElementById('editChecklist');
  const row = checklistRow({ text: '', checked: false });
  c.appendChild(row);
  row.querySelector('.checklist-text').focus();
});

document.getElementById('editChecklist').addEventListener('click', e => {
  const remove = e.target.closest('.checklist-remove');
  if (remove) remove.closest('.checklist-row').remove();
});

document.getElementById('editChecklist').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList.contains('checklist-text')) return;
  e.preventDefault();
  const row = checklistRow({ text: '', checked: false });
  e.target.closest('.checklist-row').after(row);
  row.querySelector('.checklist-text').focus();
});

document.getElementById('editModalCloseBtn').addEventListener('click', closeEditModal);
document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
document.getElementById('editModalBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('editModalBackdrop')) closeEditModal();
});

document.getElementById('editSaveBtn').addEventListener('click', async () => {
  if (!editingTaskId) return;
  const title = document.getElementById('editTitle').value.trim();
  if (!title) { document.getElementById('editTitle').focus(); return; }
  const t = tasks.find(t => t.id === editingTaskId);
  const newStatus = document.getElementById('editStatus').value;
  const notes = serializeNotesFromEdit(
    document.getElementById('editNotes').value,
    readChecklistFromEditor()
  );
  const changes = {
    title,
    priority:  document.getElementById('editPriority').value,
    due_date:  document.getElementById('editDueDate').value || null,
    status:    newStatus,
    recurring: buildRecurringValue('editRecurring', 'editRecurringInterval'),
    notes,
    is_accomplishment: document.getElementById('editAccomplishment').checked,
  };
  if (t && t.status !== newStatus) {
    changes.sort_order = nextSortOrder(newStatus, t.board_id);
  }
  await updateTask(editingTaskId, changes);
  closeEditModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeEditModal();
});

document.getElementById('taskRecurring').addEventListener('change', () => syncIntervalInput('taskRecurring', 'taskRecurringInterval'));
document.getElementById('editRecurring').addEventListener('change', () => syncIntervalInput('editRecurring', 'editRecurringInterval'));

document.getElementById('clearDoneBtn').addEventListener('click', async () => {
  const doneTasks = tasks.filter(t => t.status === 'done' && t.board_id === boardId);
  if (doneTasks.length === 0) return;
  if (!confirm(`Remove all ${doneTasks.length} done task(s)?`)) return;
  if (db) {
    await db.from('tasks').delete().in('id', doneTasks.map(t => t.id));
  }
  tasks = tasks.filter(t => !(t.status === 'done' && t.board_id === boardId));
  if (!db) saveTasks();
  renderAll();
});

// ── Accomplishments Report ────────────────────────────────────────────────────

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeReportRange(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  const end = new Date(today);

  if (preset === 'week') {
    const dow = today.getDay(); // 0=Sun
    start.setDate(today.getDate() - dow);
  } else if (preset === 'lastweek') {
    const dow = today.getDay();
    start.setDate(today.getDate() - dow - 7);
    end.setDate(today.getDate() - dow - 1);
  } else if (preset === 'month') {
    start.setDate(1);
  } else if (preset === 'lastmonth') {
    start.setMonth(today.getMonth() - 1, 1);
    end.setDate(0); // last day of previous month
  } else if (preset === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    start.setMonth(q * 3, 1);
  } else if (preset === 'ytd') {
    start.setMonth(0, 1);
  } else if (preset === 'all') {
    return { start: '', end: '' };
  } else {
    return null; // custom — leave inputs alone
  }
  return { start: isoDate(start), end: isoDate(end) };
}

async function loadAccomplishmentTasks(scope) {
  if (!db) {
    if (scope === 'current') return tasks.filter(t => t.board_id === boardId);
    if (allBoardsMode) return tasks;
    return boards.flatMap(b => JSON.parse(localStorage.getItem(tasksKey(b.id)) || '[]'));
  }
  const query = db.from('tasks').select('*').eq('is_accomplishment', true).eq('status', 'done');
  if (scope === 'current') query.eq('board_id', boardId);
  const { data, error } = await query.order('completed_at', { ascending: true });
  if (error) { alert('Error loading accomplishments: ' + error.message); return []; }
  return data || [];
}

function stripChecklist(notes) {
  if (!notes) return '';
  return notes.split('\n').filter(l => !l.match(CHECKLIST_RE)).join('\n').trim();
}

function buildReport(items, range, scope) {
  const { start, end } = range;
  const inRange = items.filter(t => {
    if (!t.is_accomplishment || t.status !== 'done') return false;
    if (!start && !end) return true;
    const d = t.completed_at;
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });

  const header = [];
  header.push('# Accomplishments Report');
  if (start || end) {
    header.push(`**Period:** ${start || 'earliest'} → ${end || 'today'}`);
  } else {
    header.push('**Period:** All time');
  }
  header.push(`**Scope:** ${scope === 'current' ? (boards.find(b => b.id === boardId)?.name || 'Current board') : 'All boards'}`);
  header.push(`**Total accomplishments:** ${inRange.length}`);
  header.push('');

  if (inRange.length === 0) {
    header.push('_No flagged accomplishments in the selected range._');
    return header.join('\n');
  }

  const byBoard = new Map();
  for (const t of inRange) {
    const name = boards.find(b => b.id === t.board_id)?.name || 'Other';
    if (!byBoard.has(name)) byBoard.set(name, []);
    byBoard.get(name).push(t);
  }

  const sections = [];
  for (const [boardName, list] of byBoard) {
    list.sort((a, b) => (a.completed_at || '').localeCompare(b.completed_at || ''));
    sections.push(`## ${boardName}`);
    sections.push('');
    for (const t of list) {
      const date = t.completed_at ? formatDate(t.completed_at) : '—';
      sections.push(`- **${t.title}** _(${date}${t.priority ? `, ${t.priority}` : ''})_`);
      const note = stripChecklist(t.notes);
      if (note) {
        for (const line of note.split('\n')) {
          if (line.trim()) sections.push(`  - ${line.trim()}`);
        }
      }
    }
    sections.push('');
  }

  return header.concat(sections).join('\n');
}

async function refreshReport() {
  const preset = document.getElementById('reportRangePreset').value;
  const scope = document.getElementById('reportScope').value;
  const startInput = document.getElementById('reportStart');
  const endInput = document.getElementById('reportEnd');

  if (preset !== 'custom') {
    const r = computeReportRange(preset);
    if (r) {
      startInput.value = r.start;
      endInput.value = r.end;
    }
  }

  const range = { start: startInput.value || '', end: endInput.value || '' };
  const items = await loadAccomplishmentTasks(scope);
  const md = buildReport(items, range, scope);
  document.getElementById('reportOutput').value = md;
}

document.getElementById('accomplishmentsBtn').addEventListener('click', async () => {
  document.getElementById('reportModalBackdrop').classList.add('open');
  await refreshReport();
});

function closeReportModal() {
  document.getElementById('reportModalBackdrop').classList.remove('open');
}

document.getElementById('reportModalCloseBtn').addEventListener('click', closeReportModal);
document.getElementById('reportCloseBtn').addEventListener('click', closeReportModal);
document.getElementById('reportModalBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('reportModalBackdrop')) closeReportModal();
});

document.getElementById('reportRangePreset').addEventListener('change', refreshReport);
document.getElementById('reportScope').addEventListener('change', refreshReport);
document.getElementById('reportStart').addEventListener('change', () => {
  document.getElementById('reportRangePreset').value = 'custom';
  refreshReport();
});
document.getElementById('reportEnd').addEventListener('change', () => {
  document.getElementById('reportRangePreset').value = 'custom';
  refreshReport();
});

document.getElementById('reportCopyBtn').addEventListener('click', async () => {
  const text = document.getElementById('reportOutput').value;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('reportCopyBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch (e) {
    document.getElementById('reportOutput').select();
    document.execCommand('copy');
  }
});

// ── Auto-refresh ──────────────────────────────────────────────────────────────
// The board only reflects the DB at load time, so tasks added elsewhere — e.g.
// the action-item extract dropping cards into Pending Approval — don't appear
// until a manual reload. Poll periodically and on tab focus so the board stays
// current, but skip while the user is mid-interaction so nothing is yanked out
// from under them.
const AUTO_REFRESH_MS = 30000;

function boardBusy() {
  if (draggedId) return true;                                   // mid drag-and-drop
  const edit   = document.getElementById('editModalBackdrop');
  const report = document.getElementById('reportModalBackdrop');
  if (edit && edit.classList.contains('open')) return true;     // edit modal open
  if (report && report.classList.contains('open')) return true; // report modal open
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('.task')) return true;     // editing a card inline
  return false;
}

async function autoRefresh() {
  if (!db) return;              // localStorage mode: no external source to poll
  if (document.hidden) return;  // don't poll a backgrounded tab
  if (boardBusy()) return;      // don't disrupt an active interaction
  try {
    if (allBoardsMode) await loadAllTasks();
    else               await loadTasks();
  } catch (e) {
    // transient error — next tick will retry
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefresh(); });
window.addEventListener('focus', autoRefresh);

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const authed = await initSupabase();
  if (authed) {
    await loadBoards();
    setInterval(autoRefresh, AUTO_REFRESH_MS);
  }
})();
