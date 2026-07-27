#!/usr/bin/env node
/**
 * Smartsheet Export
 *
 * Reads the enabled rows from Supabase `smartsheet_exports` and downloads each
 * sheet from the Smartsheet API as an .xlsx into the WorkPM folders. This is the
 * real work the 6pm pull (and the "Run pull now" button) performs.
 *
 * Secrets — read from files so they stay out of the repo:
 *   /Users/steve/.config/worksync/service_key       Supabase service-role key
 *                                                    (already used by the clip sync)
 *   /Users/steve/.config/worksync/smartsheet_token  Smartsheet API access token
 *       Generate at: Smartsheet → Account → Personal Settings → API Access →
 *       "Generate new access token", then:
 *         mkdir -p ~/.config/worksync
 *         printf '%s' 'YOUR_TOKEN' > ~/.config/worksync/smartsheet_token
 *
 * Output folders (override via env if your paths differ):
 *   WORKPM_CURRENT    default /Users/steve/workpm/Current    (destination = 'current')
 *   WORKPM_REFERENCE  default /Users/steve/workpm/Reference  (destination = 'reference')
 *
 * Run:  node smartsheet-export.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY = fs.readFileSync('/Users/steve/.config/worksync/service_key', 'utf8').trim();
const SMARTSHEET_TOKEN = fs.readFileSync('/Users/steve/.config/worksync/smartsheet_token', 'utf8').trim();

const DEST = {
  current:   process.env.WORKPM_CURRENT   || '/Users/steve/workpm/Current',
  reference: process.env.WORKPM_REFERENCE || '/Users/steve/workpm/Reference',
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// Strip characters that are illegal in filenames.
function sanitize(name) {
  return String(name).replace(/[\/\\:*?"<>|]/g, '_').trim();
}

// Download one sheet as xlsx. Resolves { buffer, filename } (filename from the
// Content-Disposition header, which Smartsheet sets to the sheet's title).
function downloadSheet(sheetId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.smartsheet.com',
      path: `/2.0/sheets/${sheetId}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${SMARTSHEET_TOKEN}`,
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    }, res => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', d => (body += d));
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
        return;
      }
      const cd = res.headers['content-disposition'] || '';
      const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^"';]+)"?/i);
      const filename = m ? decodeURIComponent(m[1]) : `${sheetId}.xlsx`;
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), filename }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: rows, error } = await db
    .from('smartsheet_exports')
    .select('sheet_id, label, destination, enabled, sort_order')
    .eq('enabled', true)
    .order('sort_order', { ascending: true });
  if (error) { log('ERROR loading export list: ' + error.message); process.exit(1); }
  if (!rows || !rows.length) { log('No enabled sheets — nothing to export.'); return; }

  for (const key of Object.keys(DEST)) fs.mkdirSync(DEST[key], { recursive: true });

  let ok = 0, fail = 0;
  for (const row of rows) {
    const destDir = row.destination === 'reference' ? DEST.reference : DEST.current;
    try {
      const { buffer, filename } = await downloadSheet(row.sheet_id);
      const base = row.label ? sanitize(row.label) : sanitize(filename.replace(/\.xlsx$/i, ''));
      const outName = /\.xlsx$/i.test(base) ? base : base + '.xlsx';
      fs.writeFileSync(path.join(destDir, outName), buffer);
      log(`  ✓ ${outName} → ${destDir}`);
      ok++;
    } catch (e) {
      log(`  ✗ sheet ${row.sheet_id} (${row.label || 'auto'}): ${e.message}`);
      fail++;
    }
  }
  // Last stdout line becomes the status shown on the Sheets page.
  log(`Done. Exported ${ok}, failed ${fail}, of ${rows.length} enabled sheet(s).`);
  if (ok === 0 && fail > 0) process.exit(1);
}

main().catch(err => { log('FATAL: ' + err.message); process.exit(1); });
