const supabaseUrl = window.SUPABASE_URL || "{{SUPABASE_URL}}";
const supabaseAnonKey = window.SUPABASE_ANON_KEY || "{{SUPABASE_ANON_KEY}}";

// Vercel env vars are not directly available in plain browser JS.
// Put your real values here once after deploy, OR move to a build-based setup later.
// For now, replace the placeholders below with your actual values if needed.
const SUPABASE_URL =
  supabaseUrl === "{{SUPABASE_URL}}"
    ? "https://sztatmknjyzzyzngvpff.supabase.co"
    : supabaseUrl;

const SUPABASE_ANON_KEY =
  supabaseAnonKey === "{{SUPABASE_ANON_KEY}}"
    ? "sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB"
    : supabaseAnonKey;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let data = {
  boards: [],
  activeBoardId: null,
  formVisible: true
};

let searchTerm = "";
let draggedTaskId = null;
let editingTaskId = null;

function getActiveBoard() {
  return data.boards.find(board => board.id === data.activeBoardId) || data.boards[0] || null;
}

function getTasks() {
  const board = getActiveBoard();
  return board ? board.tasks : [];
}

function setTasks(tasks) {
  const board = getActiveBoard();
  if (board) board.tasks = tasks;
}

function formatDueDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
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
  return !!task.due_date && task.due_date === todayString();
}

