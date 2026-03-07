import fs from 'node:fs/promises';
import path from 'node:path';

import { CommitClassifier } from './commitClassifier.mjs';
import { bumpSemver, parseSemver, maxBumpKind } from './semver.mjs';
import { renderTemplate, formatNowIt } from './utils/template.mjs';
import { applyJsonSet, applyReadmeMarker, applyTextReplace, fileExists, renderObjectTemplates } from './fileOps.mjs';
import {
  git,
  isWorkTree,
  getStatusPorcelain,
  getCurrentBranch,
  getLastSemverTag,
  revParse,
  logCommits,
  diffNameOnly,
  addAll,
  commit as gitCommit,
  checkout,
  checkoutNew,
  branchDelete,
  cherryPick,
  cherryPickAbort,
  amendMessage,
  merge,
  push,
  pushHeadToBranch,
  getDefaultRemote,
  addPath,
  submoduleUpdate,
} from './git/git.mjs';

function nowSafeStamp() {
  const d = new Date();
  // YYYYMMDD-HHMMSS per nomi branch temporanei
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function normalizeInheritedBump(kind, fallback) {
  if (!kind) return fallback;
  if (kind === 'major' || kind === 'minor' || kind === 'patch') return kind;
  throw new Error(`Valore bump non valido: ${kind}`);
}

function remapInheritedBump(depBump, unit) {
  if (!depBump) return depBump;
  if (depBump === 'major') return normalizeInheritedBump(unit.bumpFromMajor ?? 'major', 'major');
  if (depBump === 'minor') return normalizeInheritedBump(unit.bumpFromMinor ?? 'minor', 'minor');
  return depBump;
}



function sortReposForExecution(repos = []) {
  // Modalità semplice e prevedibile:
  // - i repo che propagano il proprio SHA come submodule nel parent vengono eseguiti prima
  // - gli altri dopo, mantenendo l'ordine relativo dichiarato in config
  const withIndex = [...repos].map((repo, index) => ({ repo, index }));
  withIndex.sort((a, b) => {
    const aWeight = a.repo?.git?.linkedSubmoduleInParent?.mode === 'propagate' ? 0 : 1;
    const bWeight = b.repo?.git?.linkedSubmoduleInParent?.mode === 'propagate' ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    return a.index - b.index;
  });
  return withIndex.map((x) => x.repo);
}

function filterStatusByAllowedPrefixes(status, allowedPrefixes = []) {
  if (!status) return '';
  const normalized = (allowedPrefixes || []).map((x) => String(x).replace(/\\/g, '/')).filter(Boolean);
  if (!normalized.length) return status;
  return status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const pathPart = line.length > 3 ? line.slice(3).trim() : line.trim();
      const pathNorm = pathPart.replace(/\\/g, '/');
      return !normalized.some((prefix) => pathNorm === prefix || pathNorm.startsWith(prefix + '/'));
    })
    .join('\n');
}

async function readUnitCurrentVersion(repoRoot, unit, varsForInit, dryRun, allowCreate = true) {
  const abs = path.join(repoRoot, unit.version.file);
  const exists = await fileExists(abs);

  const field = unit.version.field;
  const defV = String(unit.version.default ?? '0.0.0');

  // In modalità "apply per branch" voglio evitare qualunque modifica prima dei checkout
  // Quindi: se manca il file e ho un default, uso il default senza creare il file
  if (!exists && !allowCreate) {
    if (!parseSemver(defV)) throw new Error(`Default versione non valido: ${defV} (unit ${unit.id})`);
    return defV;
  }

  // - unit.version.createIfMissing === true
  // - oppure se è presente unit.version.default
  if (!exists) {
    const canCreate = Boolean(unit.version.createIfMissing) || (unit.version.default != null);
    if (!canCreate) throw new Error(`File versione mancante: ${unit.version.file} (repo: ${repoRoot})`);

    const initial = unit.version.initial
      ? renderObjectTemplates(unit.version.initial, varsForInit)
      : { name: unit.name || unit.id, [field]: defV, date: varsForInit?.stamp };

    if (initial[field] == null) initial[field] = defV;

    if (!dryRun) {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, JSON.stringify(initial, null, 2) + '\\n', 'utf8');
    }
  }

  const raw = await fs.readFile(abs, 'utf8');
  const obj = JSON.parse(raw);
  const cur = obj?.[field];

  if (!cur || !parseSemver(cur)) throw new Error(`Versione non valida in ${unit.version.file}:${field}`);
  return String(cur);
}

