Badge Tracker — Standalone Local Version
========================================

To use:
1. Unzip this folder anywhere on your PC.
2. Double-click badges.html. It opens in your default browser. No
   internet connection or account is required.
3. Click "Badge In Today" each day you swipe into the office, or
   "Mark today as…" to log PTO / Flex / Float / Holiday / etc.

Data is saved automatically to your browser's localStorage. That means:
- The data lives only in the browser you opened the file with. If you
  open it in Chrome, you won't see entries you logged in Firefox.
- Clearing browser data ("cookies and site data") will wipe it. Keep
  a backup if that matters (you can just copy the folder somewhere safe;
  the data file lives inside the browser, not in this folder).

Customizing your allotments:
Open badges.js in any text editor and change the values near the top:

  const QUOTA = { pto: 20, flex: 8, float: 3 };
  const QUARTER_MIN = 33;

Tiles at a glance:
- Avg/week (this month) — green if >= 2.5, red below.
- Avg/week (this quarter) — same threshold.
- This Quarter — count vs. quarterly target.
- This Month — raw count for the calendar month.
- PTO / Flex / Float — usage vs. allotment.