function normalizeTask(row) {
  return {
    id: row.id,
    board_id: row.board_id,
    title: row.title,
    priority: row.priority,
    due_date: row.due_date,
    notes: row.notes || "",
    status: row.status,
    is_recurring: !!row.is_recurring,
    recurrence_type: row.recurrence_type || "weekly",
    recurrence_interval: row.recurrence_interval || 1,
    recurrence_source_id: row.recurrence_source_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function ensureMainBoard() {
  const { data: boards, error } = await supabase
    .from("boards")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    alert("Could not load boards from Supabase.");
    return [];
  }

  if (boards.length) return boards;

  const { data: inserted, error: insertError } = await supabase
    .from("boards")
    .insert([{ name: "Main Board" }])
    .select();

  if (insertError) {
    console.error(insertError);
    alert("Could not create the initial board.");
    return [];
  }

  return inserted || [];
}

async function loadData() {
  const boards = await ensureMainBoard();
  if (!boards.length) return;

  const boardIds = boards.map(b => b.id);

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .in("board_id", boardIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert("Could not load tasks from Supabase.");
    return;
  }

  data.boards = boards.map(board => ({
    id: board.id,
    name: board.name,
    created_at: board.created_at,
    tasks: (tasks || []).filter(task => task.board_id === board.id).map(normalizeTask)
  }));

  if (!data.activeBoardId || !data.boards.some(b => b.id === data.activeBoardId)) {
    data.activeBoardId = data.boards[0].id;
  }

  await autoMoveDueTodayTasks();
  renderBoard();
}

async function refreshData() {
  await loadData();
}

async function autoMoveDueTodayTasks() {
  const updates = [];

  data.boards.forEach(board => {
    board.tasks.forEach(task => {
      if (task.status === "backlog" && isDueToday(task)) {
        updates.push({ id: task.id, status: "inprogress" });
        task.status = "inprogress";
      }
    });
  });

  if (!updates.length) return;

  for (const item of updates) {
    await supabase
      .from("tasks")
      .update({ status: item.status, updated_at: new Date().toISOString() })
      .eq("id", item.id);
  }
}

function matchesFilters(task) {
  const priorityFilter = document.getElementById("priorityFilter").value;

  const haystack = [
    task.title,
    task.priority,
    task.notes,
    formatDueDate(task.due_date),
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

      if (a.due_date && b.due_date) {
        const d = a.due_date.localeCompare(b.due_date);
        if (d !== 0) return d;
      } else if (a.due_date) {
        return -1;
      } else if (b.due_date) {
        return 1;
      }

      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
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

  if (data.activeBoardId) select.value = data.activeBoardId;
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

    const dueText = formatDueDate(task.due_date);
    const notesText = task.notes ? `<div class="task-notes">${escapeHtml(task.notes)}</div>` : "";
    const recurrenceText = task.is_recurring
      ? `<span class="badge recurrence-badge">${escapeHtml(task.recurrence_type)} • every ${task.recurrence_interval}</span>`
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
      deleteTask(event.target.dataset.id);
    });
  });

  column.querySelectorAll(".edit-btn").forEach(button => {
    button.addEventListener("click", event => {
      startEdit(event.target.dataset.id);
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
    due_date: document.getElementById("taskDueDate").value || null,
    status: document.getElementById("taskStatus").value,
    notes: document.getElementById("taskNotes").value.trim(),
    is_recurring: isRecurring,
    recurrence_type: isRecurring ? document.getElementById("taskRecurrenceType").value : "weekly",
    recurrence_interval: isRecurring ? Math.max(1, Number(document.getElementById("taskRecurrenceInterval").value) || 1) : 1
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

async function saveTask() {
  const form = readForm();
  if (!form.title) return;

  const board = getActiveBoard();
  if (!board) return;

  if (editingTaskId === null) {
    const payload = {
      board_id: board.id,
      ...form,
      recurrence_source_id: null
    };

    const { error } = await supabase.from("tasks").insert([payload]);
    if (error) {
      console.error(error);
      alert("Could not save task.");
      return;
    }
  } else {
    const { error } = await supabase
      .from("tasks")
      .update({
        ...form,
        updated_at: new Date().toISOString()
      })
      .eq("id", editingTaskId);

    if (error) {
      console.error(error);
      alert("Could not update task.");
      return;
    }
  }

  clearForm();
  await refreshData();
}

function startEdit(id) {
  const task = getTasks().find(t => t.id === id);
  if (!task) return;

  editingTaskId = id;
  document.getElementById("taskTitle").value = task.title;
  document.getElementById("taskPriority").value = task.priority;
  document.getElementById("taskDueDate").value = task.due_date || "";
  document.getElementById("taskStatus").value = task.status;
  document.getElementById("taskNotes").value = task.notes || "";
  document.getElementById("taskRecurring").checked = !!task.is_recurring;
  document.getElementById("taskRecurrenceType").value = task.recurrence_type || "weekly";
  document.getElementById("taskRecurrenceInterval").value = task.recurrence_interval || 1;
  toggleRecurrenceFields();

  data.formVisible = true;
  renderFormVisibility();

  document.getElementById("formTitle").textContent = "Edit Task";
  document.getElementById("saveTaskBtn").textContent = "Save Changes";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("taskTitle").focus();
}

async function deleteTask(id) {
  const task = getTasks().find(t => t.id === id);
  if (!task) return;
  if (!window.confirm(`Delete "${task.title}"?`)) return;

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("Could not delete task.");
    return;
  }

  if (editingTaskId === id) clearForm();
  await refreshData();
}

async function clearBoardTasks() {
  const board = getActiveBoard();
  if (!board) return;
  if (!window.confirm("Clear all tasks in this board?")) return;

  const { error } = await supabase.from("tasks").delete().eq("board_id", board.id);
  if (error) {
    console.error(error);
    alert("Could not clear board.");
    return;
  }

  clearForm();
  await refreshData();
}

function handleDragStart(event) {
  draggedTaskId = event.currentTarget.dataset.id;
  event.dataTransfer.setData("text/plain", String(draggedTaskId));
}

function getAnchorDate(task) {
  if (task.due_date) return new Date(`${task.due_date}T12:00:00`);
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
  const interval = Math.max(1, Number(task.recurrence_interval) || 1);
  const base = getAnchorDate(task);
  const result = new Date(base);

  switch (task.recurrence_type) {
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
    existing.recurrence_source_id === task.id &&
    existing.due_date === nextDueDate &&
    existing.status !== "done"
  );
}

async function createNextRecurringTask(task) {
  if (!task.is_recurring) return;

  const nextDueDate = computeNextRecurringDate(task);
  if (recurringChildAlreadyExists(task, nextDueDate)) return;

  const payload = {
    board_id: task.board_id,
    title: task.title,
    priority: task.priority,
    due_date: nextDueDate,
    notes: task.notes,
    status: "backlog",
    is_recurring: true,
    recurrence_type: task.recurrence_type,
    recurrence_interval: task.recurrence_interval,
    recurrence_source_id: task.id
  };

  const { error } = await supabase.from("tasks").insert([payload]);
  if (error) {
    console.error(error);
  }
}

async function moveTask(id, status) {
  const original = getTasks().find(task => task.id === id);
  if (!original) return;

  const wasDone = original.status === "done";
  const becomingDone = status === "done";

  const { error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Could not move task.");
    return;
  }

  if (!wasDone && becomingDone && original.is_recurring) {
    await createNextRecurringTask(original);
  }

  await refreshData();
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

    column.addEventListener("drop", async event => {
      event.preventDefault();
      column.classList.remove("drag-over");
      await moveTask(draggedTaskId, column.dataset.status);
    });
  });
}

function exportData() {
  const exportPayload = {
    boards: data.boards.map(board => ({
      id: board.id,
      name: board.name,
      tasks: board.tasks
    })),
    activeBoardId: data.activeBoardId,
    formVisible: data.formVisible
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kanban-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async event => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (!parsed || !Array.isArray(parsed.boards)) throw new Error("Invalid backup");

      for (const board of parsed.boards) {
        const { data: insertedBoard, error: boardError } = await supabase
          .from("boards")
          .insert([{ name: board.name }])
          .select()
          .single();

        if (boardError) throw boardError;

        const tasks = (board.tasks || []).map(task => ({
          board_id: insertedBoard.id,
          title: task.title,
          priority: task.priority || "Medium",
          due_date: task.due_date || task.dueDate || null,
          notes: task.notes || "",
          status: task.status || "backlog",
          is_recurring: !!(task.is_recurring ?? task.isRecurring),
          recurrence_type: task.recurrence_type || task.recurrenceType || "weekly",
          recurrence_interval: task.recurrence_interval || task.recurrenceInterval || 1,
          recurrence_source_id: null
        }));

        if (tasks.length) {
          const { error: taskError } = await supabase.from("tasks").insert(tasks);
          if (taskError) throw taskError;
        }
      }

      await refreshData();
    } catch (err) {
      console.error(err);
      alert("Import failed. Use a valid JSON backup file.");
    }
  };
  reader.readAsText(file);
}

