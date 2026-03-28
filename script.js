const STORAGE_KEY = "kanban-board-v3";

const starterTasks = [
  {
    id: 1,
    title: "Send weekly update",
    owner: "Steve",
    priority: "High",
    dueDate: "",
    notes: "Recurring every Friday.",
    status: "backlog",
    isRecurring: true,
    recurrenceInterval: 1,
    recurrenceDay: 5,
    recurrenceSourceId: null,
    createdAt: Date.now() - 50000,
    updatedAt: Date.now() - 50000
  },
  {
    id: 2,
    title: "Plan next sprint",
    owner: "Steve",
    priority: "Medium",
    dueDate: "",
    notes: "",
    status: "inprogress",
    isRecurring: false,
    recurrenceInterval: 1,
    recurrenceDay: 1,
    recurrenceSourceId: null,
    createdAt: Date.now() - 40000,
    updatedAt: Date.now() - 40000
  }
];

let tasks = loadTasks();
let searchTerm = "";
let draggedTaskId = null;
let editingTaskId = null;

function loadTasks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return starterTasks;
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function nextId() {
  return tasks.length ? Math.max(...tasks.map(task => task.id)) + 1 : 1;
}

function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(value + "T12:00:00");
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function weekdayLabel(day) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(day)] || "";
}

function labelForStatus(status) {
  if (status === "backlog") return "Backlog";
  if (status === "inprogress") return "In Progress";
  if (status === "blocked") return "Blocked";
  return "Done";
}

function matchesFilters(task) {
  const priorityFilter = document.getElementById("priorityFilter").value;
  const ownerFilter = document.getElementById("ownerFilter").value;

  const haystack = [
    task.title,
    task.owner,
    task.priority,
    task.notes,
    formatDueDate(task.dueDate),
    task.status
  ].join(" ").toLowerCase();

  const matchesSearch = haystack.includes(searchTerm.toLowerCase());
  const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
  const matchesOwner = ownerFilter === "all" || (task.owner || "") === ownerFilter;

  return matchesSearch && matchesPriority && matchesOwner;
}

function getVisibleTasks(status) {
  return tasks
    .filter(task => task.status === status)
    .filter(task => matchesFilters(task))
    .sort((a, b) => {
      const priorityOrder = { High: 0, Medium: 1, Low: 2 };
      const p = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (p !== 0) return p;
      return b.updatedAt - a.updatedAt;
    });
}

function buildOwnerFilter() {
  const ownerFilter = document.getElementById("ownerFilter");
  const currentValue = ownerFilter.value;
  const owners = [...new Set(tasks.map(task => (task.owner || "").trim()).filter(Boolean))].sort();

  ownerFilter.innerHTML = `<option value="all">All Owners</option>`;
  owners.forEach(owner => {
    const option = document.createElement("option");
    option.value = owner;
    option.textContent = owner;
    ownerFilter.appendChild(option);
  });

  const values = ["all", ...owners];
  ownerFilter.value = values.includes(currentValue) ? currentValue : "all";
}

function renderStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === "done").length;
  const blocked = tasks.filter(t => t.status === "blocked").length;
  const open = total - done;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statOpen").textContent = open;
  document.getElementById("statBlocked").textContent = blocked;
  document.getElementById("statDone").textContent = done;
}

