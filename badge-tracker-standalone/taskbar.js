// Windows taskbar button for the shareable Badge Tracker (built in by build.py). The button is a
// shortcut that opens this file as an Edge or Chrome app window at #badge-in, and arriving that
// way badges you in for today. "Taskbar button" in My targets walks through making it.
const BROWSER_EXE = {
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
};

async function badgeInFromLink() {
  if (location.hash !== '#badge-in') return;
  try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { location.hash = ''; }
  const todayISO = isoDate(new Date());
  const badged = () => !!days[todayISO] && days[todayISO].type === 'swipe';
  if (badged()) { $('heroStatus').textContent = '✅ Already badged in today'; return; }
  await upsertDay(todayISO, 'swipe', null);
  if (badged()) $('heroStatus').textContent = '✅ Badged in today, from your taskbar button';
}
trackerReady.then(badgeInFromLink);
// Also when the tracker is already open and the button only changes its #, never before entries load.
addEventListener('hashchange', () => trackerReady.then(badgeInFromLink));

// ── Setup help ───────────────────────────────────────────────────────────────
function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'chrome';
  return null;
}

// The shortcut target: this browser, opening this file as an app window at #badge-in.
function taskbarTarget(browser) {
  let url = location.href.split('#')[0];
  try { url = decodeURI(url); } catch (e) { /* keep it encoded */ }
  return `"${BROWSER_EXE[browser]}" --app="${url}#badge-in"`;
}

document.head.insertAdjacentHTML('beforeend', `<style>
  .taskbar-card { max-width: 560px; }
  .taskbar-card p { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
  .taskbar-card ol { margin-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .taskbar-target { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; }
  .taskbar-target code { flex: 1; background: var(--surface2); border: 1px solid var(--border2); border-radius: 4px;
    padding: 6px 8px; font-size: 12px; word-break: break-all; user-select: all; }
</style>`);

document.body.insertAdjacentHTML('beforeend', `
  <div id="taskbarModal" class="modal hidden">
    <div class="modal-card taskbar-card">
      <div class="modal-title">Badge in from the Windows taskbar</div>
      <p>Make this button once. After that, one click opens the tracker and marks today as badged in.</p>
      <ol id="taskbarSteps">
        <li>Right-click an empty spot on your desktop and choose <b>New › Shortcut</b>.</li>
        <li>Paste this line into the box and click <b>Next</b>:
          <div class="taskbar-target"><code id="taskbarTarget"></code><button id="taskbarCopy" class="btn btn-outline">Copy</button></div>
        </li>
        <li>Name it <b>Badge In</b> and click <b>Finish</b>.</li>
        <li>Right-click the new shortcut and choose <b>Show more options › Pin to taskbar</b> (on Windows 10, just
          <b>Pin to taskbar</b>). You can then delete the desktop shortcut.</li>
      </ol>
      <p id="taskbarNote"></p>
      <div class="modal-actions"><button id="taskbarClose" class="btn btn-outline">Close</button></div>
    </div>
  </div>`);

function openTaskbarHelp() {
  const browser = browserName();
  const keep = ' Keep Badge Tracker.html where it is; if you move it, make the button again.';
  $('taskbarSteps').hidden = !browser;
  if (browser) $('taskbarTarget').textContent = taskbarTarget(browser);
  $('taskbarNote').textContent = browser === 'edge'
    ? 'The button opens Microsoft Edge, the browser you have open now, so your entries stay in one place.' + keep
    : browser === 'chrome'
      ? 'The button opens Google Chrome, the browser you have open now, so your entries stay in one place. '
        + 'If Windows says it can\'t find chrome.exe, Chrome is installed just for your account: start the line with '
        + 'C:\\Users\\<your name>\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe instead.' + keep
      : 'Open Badge Tracker.html in Microsoft Edge or Google Chrome to set up the button.';
  $('taskbarModal').classList.remove('hidden');
}

$('taskbarCopy').addEventListener('click', async () => {
  const btn = $('taskbarCopy');
  try {
    await navigator.clipboard.writeText($('taskbarTarget').textContent);
    btn.textContent = 'Copied';
  } catch (e) {
    getSelection().selectAllChildren($('taskbarTarget'));
    btn.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 2500);
});
$('taskbarClose').addEventListener('click', () => $('taskbarModal').classList.add('hidden'));

if (/Windows/.test(navigator.userAgent)) {
  document.querySelector('.settings-actions').insertAdjacentHTML('afterbegin',
    '<button id="taskbarBtn" class="btn btn-outline" title="Make a Windows taskbar button that badges you in">Taskbar button</button>');
  $('taskbarBtn').addEventListener('click', openTaskbarHelp);
}
