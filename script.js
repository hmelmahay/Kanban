const STORAGE_KEY = "kanban-board-v6";
const DEFAULT_BOARD_ID = "board-1";

const starterData = {
  boards: [
    {
      id: DEFAULT_BOARD_ID,
      name: "Main Board",
      tasks: [
        {
          id: 1,
          title: "Send weekly update",
          priority: "High",
          dueDate: "",
          notes: "Recurring every week.",
          status: "backlog",
          isRecurring: true,
          recurrenceType: "weekly",
          recurrenceInterval: 1,
          recurrenceSourceId: null,
          createdAt: Date.now() - 50000,
          updatedAt: Date.now() - 50000
        },
        {
          id: 2,
          title: "Plan next sprint",
          priority: "Medium",
          dueDate: "",
          notes: "",
          status: "inprogress",
          isRecurring: false,
          recurrenceType: "weekly",
          recurrenceInterval: 1,
          recurrenceSourceId: null,
          createdAt: Date.now() - 40000,
          updatedAt: Date.now() - 40000
        }
      ]
    }
  ],
  activeBoardId: DEFAULT_BOARD_ID,
  formVisible: true
};

let data = loadData();
let searchTerm = "";
let draggedTaskId = null;
let editingTaskId = null;

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.boards) && parsed.boards.length) {
      if (!parsed.activeBoardId) parsed.activeBoardId = parsed.boards[0].id;
      if (typeof parsed.formVisible !== "boolean") parsed.formVisible = true;
      return parsed;
    }
  } catch (e) {}
  return structuredClone(starterData);
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getActiveBoard() {
  return data.boards.find(board => board.id === data.activeBoardId) || data.boards[0];
}

function getTasks() {
  return getActiveBoard().tasks;
}

function setTasks(tasks) {
  getActiveBoard().tasks = tasks;
}

function nextTaskId() {
  const tasks = getTasks();
  return tasks.length ? Math.max(...tasks.map(task => task.id)) + 1 : 1;
}

function nextBoardId() {
  return "board-" + Date.now();
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

function labelForStatus(status) {
  if (status === "backlog") return "Backlog";
  if (status === "inprogress") return "In Progress";
  if (status === "blocked") return "Blocked";
  return "Done";
}

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDueToday(task) {
  return !!task.dueDate && task.dueDate === todayString();
}

function autoMoveDueTodayTasks() {
  let changed = false;

  data.boards.forEach(board => {
    board.tasks = board.tasks.map(task => {
      if (task.status === "backlog" && isDueToday(task)) {
        changed = true;
        return {
          ...task,
          status: "inprogress",
          updatedAt: Date.now()
        };
      }
      return task;
    });
  });

  if (changed) {
    saveData();
  }
}

function matchesFilters(task) {
  const priorityFilter = document.getElementById("priorityFilter").value;

  const haystack = [
    task.title,
    task.priority,
    task.notes,
    formatDueDate(task.dueDate),
    task.status
  ].join(" ").toLowerCase();

  const matchesSearch = haystack.includes(searchTerm.toLowerCase());
  const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;

  return matchesSearch && matchesPriority;
}

function getVisibleTasks(status) {
  return getTasks()
    .filter(task => task.status === status)
    .filter(task => matchesFilters(task))
    .sort((a, b) => {
      const todayA = isDueToday(a) ? 0 : 1;
      const todayB = isDueToday(b) ? 0 : 1;
      if (todayA !== todayB) return todayA - todayB;

      const priorityOrder = { High: 0, Medium: 1, Low: 2 };
      const p = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (p !== 0) return p;

      if (a.dueDate && b.dueDate) {
        const d = a.dueDate.localeCompare(b.dueDate);
        if (d !== 0) return d;
      } else if (a.dueDate) {
        return -1;
      } else if (b.dueDate) {
        return 1;
      }

      return b.updatedAt - a.updatedAt;
    });
}

function buildBoardSelect() {
  const select = document.getElementById("boardSelect");
  select.innerHTML = "";

  data.boards.forEach(board => {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.name;
    select.appendChild(option);
  });

  select.value = data.activeBoardId;
}

function renderStats() {
  const tasks = getTasks();
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
    const notesText = task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : "";
    const recurrenceText = task.isRecurring
      ? `<span class="badge recurrence-badge">${escapeHtml(task.recurrenceType)} • every ${task.recurrenceInterval}</span>`
      : "";
    const todayText = isDueToday(task)
      ? `<span class="badge due-today-badge">Today</span>`
      : "";

    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        <span class="badge priority-${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
        <span class="badge status-${task.status}">${escapeHtml(labelForStatus(task.status))}</span>
        ${dueText ? `<span class="badge">Due: ${escapeHtml(dueText)}</span>` : ""}
        ${todayText}
        ${recurrenceText}
      </div>
      ${notesText}
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
      deleteTask(Number(event.target.dataset.id));
    });
  });

  column.querySelectorAll(".edit-btn").forEach(button => {
    button.addEventListener("click", event => {
      startEdit(Number(event.target.dataset.id));
    });
  });
}

