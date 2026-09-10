// ── Supabase config (shared with script.js) ───────────────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// ── State ─────────────────────────────────────────────────────────────────────
let db        = null;
let projects  = [];
let pendingFiles = [];   // File objects staged for upload
let activeType = 'meetings';
let activeDest = 'new';  // 'new' | 'current'

// ── Auth ──────────────────────────────────────────────────────────────────────
function showApp() { document.getElementById('loginOverlay').classList.add('hidden'); }
function showLogin(msg) {
  const ov = document.getElementById('loginOverlay');
  ov.classList.remove('hidden');
  const err = document.getElementById('loginError');
  if (msg) { err.textContent = msg; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
}

async function startup() {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const btn = document.getElementById('loginBtn');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { showLogin('Enter email and password.'); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Sign In';
    if (error) { showLogin(error.message); return; }
    showApp();
    await init();
  });
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await db.auth.signOut();
    showLogin();
  });

  const { data: { session } } = await db.auth.getSession();
  if (!session) { showLogin(); return; }
  showApp();
  await init();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    if (!db) db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
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
  const defaultId = projects.find(p => p.name === 'WorkPM')?.id || '';
  sel.innerHTML = projects.map(p =>
    `<option value="${p.id}" ${p.id === defaultId ? 'selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');
}

// ── File handling ─────────────────────────────────────────────────────────────
const IMG_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/svg+xml': 'svg'
};

function isImage(file) {
  return !!file && typeof file.type === 'string' && file.type.startsWith('image/');
}

// Clipboard images arrive with no name, or a generic "image.png", so give each
// one a unique, sortable filename before it gets staged.
function namePastedImage(blob, seq) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = IMG_EXT[blob.type] || (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  const name = `pasted-${stamp}${seq ? '-' + (seq + 1) : ''}.${ext}`;
  try {
    return new File([blob], name, { type: blob.type, lastModified: Date.now() });
  } catch {
    blob.name = name;   // very old Safari, where the File constructor is missing
    return blob;
  }
}

function addFiles(files) {
  for (const f of files) {
    if (!pendingFiles.find(p => p.name === f.name && p.size === f.size)) {
      if (isImage(f)) f._preview = URL.createObjectURL(f);
      pendingFiles.push(f);
    }
  }
  renderFileList();
}

function removeFile(index) {
  const [gone] = pendingFiles.splice(index, 1);
  if (gone && gone._preview) URL.revokeObjectURL(gone._preview);
  renderFileList();
}

function clearFiles() {
  pendingFiles.forEach(f => { if (f._preview) URL.revokeObjectURL(f._preview); });
  pendingFiles = [];
  renderFileList();
}

function renderFileList() {
  const ul = document.getElementById('file-list');
  if (!pendingFiles.length) { ul.innerHTML = ''; return; }
  ul.innerHTML = pendingFiles.map((f, i) => `
    <li class="file-item">
      ${f._preview ? `<img class="file-thumb" src="${f._preview}" alt="" />` : ''}
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

// ── Clipboard paste ───────────────────────────────────────────────────────────
function stageImages(blobs, source) {
  const before = pendingFiles.length;
  addFiles(blobs.map((b, i) => namePastedImage(b, blobs.length > 1 ? i : 0)));
  const n = pendingFiles.length - before;
  if (n > 0) showMsg(`${n} image${n > 1 ? 's' : ''} added from ${source}.`, 'success');
}

function handlePaste(e) {
  // Ignore pastes while the login card is up
  if (!document.getElementById('loginOverlay').classList.contains('hidden')) return;

  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return;

  const images = [];
  if (cd.items) {
    for (const item of cd.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) images.push(blob);
      }
    }
  }
  if (!images.length && cd.files) {
    for (const f of cd.files) if (isImage(f)) images.push(f);
  }
  if (!images.length) return;

  // If the clipboard also carries text, let that text land in the focused field
  // as usual and pick up the image alongside it.
  const text = cd.getData ? (cd.getData('text/plain') || '') : '';
  if (!text.trim()) e.preventDefault();

  stageImages(images, 'clipboard');
}

// iOS and other touch browsers only fire a paste event inside a focused field,
// so give them a button that reads the clipboard directly.
async function pasteFromClipboardButton() {
  try {
    const items = await navigator.clipboard.read();
    const blobs = [];
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) blobs.push(await item.getType(type));
    }
    if (!blobs.length) { showMsg('No image on the clipboard.', 'error'); return; }
    stageImages(blobs, 'clipboard');
  } catch (err) {
    showMsg('Could not read the clipboard: ' + (err.message || err), 'error');
  }
}

// ── Save clip ─────────────────────────────────────────────────────────────────
async function saveClip() {
  const projectId  = document.getElementById('project-select').value;
  const content    = document.getElementById('clip-content').value.trim();
  const hasFiles   = pendingFiles.length > 0;

  // Auto-derive title from first filename if no title entered and files are attached
  let title = document.getElementById('clip-title').value.trim();
  if (!title && hasFiles) {
    title = pendingFiles[0].name.replace(/\.[^/.]+$/, ''); // strip extension
  }

  if (!projectId)          return showMsg('Please select a project.', 'error');
  if (!title && content)   return showMsg('Title is required when pasting content.', 'error');
  if (!title && !hasFiles) return showMsg('Add a title, paste content, or attach a file.', 'error');
  if (!db)                 return showMsg('Not connected to Supabase.', 'error');

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
      .insert({ title, content, clip_type: activeType, file_destination: activeDest, project_id: projectId, file_paths: uploadedPaths, synced: false })
      .select()
      .single();
    if (insertErr) {
      // Clean up orphaned uploads before surfacing the error
      if (uploadedPaths.length) {
        await db.storage.from('clip-attachments').remove(uploadedPaths);
      }
      throw insertErr;
    }

    // 4. Reset form
    document.getElementById('clip-title').value = '';
    document.getElementById('clip-content').value = '';
    clearFiles();
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

  // Destination buttons (New File / Current File)
  document.querySelectorAll('.dest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dest-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDest = btn.dataset.dest;
    });
  });

  // Save button
  document.getElementById('save-btn').addEventListener('click', saveClip);

  // File input
  document.getElementById('file-input').addEventListener('change', e => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  // Paste images from the clipboard (Cmd/Ctrl+V anywhere on the page)
  document.addEventListener('paste', handlePaste);

  // Explicit paste button, shown only where the async clipboard API exists
  const pasteBtn = document.getElementById('paste-btn');
  if (navigator.clipboard && navigator.clipboard.read) {
    pasteBtn.addEventListener('click', pasteFromClipboardButton);
  } else {
    pasteBtn.style.display = 'none';
  }

  // Drag & drop
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(Array.from(e.dataTransfer.files));
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
document.addEventListener('DOMContentLoaded', startup);