function renderColumn(status, elementId) {
  const column = document.getElementById(elementId);
  const visible = getVisibleTasks(status);

  document.getElementById(`count-${status}`).textContent = visible.length;
  column.innerHTML = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No tasks here.";
    column.appendChild(empty);
    return;
  }

  visible.forEach(task => {
    const card = document.createElement("div");
    card.className = "task";
    card.draggable = true;
    card.dataset.id = String(task.id);

    const dueText = formatDueDate(task.dueDate);
    const ownerText = task.owner ? `<span class="badge">Owner: ${escapeHtml(task.owner)}</span>` : "";
    const notesText = task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : "";
    const updatedText = new Date(task.updatedAt).toLocaleString();
    const recurrenceText = task.isRecurring
      ? `<span class="badge recurrence-badge">Weekly • every ${task.recurrenceInterval} wk • ${weekdayLabel(task.recurrenceDay)}</span>`
      : "";

    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        <span class="badge priority-${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
        <span class="badge status-${task.status}">${escapeHtml(labelForStatus(task.status))}</span>
        ${ownerText}
        ${dueText ? `<span class="badge">Due: ${escapeHtml(dueText)}</span>` : ""}
        ${recurrenceText}
      </div>
      ${notesText}
      <div class="task-footer">Updated: ${escapeHtml(updatedText)}</div>
      <div class="task-actions">
        <button class="btn btn-secondary edit-btn" data-id="${task.id}">Edit</button>
        <button class="btn btn-danger delete-btn" data-id="${task.id}">Delete</button>
      </div>
    `;

    card.addEventListener("dragstart", handleDragStart);
    column.appendChild(card);
  });

  column.querySelectorAll(".delete-btn").forEach(button => {
    button.addEventListener("click", event => {
      const id = Number(event.target.dataset.id);
      deleteTask(id);
    });
  });

  column.querySelectorAll(".edit-btn").forEach(button => {
    button.addEventListener("click", event => {
      const id = Number(event.target.dataset.id);
      startEdit(id);
    });
  });
}

function renderBoard() {
  buildOwnerFilter();
  renderStats();
  renderColumn("backlog", "backlogColumn");
  renderColumn("inprogress", "inprogressColumn");
  renderColumn("blocked", "blockedColumn");
  renderColumn("done", "doneColumn");
}

function toggleRecurrenceFields() {
  const recurring = document.getElementById("taskRecurring").checked;
  document.getElementById("recurrenceFields").classList.toggle("hidden", !recurring);
}

function readForm() {
  const isRecurring = document.getElementById("taskRecurring").checked;
  return {
    title: document.getElementById("taskTitle").value.trim(),
    owner: document.getElementById("taskOwner").value.trim(),
    priority: document.getElementById("taskPriority").value,
    dueDate: document.getElementById("taskDueDate").value,
    status: document.getElementById("taskStatus").value,
    notes: document.getElementById("taskNotes").value.trim(),
    isRecurring,
    recurrenceInterval: isRecurring ? Math.max(1, Number(document.getElementById("taskRecurrenceInterval").value) || 1) : 1,
    recurrenceDay: isRecurring ? Number(document.getElementById("taskRecurrenceDay").value) : 0
  };
}

function clearForm() {
  document.getElementById("taskTitle").value = "";
  document.getElementById("taskOwner").value = "";
  document.getElementById("taskPriority").value = "Medium";
  document.getElementById("taskDueDate").value = "";
  document.getElementById("taskStatus").value = "backlog";
  document.getElementById("taskNotes").value = "";
  document.getElementById("taskRecurring").checked = false;
  document.getElementById("taskRecurrenceInterval").value = 1;
  document.getElementById("taskRecurrenceDay").value = 5;
  toggleRecurrenceFields();

  editingTaskId = null;
  document.getElementById("formTitle").textContent = "Add Task";
  document.getElementById("saveTaskBtn").textContent = "Add Task";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

function saveTask() {
  const form = readForm();
  if (!form.title) return;

  if (editingTaskId === null) {
    tasks.unshift({
      id: nextId(),
      ...form,
      recurrenceSourceId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  } else {
    tasks = tasks.map(task =>
      task.id === editingTaskId
        ? {
            ...task,
            ...form,
            updatedAt: Date.now()
          }
        : task
    );
  }

  saveTasks();
  clearForm();
  renderBoard();
}

function startEdit(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  editingTaskId = id;
  document.getElementById("taskTitle").value = task.title;
  document.getElementById("taskOwner").value = task.owner;
  document.getElementById("taskPriority").value = task.priority;
  document.getElementById("taskDueDate").value = task.dueDate;
  document.getElementById("taskStatus").value = task.status;
  document.getElementById("taskNotes").value = task.notes;
  document.getElementById("taskRecurring").checked = !!task.isRecurring;
  document.getElementById("taskRecurrenceInterval").value = task.recurrenceInterval || 1;
  document.getElementById("taskRecurrenceDay").value = String(task.recurrenceDay ?? 5);
  toggleRecurrenceFields();

  document.getElementById("formTitle").textContent = "Edit Task";
  document.getElementById("saveTaskBtn").textContent = "Save Changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("taskTitle").focus();
}

function deleteTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const ok = window.confirm(`Delete "${task.title}"?`);
  if (!ok) return;

  tasks = tasks.filter(task => task.id !== id);
  saveTasks();
  if (editingTaskId === id) clearForm();
  renderBoard();
}

function clearBoard() {
  const ok = window.confirm("Clear the full board?");
  if (!ok) return;

  tasks = [];
  localStorage.removeItem(STORAGE_KEY);
  clearForm();
  renderBoard();
}

function handleDragStart(event) {
  draggedTaskId = Number(event.currentTarget.dataset.id);
  event.dataTransfer.setData("text/plain", String(draggedTaskId));
}

function getAnchorDate(task) {
  if (task.dueDate) {
    return new Date(task.dueDate + "T12:00:00");
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}

function computeNextWeeklyDate(task) {
  const interval = Math.max(1, Number(task.recurrenceInterval) || 1);
  const targetDay = Number(task.recurrenceDay);
  const base = getAnchorDate(task);

  const result = new Date(base);
  result.setDate(result.getDate() + 1);

  while (result.getDay() !== targetDay) {
    result.setDate(result.getDate() + 1);
  }

  if (interval > 1) {
    result.setDate(result.getDate() + (interval - 1) * 7);
  }

  const year = result.getFullYear();
  const month = String(result.getMonth() + 1).padStart(2, "0");
  const day = String(result.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recurringChildAlreadyExists(task, nextDueDate) {
  return tasks.some(existing =>
    existing.recurrenceSourceId === task.id &&
    existing.dueDate === nextDueDate &&
    existing.status !== "done"
  );
}

function createNextRecurringTask(task) {
  if (!task.isRecurring) return;

  const nextDueDate = computeNextWeeklyDate(task);

  if (recurringChildAlreadyExists(task, nextDueDate)) return;

  tasks.unshift({
    id: nextId(),
    title: task.title,
    owner: task.owner,
    priority: task.priority,
    dueDate: nextDueDate,
    notes: task.notes,
    status: "backlog",
    isRecurring: true,
    recurrenceInterval: task.recurrenceInterval,
    recurrenceDay: task.recurrenceDay,
    recurrenceSourceId: task.id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

function moveTask(id, status) {
  const original = tasks.find(task => task.id === id);
  if (!original) return;

  const wasDone = original.status === "done";
  const becomingDone = status === "done";

  tasks = tasks.map(task => {
    if (task.id === id) {
      return { ...task, status, updatedAt: Date.now() };
    }
    return task;
  });

  if (!wasDone && becomingDone && original.isRecurring) {
    createNextRecurringTask(original);
  }

  saveTasks();
  renderBoard();
}

function setupDropZones() {
  document.querySelectorAll(".column").forEach(column => {
    column.addEventListener("dragover", event => {
      event.preventDefault();
      column.classList.add("drag-over");
    });

    column.addEventListener("dragleave", () => {
      column.classList.remove("drag-over");
    });

    column.addEventListener("drop", event => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const status = column.dataset.status;
      moveTask(draggedTaskId, status);
    });
  });
}

function exportTasks() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kanban-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importTasks(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = event => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (!Array.isArray(parsed)) throw new Error("Invalid backup");
      tasks = parsed;
      saveTasks();
      clearForm();
      renderBoard();
    } catch (err) {
      window.alert("Import failed. Use a valid JSON backup file.");
    }
  };
  reader.readAsText(file);
}

document.getElementById("saveTaskBtn").addEventListener("click", saveTask);
document.getElementById("cancelEditBtn").addEventListener("click", clearForm);
document.getElementById("taskRecurring").addEventListener("change", toggleRecurrenceFields);
document.getElementById("taskTitle").addEventListener("keydown", event => {
  if (event.key === "Enter") saveTask();
});
document.getElementById("searchInput").addEventListener("input", event => {
  searchTerm = event.target.value || "";
  renderBoard();
});
document.getElementById("priorityFilter").addEventListener("change", renderBoard);
document.getElementById("ownerFilter").addEventListener("change", renderBoard);
document.getElementById("clearBoardBtn").addEventListener("click", clearBoard);
document.getElementById("exportBtn").addEventListener("click", exportTasks);
document.getElementById("importFile").addEventListener("change", event => {
  importTasks(event.target.files[0]);
  event.target.value = "";
});

toggleRecurrenceFields();
setupDropZones();
renderBoard();
