#!/usr/bin/env python3
"""
Smartsheet Export — On-Demand Runner (Mac mini)

Polls the Supabase table `smartsheet_sync_requests` for a queued run created by
the "Run pull now" button on the website's Sheets page. When one appears it
runs the existing export (/Users/steve/scripts/export_plans.py) and writes the
result back so the website can show progress (Queued -> Running -> Done/Error).

Standard library only (urllib) — no pip install needed. Reads the Supabase
service-role key from the same file the clip sync uses; that key bypasses RLS.

Single pass: checks once and exits. Schedule it via a launchd StartInterval
(~60s), the same way the clip sync is scheduled.
"""

import json
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

SUPABASE_URL = "https://sztatmknjyzzyzngvpff.supabase.co"
SERVICE_KEY_FILE = "/Users/steve/.config/worksync/service_key"
EXPORT_SCRIPT = "/Users/steve/scripts/export_plans.py"

with open(SERVICE_KEY_FILE) as _f:
    SERVICE_KEY = _f.read().strip()

REST = SUPABASE_URL + "/rest/v1/smartsheet_sync_requests"
BASE_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": "Bearer " + SERVICE_KEY,
    "Content-Type": "application/json",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _req(method, url, body=None, extra_headers=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(BASE_HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else []


def main():
    # Oldest outstanding request, if any.
    pending = _req("GET", REST + "?status=eq.pending&order=requested_at.asc&limit=1")
    if not pending:
        return
    rid = pending[0]["id"]

    # Claim atomically: PATCH only rows still pending. If another pass already
    # claimed it, PostgREST updates 0 rows and returns [].
    claimed = _req(
        "PATCH",
        REST + "?id=eq.%s&status=eq.pending" % rid,
        {"status": "running", "started_at": _now()},
        {"Prefer": "return=representation"},
    )
    if not claimed:
        return

    # Run the export with the SAME interpreter this poller runs under, so it
    # inherits whatever environment/libraries export_plans.py needs.
    try:
        out = subprocess.run(
            [sys.executable, EXPORT_SCRIPT],
            capture_output=True, text=True, check=True,
        )
        lines = out.stdout.strip().splitlines()
        message = (lines[-1] if lines else "Export finished.")[:300]
        _req("PATCH", REST + "?id=eq.%s" % rid,
             {"status": "done", "finished_at": _now(), "message": message})
    except subprocess.CalledProcessError as e:
        message = ((e.stderr or e.stdout or "Export failed").strip())[-300:]
        _req("PATCH", REST + "?id=eq.%s" % rid,
             {"status": "error", "finished_at": _now(), "message": message})


if __name__ == "__main__":
    main()
