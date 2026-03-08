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
  addPath,
  setGitlink,
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
} from './git/git.mjs';
import { writeChangelog } from '../../changelog/changelog.mjs';

function nowSafeStamp() {
  const d = new Date();
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

function parseStatusPaths(status) {
  return String(status || '')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const raw = line.slice(3).trim();
        const pathPart = raw.includes(' -> ') ? raw.split(' -> ').pop() : raw;
        return pathPart?.trim() || '';
      })
      .filter(Boolean);
}

function statusHasOnlyAllowedPaths(status, allowedPaths) {
  const allowed = new Set((allowedPaths || []).filter(Boolean).map(String));
  if (!allowed.size) return false;
  const paths = parseStatusPaths(status);
  return paths.length > 0 && paths.every((p) => allowed.has(p) || [...allowed].some((a) => p === a || p.startsWith(`${a}/`)));
}

async function readUnitCurrentVersion(repoRoot, unit, varsForInit, dryRun, allowCreate = true) {
  const abs = path.join(repoRoot, unit.version.file);
  const exists = await fileExists(abs);

  const field = unit.version.field;
  const defV = String(unit.version.default ?? '0.0.0');

  if (!exists && !allowCreate) {
    if (!parseSemver(defV)) throw new Error(`Default versione non valido: ${defV} (unit ${unit.id})`);
    return defV;
  }

  if (!exists) {
    const canCreate = Boolean(unit.version.createIfMissing) || (unit.version.default != null);
    if (!canCreate) throw new Error(`File versione mancante: ${unit.version.file} (repo: ${repoRoot})`);

    const initial = unit.version.initial
        ? renderObjectTemplates(unit.version.initial, varsForInit)
        : { name: unit.name || unit.id, [field]: defV, date: varsForInit?.stamp };

    if (initial[field] == null) initial[field] = defV;

    if (!dryRun) {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, JSON.stringify(initial, null, 2) + '\n', 'utf8');
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

  const ok = paths.length > 0 && paths.every((p) => {
    const pp = p.replace(/\\/g, '/');
    return versionFiles.some((v) => pp === v || pp.endsWith('/' + v));
  });

  return ok;
}

async function updateParentSubmoduleToSha(parentRoot, submodulePath, sha) {
  await setGitlink(parentRoot, submodulePath, sha);
}

async function applyUnitWrites(repoRoot, unitResults, varsBase, dryRun) {
  const changes = [];
  for (const u of (unitResults || [])) {
    const vars = { ...varsBase, unit: u.unitId, name: u.unitId, prevVersion: u.from, bump: u.bump, version: u.to };
    for (const step of (u.plannedWrites || [])) {
      let res;
      if (step.type === 'json-set') res = await applyJsonSet(repoRoot, step, vars, dryRun);
      else if (step.type === 'readme-marker') res = await applyReadmeMarker(repoRoot, step, vars, dryRun);
      else if (step.type === 'text-replace') res = await applyTextReplace(repoRoot, step, vars, dryRun);
      else throw new Error(`Step sconosciuto: ${step.type} (unit ${u.unitId})`);
      if (res) changes.push(res);
    }
  }
  return changes;
}

async function applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, branchName) {
  if (!pendingSubmoduleUpdates?.[branchName]) return;
  for (const upd of pendingSubmoduleUpdates[branchName]) {
    await updateParentSubmoduleToSha(repoRoot, upd.submodulePath, upd.sha);
  }
}

async function applyReleaseBaseFile(repoRoot, releaseBaseFile, releaseBaseHash, dryRun) {
  if (!releaseBaseFile || !releaseBaseHash) return;
  const abs = path.join(repoRoot, releaseBaseFile);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (!dryRun) await fs.writeFile(abs, `${releaseBaseHash}\n`, 'utf8');
}

export class VersionManager {
  constructor(config = {}) {
    this.config = config;
    this.classifier = new CommitClassifier(config.rules || {});
  }