function renderFormVisibility() {
  const formPanel = document.getElementById("taskFormPanel");
  const toggleBtn = document.getElementById("toggleFormBtn");

  formPanel.classList.toggle("hidden", !data.formVisible);
  toggleBtn.textContent = data.formVisible ? "Hide Form" : "Show Form";
}

function renderBoard() {
  autoMoveDueTodayTasks();
  buildBoardSelect();
  renderStats();
  renderFormVisibility();
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
    priority: document.getElementById("taskPriority").value,
    dueDate: document.getElementById("taskDueDate").value,
    status: document.getElementById("taskStatus").value,
    notes: document.getElementById("taskNotes").value.trim(),
    isRecurring,
    recurrenceType: isRecurring ? document.getElementById("taskRecurrenceType").value : "weekly",
    recurrenceInterval: isRecurring ? Math.max(1, Number(document.getElementById("taskRecurrenceInterval").value) || 1) : 1
  };
}

function clearForm() {
  document.getElementById("taskTitle").value = "";
  document.getElementById("taskPriority").value = "Medium";
  document.getElementById("taskDueDate").value = "";
  document.getElementById("taskStatus").value = "backlog";
  document.getElementById("taskNotes").value = "";
  document.getElementById("taskRecurring").checked = false;
  document.getElementById("taskRecurrenceType").value = "weekly";
  document.getElementById("taskRecurrenceInterval").value = 1;
  toggleRecurrenceFields();

  editingTaskId = null;
  document.getElementById("formTitle").textContent = "Add Task";
  document.getElementById("saveTaskBtn").textContent = "Add Task";
  document.getElementById("cancelEditBtn").classList.add("hidden");
}