async function createBoard() {
  const name = window.prompt("New board name:");
  if (!name || !name.trim()) return;

  const { error } = await supabase.from("boards").insert([{ name: name.trim() }]);
  if (error) {
    console.error(error);
    alert("Could not create board.");
    return;
  }

  clearForm();
  await refreshData();

  const newest = data.boards.find(b => b.name === name.trim());
  if (newest) {
    data.activeBoardId = newest.id;
    renderBoard();
  }
}

async function renameBoard() {
  const board = getActiveBoard();
  if (!board) return;

  const name = window.prompt("Rename board:", board.name);
  if (!name || !name.trim()) return;

  const { error } = await supabase
    .from("boards")
    .update({ name: name.trim() })
    .eq("id", board.id);

  if (error) {
    console.error(error);
    alert("Could not rename board.");
    return;
  }

  await refreshData();
}

async function deleteBoard() {
  const board = getActiveBoard();
  if (!board) return;

  if (data.boards.length === 1) {
    alert("You need to keep at least one board.");
    return;
  }

  if (!window.confirm(`Delete board "${board.name}"?`)) return;

  const { error } = await supabase.from("boards").delete().eq("id", board.id);
  if (error) {
    console.error(error);
    alert("Could not delete board.");
    return;
  }

  clearForm();
  await refreshData();
}

function switchBoard(boardId) {
  data.activeBoardId = boardId;
  clearForm();
  renderBoard();
}

function toggleForm() {
  data.formVisible = !data.formVisible;
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
loadData();
