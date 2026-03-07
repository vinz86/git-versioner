import fs from 'node:fs/promises';
import path from 'node:path';
import { renderTemplate } from './utils/template.mjs';

export async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

export function normPath(p) {
  return (p ?? '').toString().replace(/\\/g, '/');
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function markerToRegex(marker) {
  // marker tipo "<!-- APP_VERSION_START -->" -> token "APP_VERSION_START"
  const token = String(marker).replace('<!--', '').replace('-->', '').trim();
  return new RegExp(`<!--\\s*${escapeRegExp(token)}\\s*-->`, 'm');
}

export async function readJson(absPath) {
  const raw = await fs.readFile(absPath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(absPath, obj) {
  const raw = JSON.stringify(obj, null, 2) + '\n';
  await fs.writeFile(absPath, raw, 'utf8');
}

export function getByDotPath(obj, dotPath) {
  const parts = String(dotPath).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function setByDotPath(obj, dotPath, value) {
  const parts = String(dotPath).split('.').filter(Boolean);
  if (!parts.length) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Aggiorna un file JSON (tipicamente package.json).
 * @param {string} repoRoot
 * @param {{file:string, set:Record<string,string>, onlyIfChanged?:boolean}} step
 * @param {object} vars
 * @param {boolean} dryRun
 */
export function renderObjectTemplates(obj, vars) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(x => renderObjectTemplates(x, vars));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = renderObjectTemplates(v, vars);
    return out;
  }
  if (typeof obj === 'string') return renderTemplate(obj, vars);
  return obj;
}

/**
 * Aggiorna un file JSON (tipicamente package.json o version.json).
 * Supporta:
 * - createIfMissing: true -> crea il file se non esiste usando "initial"
 * - initial: oggetto JSON iniziale (può contenere {{template}})
 */
export async function applyJsonSet(repoRoot, step, vars, dryRun) {
  const abs = path.join(repoRoot, step.file);

  const exists = await fileExists(abs);
  if (!exists && !step.createIfMissing) return { changed: false, file: step.file, skipped: true };

  if (!exists && step.createIfMissing) {
    const initial = step.initial != null ? renderObjectTemplates(step.initial, vars) : {};
  await fs.mkdir(path.dirname(abs), { recursive: true });
    if (!dryRun) await writeJson(abs, initial);
  }

  const obj = await readJson(abs);
  let changed = false;

  for (const [dotPath, tpl] of Object.entries(step.set || {})) {
    const v = renderTemplate(tpl, vars);
    const before = getByDotPath(obj, dotPath);
    if (String(before ?? '') !== String(v)) {
      setByDotPath(obj, dotPath, v);
      changed = true;
    }
  }

  if (changed && !dryRun) await writeJson(abs, obj);
  return { changed, file: step.file };
}

/**
 * Aggiorna un README (o qualsiasi testo) tra marker START/END.
 * Robustezza: marker con/ senza spazi.
 */
export async function applyReadmeMarker(repoRoot, step, vars, dryRun) {
  const abs = path.join(repoRoot, step.file);
  if (!(await fileExists(abs))) return { changed: false, file: step.file, skipped: true };

  const content = await fs.readFile(abs, 'utf8');

  const startRe = markerToRegex(step.start);
  const endRe = markerToRegex(step.end);
  const rangeRe = new RegExp(`(${startRe.source})[\\s\\S]*?(${endRe.source})`, 'g');

  if (!rangeRe.test(content)) return { changed: false, file: step.file, skipped: true };

  const inner = renderTemplate(step.template ?? '', vars);
  const replacement = `$1\n${inner}\n$2`;

  const updated = content.replace(rangeRe, replacement);
  const changed = updated !== content;
  if (changed && !dryRun) await fs.writeFile(abs, updated, 'utf8');
  return { changed, file: step.file };
}

/**
 * Sostituzioni testuali via regex (utile per nuxt.config.ts o altri file non JSON).
 * Ogni replace: { pattern: string, flags?: string, with: string }
 */
export async function applyTextReplace(repoRoot, step, vars, dryRun) {
  const abs = path.join(repoRoot, step.file);
  if (!(await fileExists(abs))) return { changed: false, file: step.file, skipped: true };

  let content = await fs.readFile(abs, 'utf8');
  const original = content;

  for (const r of (step.replace || [])) {
    const re = new RegExp(r.pattern, r.flags || 'g');
    const withStr = renderTemplate(r.with ?? '', vars);
    content = content.replace(re, withStr);
  }

  const changed = content !== original;
  if (changed && !dryRun) await fs.writeFile(abs, content, 'utf8');
  return { changed, file: step.file };
}
