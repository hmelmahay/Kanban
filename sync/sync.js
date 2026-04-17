#!/usr/bin/env node
/**
 * Work Clip Sync Agent
 * Polls Supabase for unsynced clips and writes them to Mac mini project folders.
 *
 * Runs every 5 minutes via launchd. Install with: ./install.sh
 */

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://sztatmknjyzzyzngvpff.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_GvPXZ8AVgix3aZ2UDS0YRQ_ktlLvMtB';
const BASE_PATH     = '/users/steve/workpm/projects';
const NEW_FILES_DIR = 'New_Files';

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function formatDate(isoString) {
  return isoString.slice(0, 10); // YYYY-MM-DD
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function buildMarkdown(clip, projectName) {
  const date = formatDate(clip.created_at);
  const lines = [
    '---',
    `title: ${clip.title}`,
    `type: ${clip.clip_type}`,
    `project: ${projectName}`,
    `date: ${clip.created_at}`,
    `id: ${clip.id}`,
    '---',
    '',
  ];
  if (clip.content) {
    lines.push(clip.content);
    lines.push('');
  }
  if (clip.file_paths && clip.file_paths.length) {
    lines.push('');
    lines.push('## Attachments');
    clip.file_paths.forEach(fp => {
      const fname = path.basename(fp);
      lines.push(`- [${fname}](./${fname})`);
    });
  }
  return lines.join('\n');
}

// ── Main sync ─────────────────────────────────────────────────────────────────
async function sync() {
  log('Starting sync…');
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Fetch unsynced clips with their project info
  const { data: clips, error: fetchErr } = await db
    .from('clips')
    .select('*, projects(name, folder_name, subfolder, base_path)')
    .eq('synced', false)
    .order('created_at');

  if (fetchErr) {
    log('ERROR fetching clips: ' + fetchErr.message);
    process.exit(1);
  }

  if (!clips || clips.length === 0) {
    log('Nothing to sync.');
    return;
  }

  log(`Found ${clips.length} unsynced clip(s).`);
  let synced = 0, errors = 0;

  for (const clip of clips) {
    try {
      const project = clip.projects;
      if (!project) {
        log(`SKIP clip "${clip.title}" — missing project info`);
        continue;
      }

      // Resolve destination folder — use project's base_path if set, else global BASE_PATH
      const rootPath = project.base_path || BASE_PATH;
      const destDir  = path.join(rootPath, project.folder_name, project.subfolder || NEW_FILES_DIR);
      fs.mkdirSync(destDir, { recursive: true });

      // Write markdown only if content was pasted
      if (clip.content && clip.content.trim()) {
        const date     = formatDate(clip.created_at);
        const slug     = slugify(clip.title);
        const mdName   = `${date}-${slug}.md`;
        const mdPath   = path.join(destDir, mdName);
        fs.writeFileSync(mdPath, clip.content.trim(), 'utf8');
        log(`  Wrote: ${path.join(project.folder_name, project.subfolder || NEW_FILES_DIR, mdName)}`);
      }

      // Download attachments — abort clip if any file fails
      for (const filePath of (clip.file_paths || [])) {
        const fname = path.basename(filePath);
        const dest  = path.join(destDir, fname);
        const { data: signedData, error: signErr } = await db.storage
          .from('clip-attachments')
          .createSignedUrl(filePath, 300);  // 5 min signed URL
        if (signErr) throw new Error(`Signed URL failed for "${fname}": ${signErr.message}`);
        await downloadFile(signedData.signedUrl, dest);
        log(`  Downloaded: ${fname}`);
      }

      // Delete storage files (no longer needed after download) then mark clip as synced
      if (clip.file_paths && clip.file_paths.length) {
        await db.storage.from('clip-attachments').remove(clip.file_paths);
      }
      const { error: updateErr } = await db
        .from('clips')
        .update({ synced: true })
        .eq('id', clip.id);
      if (updateErr) throw updateErr;

      synced++;
    } catch (err) {
      log(`ERROR on clip "${clip.title}": ${err.message}`);
      errors++;
    }
  }

  log(`Done. Synced: ${synced}, Errors: ${errors}`);
}

sync().catch(err => {
  log('FATAL: ' + err.message);
  process.exit(1);
});
