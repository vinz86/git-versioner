import fs from 'node:fs/promises'
import path from 'node:path'

const GLOBAL_CHANGELOG_HEADER = `# Changelog

Tutte le modifiche rilevanti a questo progetto sono documentate in questo file.

Il formato si ispira a [Keep a Changelog](https://keepachangelog.com/it-IT/0.3.0/) e il versionamento segue [Semantic Versioning](https://semver.org/lang/it/).
`

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatReleaseDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function fileExists(absPath) {
  try {
    await fs.access(absPath)
    return true
  } catch {
    return false
  }
}

async function safeReadJson(absPath) {
  try {
    const raw = await fs.readFile(absPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function inferPackageName(repoRoot, unit) {
  const explicit = unit?.packageName || unit?.npmName
  if (explicit) return String(explicit)

  const candidates = []
  const versionFile = unit?.version?.file
  if (versionFile) {
    if (path.basename(versionFile) === 'package.json') {
      candidates.push(path.join(repoRoot, versionFile))
    }
    const versionDir = path.dirname(versionFile)
    if (versionDir && versionDir !== '.') {
      candidates.push(path.join(repoRoot, versionDir, 'package.json'))
    }
  }

  for (const abs of candidates) {
    const data = await safeReadJson(abs)
    if (data?.name) return String(data.name)
  }

  return unit?.name || unit?.id || null
}

function inferUnitLocation(unit) {
  if (Array.isArray(unit?.pathFilter) && unit.pathFilter.length === 1) return String(unit.pathFilter[0])

  const versionFile = unit?.version?.file
  if (!versionFile) return null

  const dir = path.dirname(versionFile).replace(/\\/g, '/')
  if (!dir || dir === '.') return null
  return dir
}

function normalizeAppDisplayName(name, fallback = 'app') {
  const value = String(name || fallback).trim()
  if (!value) return fallback
  const withoutScope = value.includes('/') ? value.split('/').pop() : value
  return withoutScope || fallback
}

function classifyEntryTag(entry) {
  const tag = String(entry?.tag || '').toUpperCase()
  if (tag === 'BREAKING' || tag === 'MAJOR') return 'breaking'
  if (tag === 'FEAT' || tag === 'FEATURE') return 'added'
  if (tag === 'FIX' || tag === 'PATCH' || tag === 'PERF') return 'fixed'
  if (tag === 'DOCS') return 'docs'
  if (tag === 'TEST') return 'test'
  if (tag === 'REFACTOR' || tag === 'BUILD' || tag === 'CI' || tag === 'CHORE' || tag === 'UPDATE') return 'changed'
  return 'other'
}

function uniqueSorted(items) {
  return [...new Set((items || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b))
}

function renderVersionsSection({ appUnit, allUnits }) {
  const appName = normalizeAppDisplayName(appUnit?.displayName || appUnit?.name || appUnit?.id, 'app')
  const appVersion = appUnit?.version || '0.0.0'
  const layers = (allUnits || []).filter((unit) => unit.kind === 'layer')

  let md = '## Versioni correnti\n\n'
  md += `- App (${appName}): **${appVersion}**\n\n`

  if (!layers.length) return md

  md += '- Layers:\n'
  for (const layer of layers) {
    const loc = layer.location ? ` _(${layer.location})_` : ''
    md += `  - ${layer.displayName}: **${layer.version}**${loc}\n`
  }
  md += '\n'
  return md
}

function renderCategorySection(title, entries) {
  if (!entries.length) return ''
  let md = `### ${title}\n\n`
  for (const entry of entries) {
    const scopeText = entry.units?.length ? ` — ${entry.units.join(', ')}` : ''
    md += `- ${entry.desc}${scopeText} (${entry.hash.slice(0, 7)})\n`
  }
  md += '\n'
  return md
}

function buildReleaseEntryMarkdown({ version, releaseDate, appUnit, allUnits, entries }) {
  const grouped = {
    breaking: [],
    added: [],
    changed: [],
    fixed: [],
    docs: [],
    test: [],
    other: [],
  }

  for (const entry of (entries || [])) {
    const bucket = classifyEntryTag(entry)
    grouped[bucket].push(entry)
  }

  let md = `## [${version}] - ${releaseDate}\n\n`
  md += renderVersionsSection({ appUnit, allUnits })

  const hasChanges = Object.values(grouped).some((items) => items.length)
  if (!hasChanges) {
    md += '_Nessuna modifica classificabile per questa release._\n\n'
    return md
  }

  md += renderCategorySection('Breaking changes', grouped.breaking)
  md += renderCategorySection('Aggiunto', grouped.added)
  md += renderCategorySection('Modificato', grouped.changed)
  md += renderCategorySection('Corretto', grouped.fixed)
  md += renderCategorySection('Documentazione', grouped.docs)
  md += renderCategorySection('Test', grouped.test)
  md += renderCategorySection('Altro', grouped.other)

  return md
}

function upsertReleaseSection(existing, releaseSection, version) {
  const normalized = existing?.trim() ? `${existing.trim()}\n` : `${GLOBAL_CHANGELOG_HEADER}\n`
  const sectionRe = new RegExp(`\\n## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'm')

  if (sectionRe.test(normalized)) {
    return normalized.replace(sectionRe, `\n${releaseSection.trimEnd()}\n`)
  }

  if (normalized.startsWith('# Changelog')) {
    const splitAt = normalized.indexOf('\n## [')
    if (splitAt >= 0) {
      return `${normalized.slice(0, splitAt).trimEnd()}\n\n${releaseSection.trimEnd()}\n${normalized.slice(splitAt).replace(/^\n+/, '')}`
    }
  }

  return `${normalized.trimEnd()}\n\n${releaseSection.trimEnd()}\n`
}

export async function collectCurrentVersionSnapshot({
  repoRoot,
  repoCfg,
  unitResults = [],
  readVersion,
  config,
  resolveRepoRoot,
  readVersionFromRepo,
}) {
  const nextVersionByUnit = new Map((unitResults || []).map((unit) => [unit.unitId, unit.to]))
  const units = []

  for (const unit of (repoCfg?.units || [])) {
    const version = nextVersionByUnit.get(unit.id) || await readVersion(unit)
    const displayName = await inferPackageName(repoRoot, unit)
    const kind = unit.type === 'layer' ? 'layer' : (unit.type === 'app' ? 'app' : 'other')

    units.push({
      id: unit.id,
      kind,
      version,
      displayName,
      name: unit.name || unit.id,
      location: inferUnitLocation(unit),
      repoId: repoCfg?.id || null,
      external: false,
    })
  }

  const linkedChildRepos = (config?.repos || []).filter((candidate) =>
    candidate?.git?.linkedSubmoduleInParent?.mode === 'propagate'
    && candidate?.git?.linkedSubmoduleInParent?.parentRepoId === repoCfg?.id
  )

  for (const childRepoCfg of linkedChildRepos) {
    const childRepoRoot = typeof resolveRepoRoot === 'function'
      ? resolveRepoRoot(childRepoCfg)
      : path.resolve(childRepoCfg?.root || '.')

    for (const childUnit of (childRepoCfg?.units || [])) {
      const version = typeof readVersionFromRepo === 'function'
        ? await readVersionFromRepo(childRepoRoot, childUnit)
        : await readVersion(childUnit)
      const displayName = await inferPackageName(childRepoRoot, childUnit)
      const kind = childUnit.type === 'layer' ? 'layer' : (childUnit.type === 'app' ? 'app' : 'other')

      units.push({
        id: childUnit.id,
        kind,
        version,
        displayName,
        name: childUnit.name || childUnit.id,
        location: childRepoCfg?.git?.linkedSubmoduleInParent?.submodulePath || inferUnitLocation(childUnit),
        repoId: childRepoCfg?.id || null,
        external: true,
      })
    }
  }

  const appUnit = units.find((unit) => unit.kind === 'app' && !unit.external)
    || units.find((unit) => unit.id === repoCfg?.git?.messageFromUnit)
    || units[0]
    || null

  return { appUnit, allUnits: units }
}

export function collectReleaseEntries({ unitMap, classifier, unitsMetaById = {} }) {
  const commitMap = new Map()

  for (const info of (unitMap?.values?.() || [])) {
    const unitLabel = unitsMetaById[info.unit.id]?.displayName || info.unit.name || info.unit.id
    for (const commit of (info.commits || [])) {
      const key = commit.hash
      const existing = commitMap.get(key) || {
        hash: commit.hash,
        subject: commit.subject,
        body: commit.body,
        units: new Set(),
      }
      existing.units.add(unitLabel)
      commitMap.set(key, existing)
    }
  }

  return [...commitMap.values()]
    .map((commit) => {
      const classified = classifier?.classify?.(commit.subject, commit.body) || null
      if (!classified) return null
      return {
        hash: commit.hash,
        tag: classified.tag,
        desc: classified.desc,
        units: uniqueSorted([...commit.units]),
      }
    })
    .filter(Boolean)
}

export async function writeChangelog({
  repoRoot,
  output = 'CHANGELOG.md',
  version,
  releaseDate = formatReleaseDate(),
  repoCfg,
  config,
  unitResults = [],
  unitMap,
  classifier,
  readVersion,
  readVersionFromRepo,
  resolveRepoRoot,
  versionedOutput,
}) {
  if (!version) throw new Error('Versione release mancante per la generazione del changelog')
  if (typeof readVersion !== 'function') throw new Error('readVersion non disponibile per la generazione del changelog')

  const snapshot = await collectCurrentVersionSnapshot({
    repoRoot,
    repoCfg,
    unitResults,
    readVersion,
    config,
    resolveRepoRoot,
    readVersionFromRepo,
  })

  const unitsMetaById = Object.fromEntries(snapshot.allUnits.map((unit) => [unit.id, unit]))
  const entries = collectReleaseEntries({ unitMap, classifier, unitsMetaById })

  const releaseSection = buildReleaseEntryMarkdown({
    version,
    releaseDate,
    appUnit: snapshot.appUnit,
    allUnits: snapshot.allUnits,
    entries,
  })

  const globalPath = path.join(repoRoot, output)
  const existingGlobal = (await fileExists(globalPath)) ? await fs.readFile(globalPath, 'utf8') : GLOBAL_CHANGELOG_HEADER
  const updatedGlobal = upsertReleaseSection(existingGlobal, releaseSection, version)

  await fs.mkdir(path.dirname(globalPath), { recursive: true })
  await fs.writeFile(globalPath, updatedGlobal.trimEnd() + '\n', 'utf8')

  const releaseOutputPath = String(versionedOutput || `docs/changelogs/CHANGELOG_${version}.md`).replace(/\{\{\s*version\s*\}\}/g, version)
  const releaseAbs = path.join(repoRoot, releaseOutputPath)
  await fs.mkdir(path.dirname(releaseAbs), { recursive: true })
  await fs.writeFile(releaseAbs, `${GLOBAL_CHANGELOG_HEADER.trimEnd()}\n\n${releaseSection.trimEnd()}\n`, 'utf8')

  return {
    output,
    releaseOutput: releaseOutputPath,
    version,
    releaseDate,
  }
}
