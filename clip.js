// ── Supabase config (shared with script.js) ───────────────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

// ── Local copy config ─────────────────────────────────────────────────────────
// Chrome and Edge can write straight into a folder on this Mac through the File
// System Access API (Safari, Firefox and phones cannot, so the option is hidden
// there). The folder the user picks stands in for the Mac mini's projects root,
// and each clip lands in the same subfolder sync/sync.js would use over there.
const LOCAL_BASE_PATH = '/users/steve/workpm/projects';
const NEW_FILES_DIR   = 'New_Files';
const TYPE_FOLDERS    = { slack: 'Slack', email: 'Email', teams: 'Teams', meetings: 'Meetings', documents: 'Documents' };
const LOCAL_SUPPORTED = typeof window.showDirectoryPicker === 'function';
const LOCAL_IDB       = { name: 'clipboard-local', store: 'handles', key: 'projects-root' };

// ── State ─────────────────────────────────────────────────────────────────────
let db        = null;
let projects  = [];
let pendingFiles = [];   // File objects staged for upload
let activeType = 'meetings';
let activeDest = 'new';  // 'new' | 'current'
let localRoot  = null;   // FileSystemDirectoryHandle for this Mac's projects folder, if chosen

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
  await loadLocalRoot();
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

// ── Local copy (this Mac) ─────────────────────────────────────────────────────
// A directory handle survives reloads only if it is stored in IndexedDB, so a
// tiny key/value store holds the one handle this page needs.
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_IDB.name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(LOCAL_IDB.store);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbRun(mode, fn) {
  const idb = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx  = idb.transaction(LOCAL_IDB.store, mode);
    const req = fn(tx.objectStore(LOCAL_IDB.store));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function loadLocalRoot() {
  if (!LOCAL_SUPPORTED) { renderLocalStatus(); return; }
  try {
    localRoot = (await idbRun('readonly', s => s.get(LOCAL_IDB.key))) || null;
  } catch (err) {
    console.warn('Could not restore local folder:', err);
    localRoot = null;
  }
  await renderLocalStatus();
}

async function localPermission() {
  if (!localRoot) return 'none';
  try { return await localRoot.queryPermission({ mode: 'readwrite' }); }
  catch { return 'prompt'; }
}

// Must run inside a click handler: Chrome only shows the permission bubble
// during a user gesture.
async function ensureLocalPermission() {
  if (!localRoot) return false;
  if ((await localPermission()) === 'granted') return true;
  try {
    return (await localRoot.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

async function pickLocalFolder() {
  try {
    const handle = await window.showDirectoryPicker({ id: 'workpm-projects', mode: 'readwrite' });
    localRoot = handle;
    await idbRun('readwrite', s => s.put(handle, LOCAL_IDB.key));
    showMsg(`Clips will also be copied into "${handle.name}" on this Mac.`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') showMsg('Could not use that folder: ' + (err.message || err), 'error');
  }
  await renderLocalStatus();
}

async function allowLocalFolder() {
  const ok = await ensureLocalPermission();
  if (!ok) showMsg('Permission for the local folder was not granted.', 'error');
  await renderLocalStatus();
}

async function clearLocalFolder() {
  localRoot = null;
  try { await idbRun('readwrite', s => s.delete(LOCAL_IDB.key)); } catch {}
  showMsg('Clips will no longer be copied to this Mac.', '');
  await renderLocalStatus();
}

async function renderLocalStatus() {
  const field = document.getElementById('local-field');
  if (!LOCAL_SUPPORTED) { field.hidden = true; return; }
  field.hidden = false;

  const status = document.getElementById('local-status');
  const allow  = document.getElementById('local-allow-btn');
  const pick   = document.getElementById('local-pick-btn');
  const clear  = document.getElementById('local-clear-btn');

  if (!localRoot) {
    status.textContent = 'Off';
    status.className = 'local-status';
    allow.hidden = true; clear.hidden = true;
    pick.textContent = 'Choose folder…';
    return;
  }
  const perm = await localPermission();
  if (perm === 'granted') {
    status.textContent = '✓ ' + localRoot.name;
    status.className = 'local-status ok';
    allow.hidden = true;
  } else {
    status.textContent = localRoot.name + ' · needs permission';
    status.className = 'local-status ask';
    allow.hidden = false;
  }
  clear.hidden = false;
  pick.textContent = 'Change…';
}

// Same rules as sync/sync.js: 'current' → {project}/Current, otherwise
// {project}/{subfolder or New_Files}/{Type}. Returns the path segments under
// the picked root, or null when the project lives outside the default root on
// the Mac mini (a custom base_path), since that has no counterpart here.
function localDirSegments(project, dest, type) {
  if (!project || !project.folder_name) return null;
  const base = (project.base_path || '').replace(/\/+$/, '').toLowerCase();
  if (base && base !== LOCAL_BASE_PATH) return null;
  if (dest === 'current') return [project.folder_name, 'Current'];
  const segs = [project.folder_name, project.subfolder || NEW_FILES_DIR];
  if (TYPE_FOLDERS[type]) segs.push(TYPE_FOLDERS[type]);
  return segs;
}

// Copied from sync/sync.js so both machines produce the same markdown filename.
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

async function writeLocalFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w  = await fh.createWritable();
  await w.write(data);
  await w.close();
}

// Writes the clip into the matching folder on this Mac. `clip` is the row
// Supabase returned, so created_at matches what sync.js will use for the name.
async function writeLocalCopies(clip, project, files) {
  const segs = localDirSegments(project, clip.file_destination, clip.clip_type);
  if (!segs) {
    return { skipped: project?.base_path ? 'project uses a custom base path' : 'project has no folder name' };
  }
  let dir = localRoot;
  for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });

  const written = [];
  if (clip.content && clip.content.trim()) {
    const name = `${clip.created_at.slice(0, 10)}-${slugify(clip.title)}.md`;
    await writeLocalFile(dir, name, clip.content.trim());
    written.push(name);
  }
  for (const f of files) {
    await writeLocalFile(dir, f.name, f);
    written.push(f.name);
  }
  return { written, dir: segs.join('/') };
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

  // Ask for local-folder permission now, while this click still counts as a
  // user gesture. After the uploads finish Chrome would refuse to prompt.
  const copyLocally = await ensureLocalPermission();
  if (localRoot) renderLocalStatus();

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

    // 3. Copy into the matching folder on this Mac (Chrome / Edge, when set up)
    let localNote = '', localFailed = false;
    if (copyLocally) {
      const project = projects.find(p => p.id === projectId);
      try {
        const r = await writeLocalCopies(clip, project, pendingFiles);
        localNote = r.skipped ? ` Not copied to this Mac: ${r.skipped}.` : ` Copied to ${r.dir} on this Mac.`;
      } catch (err) {
        localNote = ` Copy to this Mac failed: ${err.message || err}`;
        localFailed = true;
      }
    } else if (localRoot) {
      localNote = ' Not copied to this Mac: folder permission was not granted.';
      localFailed = true;
    }

    // 4. Reset form
    document.getElementById('clip-title').value = '';
    document.getElementById('clip-content').value = '';
    clearFiles();
    showMsg('Clip saved! Will sync to Mac mini within 5 minutes.' + localNote, localFailed ? 'warning' : 'success');
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

  // Local copy folder (Chrome / Edge only; the field stays hidden elsewhere)
  document.getElementById('local-pick-btn').addEventListener('click', pickLocalFolder);
  document.getElementById('local-allow-btn').addEventListener('click', allowLocalFolder);
  document.getElementById('local-clear-btn').addEventListener('click', clearLocalFolder);

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