async function writeReleaseBase(repoRoot, fileName, hash, dryRun) {
  if (!fileName || !hash) return;
  const abs = path.join(repoRoot, fileName);
  if (!dryRun) await fs.writeFile(abs, `${hash}\n`, 'utf8');
}

async function baselineForRepo(repoRoot, baselineCfg, sinceOverride) {
  if (sinceOverride) return sinceOverride;

  const strategy = baselineCfg?.strategy ?? 'tag';

  if (strategy === 'none') return null;

  if (strategy === 'file') {
    const fileName = baselineCfg?.file || '.release-base';
    const abs = path.join(repoRoot, fileName);
    if (await fileExists(abs)) {
      const raw = (await fs.readFile(abs, 'utf8')).trim();
      if (raw) {
        const ok = await revParse(repoRoot, raw);
        if (ok) return raw;
      }
    }
    // fallback tag
    const t = await getLastSemverTag(repoRoot, baselineCfg?.tagMatch || '*[0-9]*.[0-9]*.[0-9]*');
    return t;
  }

  if (strategy === 'tag') {
    const t = await getLastSemverTag(repoRoot, baselineCfg?.tagMatch || '*[0-9]*.[0-9]*.[0-9]*');
    return t;
  }

  return null;
}

async function isAutoBumpCommit(repoRoot, commitHash, subject, autoCfg) {
  if (!autoCfg?.enabled) return false;

  const subjectRe = autoCfg?.subjectRe ? new RegExp(autoCfg.subjectRe, 'i') : /\bVersion\b\s*\d+\.\d+\.\d+/i;
  if (!subjectRe.test(subject ?? '')) return false;

  const paths = await diffNameOnly(repoRoot, commitHash);
  const versionFiles = autoCfg?.versionFiles || [
    'package.json',
    '.release-base',
    'CHANGELOG.md',
    'README.md',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lockb',
    'nuxt.config.ts',
  ];

  // se tutti i path sono versionFiles (o sotto) allora lo considero auto-bump:
  // Controlla se tutti i file modificati appartengono alla lista dei file che gestiscono la versione (come package.json, VERSION.txt, ecc.).
  const ok = paths.length > 0 && paths.every(p => {
    const pp = p.replace(/\\/g, '/');
    return versionFiles.some(v => pp === v || pp.endsWith('/' + v));
  });

  return ok;
}

export class VersionManager {
  constructor(config = {}) {
    this.config = config;
    this.classifier = new CommitClassifier(config.rules || {});
  }

