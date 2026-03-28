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
let formVisible = true;
let draggedId   = null;

const BOARDS_KEY = 'kanban_boards_v2';
const tasksKey   = id => `kanban_tasks_v2_${id}`;

// ── Supabase init ─────────────────────────────────────────────────────────────

async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    // Verify connection
    const { error } = await db.from('boards').select('id').limit(1);
    if (error) throw error;
    setStatus('Connected to Supabase');
    return true;
  } catch (e) {
    console.warn('Supabase unavailable, using localStorage:', e.message);
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

  renderBoardSelect();
  const savedId = localStorage.getItem('kanban_active_board');
  boardId = boards.find(b => b.id === savedId) ? savedId : boards[0].id;
  document.getElementById('boardSelect').value = boardId;
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
  document.getElementById('boardSelect').value = boardId;
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
  document.getElementById('boardSelect').value = boardId;
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
  document.getElementById('boardSelect').value = boardId;
  await loadTasks();
}

function renderBoardSelect() {
  const sel = document.getElementById('boardSelect');
  sel.innerHTML = boards.map(b =>
    `<option value="${escAttr(b.id)}">${escHtml(b.name)}</option>`
  ).join('');
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

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
  const today = new Date().toISOString().split('T')[0];
  const toMove = tasks.filter(t => t.status === 'todo' && t.due_date === today);
  for (const t of toMove) {
    await updateTask(t.id, { status: 'doing' });
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
  if (db) {
    const { error } = await db.from('tasks').update(changes).eq('id', id);
    if (error) { alert('Error updating task: ' + error.message); return; }
  }
  const t = tasks.find(t => t.id === id);
  if (t) Object.assign(t, changes);
  if (!db) saveTasks();

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
      notes:      t.notes,
      created_at: new Date().toISOString(),
    });
    return; // addTask calls renderAll
  }

  renderAll();
}

function nextDueDate(iso, freq) {
  const d = new Date(iso + 'T00:00:00');
  if (freq === 'daily')   d.setDate(d.getDate() + 1);
  if (freq === 'weekly')  d.setDate(d.getDate() + 7);
  if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

async function deleteTask(id) {
  if (db) {
    const { error } = await db.from('tasks').delete().eq('id', id);
    if (error) { alert('Error deleting task: ' + error.message); return; }
  }
  tasks = tasks.filter(t => t.id !== id);
  if (!db) saveTasks();
  renderAll();
}

function saveTasks() {
  localStorage.setItem(tasksKey(boardId), JSON.stringify(tasks));
}

// ── Render ────────────────────────────────────────────────────────────────────

const STATUSES = ['todo', 'doing', 'done'];

function renderAll() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const pFilter = document.getElementById('priorityFilter').value;

  const visible = tasks.filter(t => {
    const matchQ = !query ||
      t.title.toLowerCase().includes(query) ||
      (t.notes && t.notes.toLowerCase().includes(query));
    const matchP = !pFilter || t.priority === pFilter;
    return matchQ && matchP;
  });

  // Stats
  document.getElementById('statTotal').textContent   = tasks.length;
  document.getElementById('statOpen').textContent    = tasks.filter(t => t.status === 'todo').length;
  document.getElementById('statBlocked').textContent = tasks.filter(t => t.status === 'doing').length;
  document.getElementById('statDone').textContent    = tasks.filter(t => t.status === 'done').length;

  STATUSES.forEach(status => {
    const col = document.getElementById('col-' + status);
    const colTasks = visible.filter(t => t.status === status);
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

    col.querySelectorAll('.delete-task-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteTask(e.currentTarget.dataset.id);
      });
    });

    col.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { id, dir } = e.currentTarget.dataset;
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const idx = STATUSES.indexOf(task.status);
        const next = STATUSES[idx + Number(dir)];
        if (next) updateTask(id, { status: next });
      });
    });
  });
}

