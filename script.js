const STORAGE_KEY = 'kanban_tasks_v1';

let tasks = [];
let draggedId = null;

// ── Persistence ─────────────────────────────────────────────────────────────

function load() {
  try {
    tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    tasks = [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso + 'T23:59:59') < new Date();
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const filtered = query
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(query) ||
        (t.owner && t.owner.toLowerCase().includes(query)) ||
        (t.notes && t.notes.toLowerCase().includes(query))
      )
    : tasks;

  ['todo', 'doing', 'done'].forEach(status => {
    const col = document.getElementById(status + 'Column');
    const colTasks = filtered.filter(t => t.status === status);
    document.getElementById('count-' + status).textContent =
      tasks.filter(t => t.status === status).length;

    if (colTasks.length === 0) {
      col.innerHTML = `<div class="empty-state">No tasks yet</div>`;
      return;
    }

    col.innerHTML = colTasks.map(renderTask).join('');

    col.querySelectorAll('.task').forEach(el => {
      el.addEventListener('dragstart', onDragStart);
      el.addEventListener('dragend', onDragEnd);
    });

    col.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const id = e.currentTarget.dataset.id;
        tasks = tasks.filter(t => t.id !== id);
        save();
        renderAll();
      });
    });

    col.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const { id, dir } = e.currentTarget.dataset;
        const order = ['todo', 'doing', 'done'];
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const idx = order.indexOf(task.status);
        const next = order[idx + Number(dir)];
        if (next) {
          task.status = next;
          save();
          renderAll();
        }
      });
    });
  });
}

function renderTask(t) {
  const priorityClass = `priority-${t.priority.toLowerCase()}`;
  const statusClass = `status-${t.status}`;
  const due = t.dueDate ? formatDate(t.dueDate) : null;
  const overdue = isOverdue(t.dueDate);
  const order = ['todo', 'doing', 'done'];
  const idx = order.indexOf(t.status);

  return `
    <div class="task" draggable="true" data-id="${t.id}">
      <div class="task-title">${escHtml(t.title)}</div>
      <div class="task-meta">
        <span class="badge ${priorityClass}">${t.priority}</span>
        <span class="badge ${statusClass}">${statusLabel(t.status)}</span>
        ${t.owner ? `<span class="badge" style="background:#f1f5f9;color:#475569">${escHtml(t.owner)}</span>` : ''}
        ${due ? `<span class="badge" style="background:${overdue ? '#fee2e2' : '#f1f5f9'};color:${overdue ? '#b91c1c' : '#475569'}">${overdue ? 'Overdue: ' : ''}${due}</span>` : ''}
      </div>
      ${t.notes ? `<div class="task-notes">${escHtml(t.notes)}</div>` : ''}
      <div class="task-actions">
        ${idx > 0 ? `<button class="btn btn-secondary move-btn" data-id="${t.id}" data-dir="-1" title="Move left">&#8592;</button>` : ''}
        ${idx < 2 ? `<button class="btn btn-secondary move-btn" data-id="${t.id}" data-dir="1" title="Move right">&#8594;</button>` : ''}
        <button class="btn btn-danger delete-btn" data-id="${t.id}" title="Delete task">&#x2715;</button>
      </div>
    </div>
  `;
}

function statusLabel(s) {
  return { todo: 'To Do', doing: 'Doing', done: 'Done' }[s] || s;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Add Task ─────────────────────────────────────────────────────────────────

document.getElementById('addTaskBtn').addEventListener('click', () => {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) {
    document.getElementById('taskTitle').focus();
    return;
  }
  tasks.push({
    id: uid(),
    title,
    owner: document.getElementById('taskOwner').value.trim(),
    priority: document.getElementById('taskPriority').value,
    dueDate: document.getElementById('taskDueDate').value,
    notes: document.getElementById('taskNotes').value.trim(),
    status: 'todo',
    createdAt: new Date().toISOString(),
  });
  save();
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskOwner').value = '';
  document.getElementById('taskPriority').value = 'Medium';
  document.getElementById('taskDueDate').value = '';
  document.getElementById('taskNotes').value = '';
  renderAll();
});

document.getElementById('taskTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addTaskBtn').click();
});

// ── Clear Board ───────────────────────────────────────────────────────────────

document.getElementById('clearBoardBtn').addEventListener('click', () => {
  if (tasks.length === 0) return;
  if (confirm('Clear all tasks? This cannot be undone.')) {
    tasks = [];
    save();
    renderAll();
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('input', renderAll);

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function onDragStart(e) {
  draggedId = e.currentTarget.dataset.id;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd(e) {
  e.currentTarget.style.opacity = '';
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
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
    }
  });

  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    if (!draggedId) return;
    const newStatus = col.dataset.status;
    const task = tasks.find(t => t.id === draggedId);
    if (task && task.status !== newStatus) {
      task.status = newStatus;
      save();
      renderAll();
    }
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

load();
renderAll();