  async #applyChangelogIfEnabled({
    repoRoot,
    repoCfg,
    unitResults,
    unitMap,
    dryRun,
    changelog = false,
    noChangelog = false,
  }) {
    const enabledByConfig = Boolean(repoCfg?.changelog?.enabled);
    const shouldWrite = (enabledByConfig && !noChangelog) || changelog;

    if (!shouldWrite) return null;
    if (dryRun) return null;
    if (!unitResults?.length) return null;

    const output = repoCfg?.changelog?.output || 'CHANGELOG.md';
    const versionedOutput = repoCfg?.changelog?.versionedOutput;
    const messageUnitId = repoCfg?.git?.messageFromUnit;
    const version = (messageUnitId && unitResults.find((unit) => unit.unitId === messageUnitId)?.to)
      || unitResults.find((unit) => repoCfg?.units?.some((cfgUnit) => cfgUnit.id === unit.unitId && cfgUnit.type === 'app'))?.to
      || unitResults[0]?.to
      || null;

    return await writeChangelog({
      repoRoot,
      output,
      versionedOutput,
      version,
      releaseDate: new Date(),
      repoCfg,
      config: this.config,
      unitResults,
      unitMap,
      classifier: this.classifier,
      resolveRepoRoot: (targetRepoCfg) => path.resolve(targetRepoCfg?.root || '.'),
      readVersion: async (unit) => {
        const varsForInit = { repo: repoCfg.id || '', unit: unit.id, name: unit.name || unit.id, stamp: formatNowIt() };
        return await readUnitCurrentVersion(repoRoot, unit, varsForInit, false, false);
      },
      readVersionFromRepo: async (targetRepoRoot, unit) => {
        const varsForInit = { repo: repoCfg.id || '', unit: unit.id, name: unit.name || unit.id, stamp: formatNowIt() };
        return await readUnitCurrentVersion(targetRepoRoot, unit, varsForInit, false, false);
      },
    });
  }

  async run({
              since = null,
              commit = null,
              push = null,
              allowDirty = false,
              dryRun = false,
              changelog = false,
              noChangelog = false,
            } = {}) {
    const repoCfgs = this.config.repos || [];
    if (!repoCfgs.length) throw new Error('Config non valida: manca "repos"');

    const stamp = formatNowIt();
    const results = [];

    const childLinks = new Map();
    for (const repoCfg of repoCfgs) {
      const link = repoCfg?.git?.linkedSubmoduleInParent;
      if (link?.mode === 'propagate' && link.parentRepoId && link.submodulePath) {
        const arr = childLinks.get(link.parentRepoId) || [];
        arr.push({ childRepoId: repoCfg.id, submodulePath: link.submodulePath });
        childLinks.set(link.parentRepoId, arr);
      }
    }

    const orderedRepoCfgs = [...repoCfgs].sort((a, b) => {
      const aIsChild = a?.git?.linkedSubmoduleInParent?.mode === 'propagate' ? 0 : 1;
      const bIsChild = b?.git?.linkedSubmoduleInParent?.mode === 'propagate' ? 0 : 1;
      return aIsChild - bIsChild;
    });

    const repoPlans = [];
    const globalUnitBumps = new Map();

    for (const repoCfg of orderedRepoCfgs) {
      const applyPerBranchMode = Boolean(repoCfg.git?.commitPerBranch) && (repoCfg.git?.commitPerBranchMode === 'apply');
      const repoRoot = path.resolve(repoCfg.root || '.');
      if (!(await isWorkTree(repoRoot))) throw new Error(`Non è un work tree git: ${repoRoot}`);

      const requireClean = Boolean(repoCfg.git?.requireClean);
      const initialStatus = await getStatusPorcelain(repoRoot);
      const allowedDirtyPaths = (childLinks.get(repoCfg.id) || []).map((x) => x.submodulePath);
      if (initialStatus && !allowDirty && requireClean && !statusHasOnlyAllowedPaths(initialStatus, allowedDirtyPaths)) {
        throw new Error(`Repo non pulito: ${repoRoot}\n${initialStatus}`);
      }

      const baselineRef = await baselineForRepo(repoRoot, this.config.baseline || {}, since);
      const range = baselineRef ? `${baselineRef}..HEAD` : 'HEAD';

      const unitMap = new Map();
      for (const u of (repoCfg.units || [])) {
        unitMap.set(u.id, { unit: u, commits: [], bump: null, from: null, to: null, reasons: [] });
      }

      for (const info of unitMap.values()) {
        const u = info.unit;
        const commits = await logCommits(repoRoot, { range, paths: u.pathFilter || [], noMerges: Boolean(u.noMerges) });
        const filtered = [];
        for (const c of commits) {
          if (await isAutoBumpCommit(repoRoot, c.hash, c.subject, u.autoBump)) continue;
          filtered.push(c);
        }
        info.commits = filtered;
        const decision = this.classifier.decideBump(filtered.map((x) => ({ subject: x.subject, body: x.body })));
        info.bump = decision.kind;
        info.reasons = decision.reasons;
        globalUnitBumps.set(u.id, info.bump);
      }

      repoPlans.push({ repoCfg, repoRoot, baselineRef, applyPerBranchMode, requireClean, unitMap });
    }

    for (const plan of repoPlans) {
      for (const info of plan.unitMap.values()) {
        const u = info.unit;
        if (Array.isArray(u.bumpFrom) && u.bumpFrom.length) {
          let k = info.bump;
          for (const depId of u.bumpFrom) {
            const depBump = globalUnitBumps.get(depId);
            if (depBump) k = maxBumpKind(k, remapInheritedBump(depBump, u));
          }
          info.bump = k;
          globalUnitBumps.set(u.id, info.bump);
        }
      }
    }

    const pendingSubmoduleUpdatesByParent = new Map();

    for (const plan of repoPlans) {
      const { repoCfg, repoRoot, baselineRef, applyPerBranchMode, requireClean, unitMap } = plan;
      const unitResults = [];
      let newestRelevantHash = null;

      for (const info of unitMap.values()) {
        const u = info.unit;
        if (!info.bump) continue;

        const varsForInit = { repo: repoCfg.id || '', unit: u.id, name: u.name || u.id, stamp };
        const currentV = await readUnitCurrentVersion(repoRoot, u, varsForInit, dryRun, !applyPerBranchMode);
        const nextV = bumpSemver(currentV, info.bump, this.config?.preid || null);

        info.from = currentV;
        info.to = nextV;
        if (!newestRelevantHash && info.commits.length) newestRelevantHash = info.commits[0].hash;

        const vars = { repo: repoCfg.id || '', unit: u.id, name: u.name || u.id, version: nextV, prevVersion: currentV, bump: info.bump, stamp };
        const changes = [];
        if (!applyPerBranchMode) {
          for (const step of (u.write || [])) {
            if (step.type === 'json-set') changes.push(await applyJsonSet(repoRoot, step, vars, dryRun));
            else if (step.type === 'readme-marker') changes.push(await applyReadmeMarker(repoRoot, step, vars, dryRun));
            else if (step.type === 'text-replace') changes.push(await applyTextReplace(repoRoot, step, vars, dryRun));
            else throw new Error(`Step sconosciuto: ${step.type} (unit ${u.id})`);
          }
        }

        unitResults.push({
          unitId: u.id,
          from: currentV,
          to: nextV,
          bump: info.bump,
          changedFiles: changes.filter((x) => x.changed).map((x) => x.file),
          plannedWrites: (u.write || []),
        });
      }

      if (newestRelevantHash && (this.config.baseline?.strategy === 'file') && !applyPerBranchMode) {
        const fileName = this.config.baseline?.file || '.release-base';
        await writeReleaseBase(repoRoot, fileName, newestRelevantHash, dryRun);
      }

      if (!applyPerBranchMode) {
        await this.#applyChangelogIfEnabled({
          repoRoot,
          repoCfg,
          unitResults,
          unitMap,
          dryRun,
          changelog,
          noChangelog,
        });
      }

      const doCommit = (commit === null) ? Boolean(repoCfg.git?.commit ?? true) : Boolean(commit);
      const doPush = (push === null) ? Boolean(repoCfg.git?.push ?? false) : Boolean(push);
      const pendingSubmoduleUpdates = pendingSubmoduleUpdatesByParent.get(repoCfg.id) || {};

      const didGit = await this.#gitActions({
        repoRoot,
        repoCfg,
        unitResults,
        unitMap,
        stamp,
        doCommit,
        doPush,
        allowDirty,
        dryRun,
        requireClean,
        applyPerBranchMode,
        releaseBaseHash: newestRelevantHash,
        releaseBaseFile: (this.config.baseline?.strategy === 'file') ? (this.config.baseline?.file || '.release-base') : null,
        pendingSubmoduleUpdates,
        changelog,
        noChangelog,
      });

      const link = repoCfg?.git?.linkedSubmoduleInParent;
      if (link?.mode === 'propagate' && link.parentRepoId && link.submodulePath && didGit?.committed && didGit?.branchHeads) {
        const parentPending = pendingSubmoduleUpdatesByParent.get(link.parentRepoId) || {};
        for (const [branchName, sha] of Object.entries(didGit.branchHeads)) {
          if (!parentPending[branchName]) parentPending[branchName] = [];
          parentPending[branchName].push({ submodulePath: link.submodulePath, sha });
        }
        pendingSubmoduleUpdatesByParent.set(link.parentRepoId, parentPending);
      }

      results.push({ repo: repoCfg.id || repoRoot, repoRoot, baselineRef, unitResults, git: didGit });
    }

    return { stamp, results };
  }

  async #gitActions({
                      repoRoot,
                      repoCfg,
                      unitResults,
                      unitMap,
                      stamp,
                      doCommit,
                      doPush,
                      allowDirty,
                      dryRun,
                      requireClean,
                      applyPerBranchMode,
                      releaseBaseHash,
                      releaseBaseFile,
                      pendingSubmoduleUpdates = {},
                      changelog = false,
                      noChangelog = false,
                    }) {
    if (dryRun) return { committed: false, pushed: false, mode: 'dry-run' };

    const writeOnlyApplyMode = applyPerBranchMode && !doCommit && !doPush;
    if (!writeOnlyApplyMode && !doCommit && !doPush) {
      return { committed: false, pushed: false, mode: 'none' };
    }

    const status = await getStatusPorcelain(repoRoot);
    const hasPendingSubmoduleUpdates = Object.keys(pendingSubmoduleUpdates || {}).length > 0;

    if (!status && !applyPerBranchMode && !hasPendingSubmoduleUpdates) {
      return { committed: false, pushed: false, mode: 'no-changes' };
    }

    if (!unitResults?.length && !hasPendingSubmoduleUpdates) {
      return { committed: false, pushed: false, mode: 'no-changes' };
    }

    if (!writeOnlyApplyMode && allowDirty) throw new Error('commit/push non consentiti con --allow-dirty');
    if (requireClean) {
      // check iniziale già eseguito in run()
    }

    const gitCfg = repoCfg.git || {};
    const branches = gitCfg.branches || [];
    const commitPerBranch = Boolean(gitCfg.commitPerBranch);

    const versionForMessage = (gitCfg.messageFromUnit && unitResults.find((u) => u.unitId === gitCfg.messageFromUnit)?.to)
        || unitResults[0]?.to
        || '0.0.0';

    const varsBase = { repo: repoCfg.id || '', version: versionForMessage, stamp };

    if (!branches.length) {
      const curBranch = await getCurrentBranch(repoRoot);

      if (writeOnlyApplyMode) {
        await applyUnitWrites(repoRoot, unitResults, varsBase, dryRun);
        await applyReleaseBaseFile(repoRoot, releaseBaseFile, releaseBaseHash, dryRun);
        await applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, curBranch);
        await this.#applyChangelogIfEnabled({
          repoRoot,
          repoCfg,
          unitResults,
          unitMap,
          dryRun,
          changelog,
          noChangelog,
        });
        const headSha = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();
        return { committed: false, pushed: false, mode: 'write-working-tree', branches: [curBranch], branchHeads: { [curBranch]: headSha } };
      }

      const msgTpl = gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
      const msg = renderTemplate(msgTpl, { ...varsBase, branch: curBranch });

      await applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, curBranch);
      await this.#applyChangelogIfEnabled({
        repoRoot,
        repoCfg,
        unitResults,
        unitMap,
        dryRun,
        changelog,
        noChangelog,
      });

      await addAll(repoRoot);
      await gitCommit(repoRoot, msg);
      const newHead = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();

      if (doPush) {
        await push(repoRoot);
        if (gitCfg.versionsBranch) {
          await pushHeadToBranch(repoRoot, gitCfg.versionsBranch);
        }
      }

      return {
        committed: true,
        pushed: Boolean(doPush),
        mode: 'single-branch-commit',
        branches: [curBranch],
        branchHeads: { [curBranch]: newHead },
      };
    }

    if (!commitPerBranch) {
      const curBranch = await getCurrentBranch(repoRoot);

      if (writeOnlyApplyMode) {
        await applyUnitWrites(repoRoot, unitResults, varsBase, dryRun);
        await applyReleaseBaseFile(repoRoot, releaseBaseFile, releaseBaseHash, dryRun);
        await applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, curBranch);
        await this.#applyChangelogIfEnabled({
          repoRoot,
          repoCfg,
          unitResults,
          unitMap,
          dryRun,
          changelog,
          noChangelog,
        });
        const headSha = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();
        return { committed: false, pushed: false, mode: 'write-working-tree', branches: [curBranch], branchHeads: { [curBranch]: headSha } };
      }

      const msgTpl = gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
      const msg = renderTemplate(msgTpl, { ...varsBase, branch: curBranch });

      await applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, curBranch);

      await addAll(repoRoot);
      await gitCommit(repoRoot, msg);
      const headSha = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();

      if (doPush) {
        await push(repoRoot);
        for (const b of branches) {
          const remote = b.remote || null;
          await pushHeadToBranch(repoRoot, b.name, remote);
        }
        if (gitCfg.versionsBranch) {
          await pushHeadToBranch(repoRoot, gitCfg.versionsBranch);
        }
      }

      const branchHeads = { [curBranch]: headSha };
      for (const b of branches) branchHeads[b.name] = headSha;
      if (gitCfg.versionsBranch) branchHeads[gitCfg.versionsBranch] = headSha;
      return { committed: true, pushed: Boolean(doPush), mode: 'single-commit-multi-push', branchHeads };
    }

    if (applyPerBranchMode) {
      const originalBranch = await getCurrentBranch(repoRoot);

      if (writeOnlyApplyMode) {
        await applyUnitWrites(repoRoot, unitResults, varsBase, dryRun);
        await applyReleaseBaseFile(repoRoot, releaseBaseFile, releaseBaseHash, dryRun);
        await applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, originalBranch);
        await this.#applyChangelogIfEnabled({
          repoRoot,
          repoCfg,
          unitResults,
          unitMap,
          dryRun,
          changelog,
          noChangelog,
        });
        const headSha = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();
        return {
          committed: false,
          pushed: false,
          mode: 'write-working-tree',
          branches: [originalBranch],
          branchHeads: { [originalBranch]: headSha },
        };
      }

      const branchHeads = {};

      try {
        const targets = [...branches];
        const includeCur = (gitCfg.includeCurrentBranch !== false);
        if (includeCur && !targets.some((x) => x?.name === originalBranch)) {
          targets.unshift({
            name: originalBranch,
            remote: gitCfg.currentBranchRemote || null,
            message: gitCfg.currentBranchMessage || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}',
          });
        }

        if (gitCfg.versionsBranch && !targets.some((x) => x?.name === gitCfg.versionsBranch)) {
          targets.push({
            name: gitCfg.versionsBranch,
            remote: gitCfg.versionsBranchRemote || null,
            message: gitCfg.versionsBranchMessage || 'Versione {{version}} del {{stamp}} - {{branch}}',
            forceWithLease: true,
            isVersionsBranch: true,
          });
        }

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

          await applyUnitWrites(repoRoot, unitResults, varsBase, dryRun);
          await applyReleaseBaseFile(repoRoot, releaseBaseFile, releaseBaseHash, dryRun);
          await applyPendingSubmoduleUpdatesForBranch(repoRoot, pendingSubmoduleUpdates, b.name);
          await this.#applyChangelogIfEnabled({
            repoRoot,
            repoCfg,
            dryRun,
            changelog,
            noChangelog,
          });

          const msgTpl = b.message || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
          const msg = renderTemplate(msgTpl, { ...varsBase, branch: b.name });

          await addAll(repoRoot);
          await gitCommit(repoRoot, msg);
          const branchHead = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();
          branchHeads[b.name] = branchHead;

          if (doPush) {
            const remote = b.remote || (await getDefaultRemote(repoRoot));
            if (!remote) throw new Error(`Nessun remote per push (repo: ${repoRoot})`);
            await push(repoRoot, remote, `HEAD:refs/heads/${b.name}`, Boolean(b.forceWithLease));
          }
        }
      } finally {
        await checkout(repoRoot, originalBranch);
      }

      return {
        committed: true,
        pushed: Boolean(doPush),
        mode: 'commit-per-branch-apply',
        branches: Object.keys(branchHeads),
        branchHeads,
      };
    }

    const originalBranch = await getCurrentBranch(repoRoot);
    const tmpBranch = `_versioner_tmp_${nowSafeStamp()}`;

    await checkoutNew(repoRoot, tmpBranch);

    const first = branches[0];
    const firstMsgTpl = first.message || gitCfg.message || 'Versione {{version}} del {{stamp}} - {{branch}}';
    const baseMsg = renderTemplate(firstMsgTpl, { ...varsBase, branch: first.name });

    await addAll(repoRoot);
    await gitCommit(repoRoot, baseMsg);

    const baseSha = (await git(['rev-parse', 'HEAD'], { cwd: repoRoot })).trim();

    try {
      for (const b of branches) {
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

        if (doPush) {
          const remote = b.remote || (await getDefaultRemote(repoRoot));
          if (!remote) throw new Error(`Nessun remote per push (repo: ${repoRoot})`);
          await push(repoRoot, remote, `HEAD:refs/heads/${b.name}`);
        }
      }
    } finally {
      await checkout(repoRoot, originalBranch);
      await branchDelete(repoRoot, tmpBranch);
    }

    return { committed: true, pushed: Boolean(doPush), mode: 'commit-per-branch-cherry-pick' };
  }
}