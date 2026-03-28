const STORAGE_KEY = "kanban-board-v1";

const starterTasks = [
  {
    id: 1,
    title: "Plan next sprint",
    owner: "Steve",
    priority: "High",
    dueDate: "",
    notes: "Review priorities and dependencies.",
    status: "todo",
    createdAt: Date.now() - 50000
  },
  {
    id: 2,
    title: "Draft weekly update",
    owner: "",
    priority: "Medium",
    dueDate: "",
    notes: "",
    status: "doing",
    createdAt: Date.now() - 40000
  },
  {
    id: 3,
    title: "Close completed items",
    owner: "",
    priority: "Low",
    dueDate: "",
    notes: "",
    status: "done",
    createdAt: Date.now() - 30000
  }
];

let tasks = loadTasks();
let searchTerm = "";
let draggedTaskId = null;

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

function getVisibleTasks(status) {
  return tasks
    .filter(task => task.status === status)
    .filter(task => {
      const haystack = [
        task.title,
        task.owner,
        task.priority,
        task.notes,
        formatDueDate(task.dueDate)
      ].join(" ").toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => b.createdAt - a.createdAt);
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

    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        <span class="badge priority-${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
        <span class="badge status-${task.status}">${task.status.toUpperCase()}</span>
        ${ownerText}
        ${dueText ? `<span class="badge">Due: ${escapeHtml(dueText)}</span>` : ""}
      </div>
      ${notesText}
      <div class="task-actions">
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
}

function renderBoard() {
  renderColumn("todo", "todoColumn");
  renderColumn("doing", "doingColumn");
  renderColumn("done", "doneColumn");
}

function addTask() {
  const title = document.getElementById("taskTitle").value.trim();
  const owner = document.getElementById("taskOwner").value.trim();
  const priority = document.getElementById("taskPriority").value;
  const dueDate = document.getElementById("taskDueDate").value;
  const notes = document.getElementById("taskNotes").value.trim();

  if (!title) return;

  tasks.unshift({
    id: nextId(),
    title,
    owner,
    priority,
    dueDate,
    notes,
    status: "todo",
    createdAt: Date.now()
  });

  saveTasks();
  clearForm();
  renderBoard();
}

function clearForm() {
  document.getElementById("taskTitle").value = "";
  document.getElementById("taskOwner").value = "";
  document.getElementById("taskPriority").value = "Medium";
  document.getElementById("taskDueDate").value = "";
  document.getElementById("taskNotes").value = "";
}

function deleteTask(id) {
  tasks = tasks.filter(task => task.id !== id);
  saveTasks();
  renderBoard();
}

function clearBoard() {
  tasks = [];
  localStorage.removeItem(STORAGE_KEY);
  renderBoard();
}

function handleDragStart(event) {
  draggedTaskId = Number(event.currentTarget.dataset.id);
  event.dataTransfer.setData("text/plain", String(draggedTaskId));
}

function moveTask(id, status) {
  tasks = tasks.map(task => {
    if (task.id === id) return { ...task, status };
    return task;
  });
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

document.getElementById("addTaskBtn").addEventListener("click", addTask);
document.getElementById("taskTitle").addEventListener("keydown", event => {
  if (event.key === "Enter") addTask();
});
document.getElementById("searchInput").addEventListener("input", event => {
  searchTerm = event.target.value || "";
  renderBoard();
});
document.getElementById("clearBoardBtn").addEventListener("click", clearBoard);

setupDropZones();
renderBoard();
