// Site storage for the Badge Tracker (badges.js): sign-in, plus entries in the Supabase
// badge_days table. The shareable copy in badge-tracker-standalone/ uses local-storage.js instead.

// ── Supabase config ───────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';

let db = null;

// ── Auth ─────────────────────────────────────────────────────────────────────
function showApp() { $('loginOverlay').classList.add('hidden'); }
function showLogin(msg) {
  $('loginOverlay').classList.remove('hidden');
  const err = $('loginError');
  if (msg) { err.textContent = msg; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
}

$('loginBtn').addEventListener('click', async () => {
  const btn = $('loginBtn');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) { showLogin('Enter email and password.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { showLogin(error.message); return; }
  showApp();
  await startTracker(supabaseStorage);
});
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
$('signOutBtn').addEventListener('click', async () => { await db.auth.signOut(); showLogin(); });

async function initSupabase() {
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await db.auth.getSession();
    if (!session) { showLogin(); return false; }
    showApp();
    return true;
  } catch (e) {
    setStatus('Supabase unavailable');
    return false;
  }
}

// ── Data ─────────────────────────────────────────────────────────────────────
const supabaseStorage = {
  async load() {
    const { data, error } = await db.from('badge_days').select('day, type, notes').order('day');
    if (error) { setStatus('Load error: ' + error.message); return {}; }
    const loaded = {};
    for (const r of data) loaded[r.day] = { type: r.type, notes: r.notes };
    setStatus(`Synced ${data.length} days`);
    await autofillFridays(loaded);
    return loaded;
  },
  async save(date, type, notes) {
    const { error } = type
      ? await db.from('badge_days').upsert({ day: date, type, notes })
      : await db.from('badge_days').delete().eq('day', date);
    if (error) { alert(`${type ? 'Save' : 'Delete'} failed: ${error.message}`); return false; }
    return true;
  }
};

async function autofillFridays(loaded) {
  // Fill every Friday from 2025-01-01 through today (+90 days lookahead) with 'not_swipe' if no entry exists.
  const start = new Date(2025, 0, 1);
  const end = new Date();
  end.setDate(end.getDate() + 90);
  const rows = [];
  const d = new Date(start);
  while (d <= end) {
    if (d.getDay() === 5) {
      const iso = isoDate(d);
      if (!loaded[iso]) rows.push({ day: iso, type: 'not_swipe', notes: null });
    }
    d.setDate(d.getDate() + 1);
  }
  if (!rows.length) return;
  const { error } = await db.from('badge_days').upsert(rows, { onConflict: 'day', ignoreDuplicates: true });
  if (error) { console.warn('Friday autofill failed:', error.message); return; }
  for (const r of rows) loaded[r.day] = { type: r.type, notes: r.notes };
  setStatus(`Synced ${Object.keys(loaded).length} days (autofilled ${rows.length} Fridays)`);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  if (await initSupabase()) await startTracker(supabaseStorage);
})();