  async run({ since = null, commit = null, push = null, allowDirty = false, dryRun = false } = {}) {
    const repos = this.config.repos || [];
    if (!repos.length) throw new Error('Config non valida: manca "repos"');

    const stamp = formatNowIt();
    const results = [];
    const reposOrdered = sortReposForExecution(repos);
    const pendingSubmoduleUpdates = new Map();

    for (const repoCfg of reposOrdered) {
        const applyPerBranchMode = Boolean(repoCfg.git?.commitPerBranch) && (repoCfg.git?.commitPerBranchMode === 'apply');
      const repoRoot = path.resolve(repoCfg.root || '.');

      if (!(await isWorkTree(repoRoot))) throw new Error(`Non è un work tree git: ${repoRoot}`);

      const requireClean = Boolean(repoCfg.git?.requireClean);
      const initialStatus = await getStatusPorcelain(repoRoot);
      if (initialStatus && !allowDirty && requireClean) {
        throw new Error(`Repo non pulito: ${repoRoot}\n${initialStatus}`);
      }

      const baselineRef = await baselineForRepo(repoRoot, this.config.baseline || {}, since);
      const range = baselineRef ? `${baselineRef}..HEAD` : 'HEAD';

      // carico commit per ogni unit
      const unitMap = new Map(); // id -> unitInfo
      for (const u of (repoCfg.units || [])) {
        unitMap.set(u.id, { unit: u, commits: [], bump: null, from: null, to: null, reasons: [] });
      }

      for (const [_id, info] of unitMap.entries()) {
        const u = info.unit;
        const commits = await logCommits(repoRoot, { range, paths: u.pathFilter || [], noMerges: Boolean(u.noMerges) });
        const filtered = [];

        for (const c of commits) {
          if (await isAutoBumpCommit(repoRoot, c.hash, c.subject, u.autoBump)) continue;
          filtered.push(c);
        }

        info.commits = filtered;
        const decision = this.classifier.decideBump(filtered.map(x => ({ subject: x.subject, body: x.body })));
        info.bump = decision.kind;
        info.reasons = decision.reasons;
      }

      // bump aggregati (es: app eredita bump dai layer)
      // Si può rimappare major/minor ereditati con due parametri per unit:
      // - bumpFromMajor: 'major' | 'minor' | 'patch'
      // - bumpFromMinor: 'minor' | 'patch'
      for (const [_id, info] of unitMap.entries()) {
        const u = info.unit;
        if (Array.isArray(u.bumpFrom) && u.bumpFrom.length) {
          let k = info.bump;
          for (const depId of u.bumpFrom) {
            const dep = unitMap.get(depId);
            if (dep?.bump) k = maxBumpKind(k, remapInheritedBump(dep.bump, u));
          }
          info.bump = k;
        }
      }

      // calcolo nuove versioni + applico write steps
      const touchedRepos = new Set();
      const unitResults = [];

      let newestRelevantHash = null; // per release-base

      for (const [_id, info] of unitMap.entries()) {
        const u = info.unit;
        if (!info.bump) continue;

        const varsForInit = { repo: repoCfg.id || '', unit: u.id, name: u.name || u.id, stamp };
          const currentV = await readUnitCurrentVersion(repoRoot, u, varsForInit, dryRun, !applyPerBranchMode);
        const nextV = bumpSemver(currentV, info.bump, this.config?.preid || null);

        info.from = currentV;
        info.to = nextV;

        // newestRelevantHash: primo commit rilevante nel range (il più recente in git log)
        if (!newestRelevantHash && info.commits.length) newestRelevantHash = info.commits[0].hash;

        const vars = {
          repo: repoCfg.id || '',
          unit: u.id,
          name: u.name || u.id,
          version: nextV,
          prevVersion: currentV,
          bump: info.bump,
          stamp,
        };

        
          const changes = [];
          if (!applyPerBranchMode) {
            for (const step of (u.write || [])) {
              if (step.type === 'json-set') changes.push(await applyJsonSet(repoRoot, step, vars, dryRun));
              else if (step.type === 'readme-marker') changes.push(await applyReadmeMarker(repoRoot, step, vars, dryRun));
              else if (step.type === 'text-replace') changes.push(await applyTextReplace(repoRoot, step, vars, dryRun));
              else throw new Error(`Step sconosciuto: ${step.type} (unit ${u.id})`);
            }
          }
          const changed = changes.some(x => x.changed);
        if (changed) touchedRepos.add(repoRoot);

        unitResults.push({
          unitId: u.id,
          from: currentV,
          to: nextV,
          bump: info.bump,
          changedFiles: changes.filter(x => x.changed).map(x => x.file),
            plannedWrites: (u.write || []),
        });
      }

      // release-base
      if (newestRelevantHash && (this.config.baseline?.strategy === 'file')) {
        const fileName = this.config.baseline?.file || '.release-base';
        if (!applyPerBranchMode) {
          await writeReleaseBase(repoRoot, fileName, newestRelevantHash, dryRun);
          touchedRepos.add(repoRoot);
        }
      }

      // commit + push
      const doCommit = (commit === null) ? Boolean(repoCfg.git?.commit ?? true) : Boolean(commit);
      const doPush = (push === null) ? Boolean(repoCfg.git?.push ?? false) : Boolean(push);

      const didGit = await this.#gitActions({
          repoRoot,
          repoCfg,
          unitResults,
          stamp,
          doCommit,
          doPush,
          allowDirty,
          dryRun,
          requireClean,
          applyPerBranchMode,
          releaseBaseHash: newestRelevantHash,
          releaseBaseFile: (this.config.baseline?.strategy === 'file') ? (this.config.baseline?.file || '.release-base') : null,
          linkedSubmoduleUpdates: pendingSubmoduleUpdates.get(repoCfg.id || '') || [],
        });

