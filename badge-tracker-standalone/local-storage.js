// Storage for the shareable Badge Tracker (built into "Badge Tracker.html" by build.py): entries
// stay in this browser's localStorage on the user's own computer, and Back up / Restore write and
// read a JSON file on their drive.
const DAYS_KEY = 'badge_days_v1';   // same key as the June 2026 standalone, so its entries carry over

function writeDays(map) {
  try {
    localStorage.setItem(DAYS_KEY, JSON.stringify(map));
  } catch (e) {
    alert('Could not save: this browser is blocking storage for this file. Try opening it in Chrome or Edge.');
    return false;
  }
  setStatus(`${plural(Object.keys(map).length, 'day')} tracked · saved in this browser`);
  return true;
}

const localStore = {
  async load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(DAYS_KEY)) || {}; } catch (e) { /* nothing saved yet */ }
    setStatus(`${plural(Object.keys(saved).length, 'day')} tracked · saved in this browser`);
    return saved;
  },
  async save(date, type, notes) {
    const next = { ...days };
    if (type) next[date] = { type, notes };
    else delete next[date];
    return writeDays(next);
  }
};

// ── Back up / Restore ────────────────────────────────────────────────────────
document.querySelector('.settings').insertAdjacentHTML('beforeend', `
  <span class="settings-actions">
    <button id="backupBtn" class="btn btn-outline" title="Save your entries and targets to a file">Back up</button>
    <button id="restoreBtn" class="btn btn-outline" title="Load entries and targets from a backup file">Restore</button>
    <input id="restoreFile" type="file" accept=".json,application/json" hidden />
  </span>`);

function backupJSON() {
  return JSON.stringify({ app: 'Badge Tracker', version: 1, savedAt: new Date().toISOString(), settings, days }, null, 2);
}

$('backupBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([backupJSON()], { type: 'application/json' }));
  a.download = `badge-tracker-backup-${isoDate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Replaces every entry and target with the backup's, after a confirm.
function restoreFrom(text) {
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  const entries = data && data.days && typeof data.days === 'object' ? Object.entries(data.days) : null;
  const valid = entries && entries.every(([d, rec]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) && rec && Object.hasOwn(DAY_LABELS, rec.type));
  if (!valid) { alert('That file is not a Badge Tracker backup.'); return false; }
  if (!confirm(`Replace your ${plural(Object.keys(days).length, 'day')} with the ${plural(entries.length, 'day')} in this backup?`)) return false;
  const restored = {};
  for (const [d, rec] of entries) restored[d] = { type: rec.type, notes: rec.notes || null };
  if (!writeDays(restored)) return false;
  days = restored;
  for (const [k, [, min, max]] of Object.entries(SETTING_FIELDS)) {
    const v = data.settings && data.settings[k];
    if (Number.isFinite(v) && v >= min && v <= max) settings[k] = v;
  }
  saveSettings();
  render();
  return true;
}

$('restoreBtn').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) restoreFrom(await file.text());
});

startTracker(localStore);