function renderTask(t) {
  const idx = STATUSES.indexOf(t.status);
  const due = t.due_date ? formatDate(t.due_date) : null;
  const overdue = isOverdue(t.due_date);

  return `
    <div class="task" draggable="true" data-id="${t.id}">
      <div class="task-title">${escHtml(t.title)}</div>
      <div class="task-meta">
        <span class="badge priority-${t.priority}">${t.priority}</span>
        ${due ? `<span class="badge ${overdue ? 'badge-overdue' : 'badge-date'}">${overdue ? 'Overdue: ' : ''}${due}</span>` : ''}
        ${t.recurring ? `<span class="badge badge-recurring">${t.recurring.charAt(0).toUpperCase() + t.recurring.slice(1)}</span>` : ''}
      </div>
      ${t.notes ? `<div class="task-notes">${escHtml(t.notes)}</div>` : ''}
      <div class="task-actions">
        ${idx > 0 ? `<button class="btn btn-icon move-btn" data-id="${t.id}" data-dir="-1" title="Move left">&#8592;</button>` : ''}
        ${idx < STATUSES.length - 1 ? `<button class="btn btn-icon move-btn" data-id="${t.id}" data-dir="1" title="Move right">&#8594;</button>` : ''}
        <button class="btn btn-icon-danger delete-task-btn" data-id="${t.id}" title="Delete">&#x2715;</button>
      </div>
    </div>
  `;
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

function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso + 'T23:59:59') < new Date();
}

// ── Add Task ──────────────────────────────────────────────────────────────────

document.getElementById('addTaskBtn').addEventListener('click', async () => {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { document.getElementById('taskTitle').focus(); return; }

  const task = {
    id:         uid(),
    board_id:   boardId,
    title,
    priority:   document.getElementById('taskPriority').value,
    due_date:   document.getElementById('taskDueDate').value || null,
    status:     document.getElementById('taskStatus').value,
    recurring:  document.getElementById('taskRecurring').value,
    notes:      document.getElementById('taskNotes').value.trim(),
    created_at: new Date().toISOString(),
  };

  await addTask(task);

  document.getElementById('taskTitle').value     = '';
  document.getElementById('taskDueDate').value   = '';
  document.getElementById('taskNotes').value     = '';
  document.getElementById('taskRecurring').value = '';
  document.getElementById('taskPriority').value  = 'Medium';
  document.getElementById('taskStatus').value    = 'backlog';
  document.getElementById('taskTitle').focus();
});

document.getElementById('taskTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addTaskBtn').click();
});

// ── Board controls ────────────────────────────────────────────────────────────

document.getElementById('boardSelect').addEventListener('change', async e => {
  boardId = e.target.value;
  localStorage.setItem('kanban_active_board', boardId);
  await loadTasks();
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

// ── Header controls ───────────────────────────────────────────────────────────

document.getElementById('toggleFormBtn').addEventListener('click', () => {
  formVisible = !formVisible;
  document.getElementById('formBar').style.display = formVisible ? '' : 'none';
  document.getElementById('toggleFormBtn').textContent = formVisible ? 'Hide Form' : 'Show Form';
});

document.getElementById('clearTasksBtn').addEventListener('click', async () => {
  if (tasks.length === 0) return;
  if (!confirm('Delete all tasks on this board?')) return;
  if (db) {
    await db.from('tasks').delete().eq('board_id', boardId);
  }
  tasks = [];
  if (!db) saveTasks();
  renderAll();
});

// ── Export / Import ───────────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
  const board = boards.find(b => b.id === boardId);
  const payload = { board: board?.name || 'Board', tasks };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kanban-${(board?.name || 'board').replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const imported = Array.isArray(data) ? data : data.tasks || [];
    if (!imported.length) { alert('No tasks found in file.'); return; }
    if (!confirm(`Import ${imported.length} task(s) into current board?`)) return;
    for (const t of imported) {
      await addTask({ ...t, id: uid(), board_id: boardId, created_at: new Date().toISOString() });
    }
  } catch {
    alert('Could not parse file. Make sure it is a valid JSON export.');
  }
  e.target.value = '';
});

// ── Search / Filter ───────────────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('input', renderAll);
document.getElementById('priorityFilter').addEventListener('change', renderAll);

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function onDragStart(e) {
  draggedId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  draggedId = null;
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
}

document.querySelectorAll('.column').forEach(col => {
  col.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('drag-over');
  });

  col.addEventListener('dragleave', e => {
    if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });

  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    if (!draggedId) return;
    const newStatus = col.dataset.status;
    const task = tasks.find(t => t.id === draggedId);
    if (task && task.status !== newStatus) updateTask(draggedId, { status: newStatus });
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  await initSupabase();
  await loadBoards();
})();