function saveTask() {
  const form = readForm();
  if (!form.title) return;

  const tasks = getTasks();

  if (editingTaskId === null) {
    tasks.unshift({
      id: nextTaskId(),
      ...form,
      recurrenceSourceId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  } else {
    setTasks(tasks.map(task =>
      task.id === editingTaskId
        ? { ...task, ...form, updatedAt: Date.now() }
        : task
    ));
  }

  saveData();
  clearForm();
  renderBoard();
}

function startEdit(id) {
  const task = getTasks().find(t => t.id === id);
  if (!task) return;

  editingTaskId = id;
  document.getElementById("taskTitle").value = task.title;
  document.getElementById("taskPriority").value = task.priority;
  document.getElementById("taskDueDate").value = task.dueDate;
  document.getElementById("taskStatus").value = task.status;
  document.getElementById("taskNotes").value = task.notes;
  document.getElementById("taskRecurring").checked = !!task.isRecurring;
  document.getElementById("taskRecurrenceType").value = task.recurrenceType || "weekly";
  document.getElementById("taskRecurrenceInterval").value = task.recurrenceInterval || 1;
  toggleRecurrenceFields();

  data.formVisible = true;
  saveData();
  renderFormVisibility();

  document.getElementById("formTitle").textContent = "Edit Task";
  document.getElementById("saveTaskBtn").textContent = "Save Changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("taskTitle").focus();
}

function deleteTask(id) {
  const task = getTasks().find(t => t.id === id);
  if (!task) return;
  if (!window.confirm(`Delete "${task.title}"?`)) return;

  setTasks(getTasks().filter(task => task.id !== id));
  saveData();
  if (editingTaskId === id) clearForm();
  renderBoard();
}

function clearBoardTasks() {
  if (!window.confirm("Clear all tasks in this board?")) return;
  setTasks([]);
  clearForm();
  saveData();
  renderBoard();
}

function handleDragStart(event) {
  draggedTaskId = Number(event.currentTarget.dataset.id);
  event.dataTransfer.setData("text/plain", String(draggedTaskId));
}

function getAnchorDate(task) {
  if (task.dueDate) return new Date(task.dueDate + "T12:00:00");
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsSafe(date, monthsToAdd) {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthsToAdd);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

function addYearsSafe(date, yearsToAdd) {
  const d = new Date(date);
  const originalMonth = d.getMonth();
  const originalDay = d.getDate();
  d.setFullYear(d.getFullYear() + yearsToAdd, originalMonth, 1);
  const lastDay = new Date(d.getFullYear(), originalMonth + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

function computeNextRecurringDate(task) {
  const interval = Math.max(1, Number(task.recurrenceInterval) || 1);
  const base = getAnchorDate(task);
  const result = new Date(base);

  switch (task.recurrenceType) {
    case "daily":
      result.setDate(result.getDate() + interval);
      return formatDateForInput(result);
    case "weekly":
      result.setDate(result.getDate() + interval * 7);
      return formatDateForInput(result);
    case "monthly":
      return formatDateForInput(addMonthsSafe(result, interval));
    case "yearly":
      return formatDateForInput(addYearsSafe(result, interval));
    default:
      result.setDate(result.getDate() + interval * 7);
      return formatDateForInput(result);
  }
}

function recurringChildAlreadyExists(task, nextDueDate) {
  return getTasks().some(existing =>
    existing.recurrenceSourceId === task.id &&
    existing.dueDate === nextDueDate &&
    existing.status !== "done"
  );
}

function createNextRecurringTask(task) {
  if (!task.isRecurring) return;

  const nextDueDate = computeNextRecurringDate(task);
  if (recurringChildAlreadyExists(task, nextDueDate)) return;

  const tasks = getTasks();
  tasks.unshift({
    id: nextTaskId(),
    title: task.title,
    priority: task.priority,
    dueDate: nextDueDate,
    notes: task.notes,
    status: "backlog",
    isRecurring: true,
    recurrenceType: task.recurrenceType,
    recurrenceInterval: task.recurrenceInterval,
    recurrenceSourceId: task.id,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

function moveTask(id, status) {
  const original = getTasks().find(task => task.id === id);
  if (!original) return;

  const wasDone = original.status === "done";
  const becomingDone = status === "done";

  setTasks(getTasks().map(task => {
    if (task.id === id) return { ...task, status, updatedAt: Date.now() };
    return task;
  }));

  if (!wasDone && becomingDone && original.isRecurring) {
    createNextRecurringTask(original);
  }

  saveData();
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
      moveTask(draggedTaskId, column.dataset.status);
    });
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kanban-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = event => {
    try {
      const parsed = JSON.parse(event.target.result);

      if (Array.isArray(parsed)) {
        data = {
          boards: [{ id: DEFAULT_BOARD_ID, name: "Imported Board", tasks: parsed }],
          activeBoardId: DEFAULT_BOARD_ID,
          formVisible: true
        };
      } else if (parsed && Array.isArray(parsed.boards) && parsed.boards.length) {
        data = parsed;
        if (!data.activeBoardId) data.activeBoardId = data.boards[0].id;
        if (typeof data.formVisible !== "boolean") data.formVisible = true;
      } else {
        throw new Error("Invalid backup");
      }

      clearForm();
      saveData();
      renderBoard();
    } catch (err) {
      window.alert("Import failed. Use a valid JSON backup file.");
    }
  };
  reader.readAsText(file);
}

function createBoard() {
  const name = window.prompt("New board name:");
  if (!name || !name.trim()) return;

  const board = {
    id: nextBoardId(),
    name: name.trim(),
    tasks: []
  };

  data.boards.push(board);
  data.activeBoardId = board.id;
  clearForm();
  saveData();
  renderBoard();
}

function renameBoard() {
  const board = getActiveBoard();
  const name = window.prompt("Rename board:", board.name);
  if (!name || !name.trim()) return;

  board.name = name.trim();
  saveData();
  renderBoard();
}

function deleteBoard() {
  if (data.boards.length === 1) {
    window.alert("You need to keep at least one board.");
    return;
  }

  const board = getActiveBoard();
  if (!window.confirm(`Delete board "${board.name}"?`)) return;

  data.boards = data.boards.filter(b => b.id !== board.id);
  data.activeBoardId = data.boards[0].id;
  clearForm();
  saveData();
  renderBoard();
}

function switchBoard(boardId) {
  data.activeBoardId = boardId;
  clearForm();
  saveData();
  renderBoard();
}

function toggleForm() {
  data.formVisible = !data.formVisible;
  saveData();
  renderFormVisibility();
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
document.getElementById("clearBoardBtn").addEventListener("click", clearBoardTasks);
document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("importFile").addEventListener("change", event => {
  importData(event.target.files[0]);
  event.target.value = "";
});
document.getElementById("boardSelect").addEventListener("change", event => {
  switchBoard(event.target.value);
});
document.getElementById("newBoardBtn").addEventListener("click", createBoard);
document.getElementById("renameBoardBtn").addEventListener("click", renameBoard);
document.getElementById("deleteBoardBtn").addEventListener("click", deleteBoard);
document.getElementById("toggleFormBtn").addEventListener("click", toggleForm);

toggleRecurrenceFields();
setupDropZones();
renderBoard();