      const linkCfg = repoCfg.git?.linkedSubmoduleInParent;
      if (linkCfg?.mode === 'propagate' && didGit?.branchHeads && linkCfg.parentRepoId && linkCfg.submodulePath) {
        const list = pendingSubmoduleUpdates.get(linkCfg.parentRepoId) || [];
        list.push({
          sourceRepoId: repoCfg.id || repoRoot,
          sourceRepoRoot: repoRoot,
          submodulePath: linkCfg.submodulePath,
          branchHeads: didGit.branchHeads,
        });
        pendingSubmoduleUpdates.set(linkCfg.parentRepoId, list);
      }

      results.push({ repo: repoCfg.id || repoRoot, repoRoot, baselineRef, unitResults, git: didGit });
    }

    return { stamp, results };
  }

  async #gitActions({ repoRoot, repoCfg, unitResults, stamp, doCommit, doPush, allowDirty, dryRun, requireClean, applyPerBranchMode, releaseBaseHash, releaseBaseFile, linkedSubmoduleUpdates = [] }) {
    if (!doCommit && !doPush) return { committed: false, pushed: false, mode: 'none' };
    if (dryRun) return { committed: false, pushed: false, mode: 'dry-run' };

    const status = filterStatusByAllowedPrefixes(await getStatusPorcelain(repoRoot), linkedSubmoduleUpdates.map((x) => x.submodulePath));

    // In modalità apply-per-branch le modifiche vengono applicate dopo i checkout, quindi qui il repo può essere pulito: non devo interrompere
    if (!status && !applyPerBranchMode) {
      return { committed: false, pushed: false, mode: 'no-changes' };
    }

    if (!unitResults?.length && !linkedSubmoduleUpdates.length) {
      return { committed: false, pushed: false, mode: 'no-changes' };
    }

    if (allowDirty) throw new Error('commit/push non consentiti con --allow-dirty');
    if (requireClean) {
      // qui il repo è sporco perché ho modificato file; però deve essere partito pulito
      // lo controllo con config + disciplina in CI/uso manuale: se serve, qui si può aggiungere un snapshot iniziale
    }

    const gitCfg = repoCfg.git || {};
    const branches = gitCfg.branches || [];
    const commitPerBranch = Boolean(gitCfg.commitPerBranch);

    // quale versione usare nei template commit? default: prima unit (tipicamente app)
    const versionForMessage = (gitCfg.messageFromUnit && unitResults.find(u => u.unitId === gitCfg.messageFromUnit)?.to)
      || unitResults[0]?.to
      || '0.0.0';

    const varsBase = {
      repo: repoCfg.id || '',
      version: versionForMessage,
      stamp,
    };

    // Se non è definito nessun branch commit/push sul branch corrente
    if (!branches.length) {
      const curBranch = await getCurrentBranch(repoRoot);
      const msgTpl = gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
      const msg = renderTemplate(msgTpl, { ...varsBase, branch: curBranch });

      await addAll(repoRoot);
      await gitCommit(repoRoot, msg);

      if (doPush) {
        await push(repoRoot);
        if (gitCfg.versionsBranch) {
          await pushHeadToBranch(repoRoot, gitCfg.versionsBranch);
        }
      }

      return { committed: true, pushed: Boolean(doPush), mode: 'single-branch', branch: curBranch, branchHeads: { [curBranch]: (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim() } };
    }

    if (!commitPerBranch) {
      // Un solo commit e lo pusho su più branch (stesso commit/message)
      const curBranch = await getCurrentBranch(repoRoot);
      const msgTpl = gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
      const msg = renderTemplate(msgTpl, { ...varsBase, branch: curBranch });

      await addAll(repoRoot);
      await gitCommit(repoRoot, msg);

      if (doPush) {
        // push branch corrente
        await push(repoRoot);

        // push HEAD sui branch richiesti
        for (const b of branches) {
          const remote = b.remote || null;
          await pushHeadToBranch(repoRoot, b.name, remote);
        }

        if (gitCfg.versionsBranch) {
          await pushHeadToBranch(repoRoot, gitCfg.versionsBranch);
        }
      }

      return { committed: true, pushed: Boolean(doPush), mode: 'single-commit-multi-push', branchHeads: { [curBranch]: (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim() } };
    }

    
      // Commit per branch: modalità apply=> checkout branch, applica le scritture, commit con messaggio specifico
      // Evita i conflitti tipici del cherry-pick quando i branch divergono
      if (applyPerBranchMode) {
        const originalBranch = await getCurrentBranch(repoRoot);

        const versionForMessage = (gitCfg.messageFromUnit && unitResults.find(u => u.unitId === gitCfg.messageFromUnit)?.to)
          || unitResults[0]?.to
          || '0.0.0';

        const varsBase = { repo: repoCfg.id || '', version: versionForMessage, stamp };
        const branchHeads = {};

        let targets = [];
        try {
          targets = [...branches];

          // include anche il branch corrente (se non è già nella lista)
          const includeCur = (gitCfg.includeCurrentBranch !== false);
          if (includeCur && !targets.some(x => x?.name === originalBranch)) {
            targets.unshift({
              name: originalBranch,
              remote: gitCfg.currentBranchRemote || null,
              message: gitCfg.currentBranchMessage || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}',
            });
          }

          // versions branch come target separato, con messaggio proprio e push force-with-lease
          // Per default non mergia i commit del branch sorgente: deve restare un branch lineare di snapshot versioni
          if (gitCfg.versionsBranch && !targets.some(x => x?.name === gitCfg.versionsBranch)) {
            targets.push({
              name: gitCfg.versionsBranch,
              remote: gitCfg.versionsBranchRemote || null,
              message: gitCfg.versionsBranchMessage || 'Versione {{version}} del {{stamp}} - {{branch}}',
              forceWithLease: true,
              isVersionsBranch: true,
            });
          }

          const syncLinkedSubmodulesForBranch = async (branchName) => {
            for (const update of linkedSubmoduleUpdates) {
              const sha = update?.branchHeads?.[branchName];
              if (!sha || !update?.submodulePath) continue;
              const subRoot = path.join(repoRoot, update.submodulePath);
              await git(['checkout', sha], { cwd: subRoot });
              await addPath(repoRoot, update.submodulePath);
            }
          };

          for (const b of targets) {
            await checkout(repoRoot, b.name);

            const isVersionsBranchTarget = Boolean(b.isVersionsBranch) || (gitCfg.versionsBranch && b.name === gitCfg.versionsBranch);
            const shouldMergeSourceBranch = (
              b.name !== originalBranch
              && (gitCfg.mergeCurrentBranchIntoTargets !== false)
              && (!isVersionsBranchTarget || gitCfg.mergeCurrentBranchIntoVersionsBranch === true)
            );
            if (shouldMergeSourceBranch) {
              try {
                await merge(repoRoot, originalBranch, { noEdit: true, noFF: true, noCommit: true });
              } catch (e) {
                throw new Error(`Merge fallito di ${originalBranch} su ${b.name}: ${e?.message ?? e}`);
              }
            }

            // Applico scritture per tutte le unit usando le versioni già calcolate
            for (const u of unitResults) {
              const vars = { ...varsBase, unit: u.unitId, name: u.unitId, prevVersion: u.from, bump: u.bump, version: u.to };
              for (const step of (u.plannedWrites || [])) {
                if (step.type === 'json-set') await applyJsonSet(repoRoot, step, vars, dryRun);
                else if (step.type === 'readme-marker') await applyReadmeMarker(repoRoot, step, vars, dryRun);
                else if (step.type === 'text-replace') await applyTextReplace(repoRoot, step, vars, dryRun);
                else throw new Error(`Step sconosciuto: ${step.type} (unit ${u.unitId})`);
              }
            }

            // release-base (se configurato)
            if (releaseBaseFile && releaseBaseHash) {
              const abs = path.join(repoRoot, releaseBaseFile);
              await fs.mkdir(path.dirname(abs), { recursive: true });
              if (!dryRun) await fs.writeFile(abs, `${releaseBaseHash}\n`, 'utf8');
            }

            await syncLinkedSubmodulesForBranch(b.name);

            const msgTpl = b.message || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
            const msg = renderTemplate(msgTpl, { ...varsBase, branch: b.name });

            await addAll(repoRoot);
            await gitCommit(repoRoot, msg);

            branchHeads[b.name] = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();

            if (doPush) {
              const remote = b.remote || (await getDefaultRemote(repoRoot));
              if (!remote) throw new Error(`Nessun remote per push (repo: ${repoRoot})`);
              await push(repoRoot, remote, `HEAD:refs/heads/${b.name}`, Boolean(b.forceWithLease));
            }
          }
        } finally {
          await checkout(repoRoot, originalBranch);
          for (const update of linkedSubmoduleUpdates) {
            if (update?.submodulePath) await submoduleUpdate(repoRoot, update.submodulePath);
          }
        }

        return { committed: true, pushed: Boolean(doPush), mode: 'commit-per-branch-apply', branches: targets.map(b => b.name), branchHeads };
      }

// Commit per branch con messaggi diversi: strategia cherry-pick + amend
    const originalBranch = await getCurrentBranch(repoRoot);
    const tmpBranch = `_versioner_tmp_${nowSafeStamp()}`;

    // creo commit base su tmp branch
    await checkoutNew(repoRoot, tmpBranch);

    const first = branches[0];
    const firstMsgTpl = first.message || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
    const baseMsg = renderTemplate(firstMsgTpl, { ...varsBase, branch: first.name });

    await addAll(repoRoot);
    await gitCommit(repoRoot, baseMsg);

    const baseSha = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();

    // applico su ogni branch target
    const branchHeads = {};
    try {
      for (const b of branches) {
        // checkout (se non esiste, errore esplicito: meglio non creare branch a sorpresa)
        await checkout(repoRoot, b.name);

        try {
          await cherryPick(repoRoot, baseSha);
        } catch (e) {
          await cherryPickAbort(repoRoot);
          throw e;
        }

        const msgTpl = b.message || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
        const msg = renderTemplate(msgTpl, { ...varsBase, branch: b.name });
        await amendMessage(repoRoot, msg);

        branchHeads[b.name] = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();
        if (doPush) {
          const remote = b.remote || (await getDefaultRemote(repoRoot));
          if (!remote) throw new Error(`Nessun remote per push (repo: ${repoRoot})`);
          await push(repoRoot, remote, `HEAD:refs/heads/${b.name}`);
        }
      }

      // push extra su versionsBranch (stesso HEAD dell’ultimo branch processato)
      if (doPush && gitCfg.versionsBranch) {
        const remote = await getDefaultRemote(repoRoot);
        await pushHeadToBranch(repoRoot, gitCfg.versionsBranch, remote, true);
      }
    } finally {
      // ritorno al branch originale e pulizia tmp
      await checkout(repoRoot, originalBranch);
      await branchDelete(repoRoot, tmpBranch);
    }

    return { committed: true, pushed: Boolean(doPush), mode: 'commit-per-branch', branches: (gitCfg.includeCurrentBranch === false ? branches : ([{name: originalBranch}, ...branches])).map(b => b.name), branchHeads };
  }
}
