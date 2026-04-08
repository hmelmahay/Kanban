// ── Supabase config (shared with script.js) ───────────────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// ── State ─────────────────────────────────────────────────────────────────────
let db        = null;
let projects  = [];
let pendingFiles = [];   // File objects staged for upload
let activeType = 'slack';

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await db.from('projects').select('id').limit(1);
    if (error) throw error;
    setStatus('online');
  } catch {
    setStatus('offline');
  }
  await loadProjects();
  await loadRecentClips();
  setupEventListeners();
}

function setStatus(state) {
  const dot = document.getElementById('sync-status');
  dot.className = 'sync-dot ' + state;
  dot.title = state === 'online' ? 'Connected to Supabase' : 'Offline – check connection';
}

// ── Projects ──────────────────────────────────────────────────────────────────
async function loadProjects() {
  const sel = document.getElementById('project-select');
  if (!db) {
    sel.innerHTML = '<option value="">No connection</option>';
    return;
  }
  const { data, error } = await db.from('projects').select('*').order('name');
  if (error) { console.error(error); return; }
  projects = data || [];
  sel.innerHTML = '<option value="">Select project…</option>' +
    projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  renderProjectsTable();
}

function renderProjectsTable() {
  const tbody = document.getElementById('projects-tbody');
  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--muted);padding:8px">No projects yet.</td></tr>';
    return;
  }
  tbody.innerHTML = projects.map(p => `
    <tr data-id="${p.id}">
      <td>${escHtml(p.name)}</td>
      <td class="folder-name">${escHtml(p.folder_name)}</td>
      <td><button class="btn btn-danger" onclick="deleteProject('${p.id}')">Remove</button></td>
    </tr>
  `).join('');
}

async function addProject() {
  const name   = document.getElementById('new-project-name').value.trim();
  const folder = document.getElementById('new-folder-name').value.trim();
  if (!name || !folder) return alert('Both fields are required.');
  if (!db) return alert('Not connected to Supabase.');
  const { error } = await db.from('projects').insert({ name, folder_name: folder });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('new-project-name').value = '';
  document.getElementById('new-folder-name').value = '';
  await loadProjects();
}

async function deleteProject(id) {
  if (!confirm('Remove this project? Existing clips will not be deleted.')) return;
  await db.from('projects').delete().eq('id', id);
  await loadProjects();
}

// ── File handling ─────────────────────────────────────────────────────────────
function addFiles(files) {
  for (const f of files) {
    if (!pendingFiles.find(p => p.name === f.name && p.size === f.size)) {
      pendingFiles.push(f);
    }
  }
  renderFileList();
}

function removeFile(index) {
  pendingFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  const ul = document.getElementById('file-list');
  if (!pendingFiles.length) { ul.innerHTML = ''; return; }
  ul.innerHTML = pendingFiles.map((f, i) => `
    <li class="file-item">
      <span class="file-item-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="file-item-size">${formatSize(f.size)}</span>
      <button class="btn btn-danger" onclick="removeFile(${i})">✕</button>
    </li>
  `).join('');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Save clip ─────────────────────────────────────────────────────────────────
async function saveClip() {
  const projectId = document.getElementById('project-select').value;
  const title     = document.getElementById('clip-title').value.trim();
  const content   = document.getElementById('clip-content').value.trim();

  if (!projectId) return showMsg('Please select a project.', 'error');
  if (!title)     return showMsg('Title is required.', 'error');
  if (!db)        return showMsg('Not connected to Supabase.', 'error');

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  showMsg('', '');

  try {
    // 1. Upload files first using a temp ID, so we don't create a dangling clip row on failure
    const tempId = crypto.randomUUID();
    const uploadedPaths = [];
    for (const file of pendingFiles) {
      const filePath = `${tempId}/${file.name}`;
      const { error: upErr } = await db.storage
        .from('clip-attachments')
        .upload(filePath, file, { upsert: true });
      if (upErr) throw new Error(`Failed to upload "${file.name}": ${upErr.message}`);
      uploadedPaths.push(filePath);
    }

    // 2. Insert clip row now that files are safely uploaded
    const { data: clip, error: insertErr } = await db
      .from('clips')
      .insert({ title, content, clip_type: activeType, project_id: projectId, file_paths: uploadedPaths, synced: false })
      .select()
      .single();
    if (insertErr) throw insertErr;

    // 4. Reset form
    document.getElementById('clip-title').value = '';
    document.getElementById('clip-content').value = '';
    pendingFiles = [];
    renderFileList();
    showMsg('Clip saved! Will sync to Mac mini within 5 minutes.', 'success');
    await loadRecentClips();

  } catch (err) {
    showMsg('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Clip';
  }
}

function showMsg(text, type) {
  const el = document.getElementById('save-msg');
  el.textContent = text;
  el.className = 'save-msg ' + type;
}

// ── Recent clips ──────────────────────────────────────────────────────────────
async function loadRecentClips() {
  if (!db) return;
  const { data, error } = await db
    .from('clips')
    .select('*, projects(name)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.error(error); return; }
  renderClipsList(data || []);
}

function renderClipsList(clips) {
  const container = document.getElementById('clips-list');
  if (!clips.length) {
    container.innerHTML = '<div class="empty-state">No clips yet.</div>';
    return;
  }
  container.innerHTML = clips.map(c => {
    const date = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const projectName = c.projects?.name || 'Unknown';
    const filesNote  = c.file_paths?.length ? `📎 ${c.file_paths.length} file${c.file_paths.length > 1 ? 's' : ''}` : '';
    return `
      <div class="clip-card">
        <div class="clip-card-header">
          <div class="clip-card-title" title="${escHtml(c.title)}">${escHtml(c.title)}</div>
          <button class="btn btn-danger" onclick="deleteClip('${c.id}', ${JSON.stringify(c.file_paths || [])})">✕</button>
        </div>
        <div class="clip-card-meta">
          <span class="badge badge-${c.clip_type}">${c.clip_type}</span>
          <span>${escHtml(projectName)}</span>
          <span>${date}</span>
          <span class="badge ${c.synced ? 'badge-synced' : 'badge-pending'}">${c.synced ? 'synced' : 'pending'}</span>
        </div>
        ${filesNote ? `<div class="clip-attachments">${filesNote}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ── Delete clip ───────────────────────────────────────────────────────────────
async function deleteClip(id, filePaths) {
  if (!confirm('Delete this clip?')) return;
  // Remove storage files first
  for (const path of filePaths) {
    await db.storage.from('clip-attachments').remove([path]);
  }
  await db.from('clips').delete().eq('id', id);
  await loadRecentClips();
}

// ── Event listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  // Type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeType = btn.dataset.type;
    });
  });

  // Save button
  document.getElementById('save-btn').addEventListener('click', saveClip);

  // File input
  document.getElementById('file-input').addEventListener('change', e => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  // Drag & drop
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(Array.from(e.dataTransfer.files));
  });

  // Projects toggle
  document.getElementById('projects-toggle').addEventListener('click', () => {
    const panel = document.getElementById('projects-panel');
    const icon  = document.querySelector('.toggle-icon');
    const open  = panel.style.display === 'none';
    panel.style.display = open ? 'flex' : 'none';
    icon.classList.toggle('open', open);
  });

  // Add project
  document.getElementById('add-project-btn').addEventListener('click', addProject);
  document.getElementById('new-folder-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addProject();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
