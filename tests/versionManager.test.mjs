import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { VersionManager } from '../src/versioner/versionManager.mjs'

const execFileAsync = promisify(execFile)

async function git(cwd, args) {
  return await execFileAsync('git', args, { cwd })
}

test('la modalità apply di commitPerBranch scrive i file prima del commit su singolo branch', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-manager-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n\nvecchio\n\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])

    await writeFile(path.join(dir, 'fix.txt'), 'x\n')
    await git(dir, ['add', 'fix.txt'])
    await git(dir, ['commit', '-m', 'fix: change'])

    const manager = new VersionManager({
      baseline: { strategy: 'file', file: '.release-base' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
            { type: 'readme-marker', file: 'README.md', start: '', end: '', template: 'Versione {{version}}' },
          ],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          message: 'Versione {{version}} - {{branch}}',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          branches: [],
        },
      }],
    })

    await manager.run({ commit: true, push: false })

    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.version, '0.0.1')
    assert.match(await readFile(path.join(dir, 'README.md'), 'utf8'), /Versione 0\.0\.1/)
    assert.match(await readFile(path.join(dir, '.release-base'), 'utf8'), /^[0-9a-f]{40}\n$/)

    const { stdout: subject } = await git(dir, ['log', '-1', '--pretty=%s'])
    assert.match(subject.trim(), /^Versione 0\.0\.1 - /)

    const { stdout: status } = await git(dir, ['status', '--porcelain'])
    assert.equal(status, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('la modalità apply risolve automaticamente i conflitti generati su release-base in un normale branch di destinazione', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-releasebase-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n\nvecchio\n\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    const { stdout: initialSha } = await git(dir, ['rev-parse', 'HEAD'])
    await git(dir, ['branch', 'release'])

    await git(dir, ['checkout', 'release'])
    await writeFile(path.join(dir, '.release-base'), initialSha.trim() + '\n')
    await git(dir, ['add', '.release-base'])
    await git(dir, ['commit', '-m', 'chore: seed release baseline'])

    await git(dir, ['checkout', '-b', 'dev', initialSha.trim()])
    await writeFile(path.join(dir, 'fix.txt'), 'x\n')
    await git(dir, ['add', 'fix.txt'])
    await git(dir, ['commit', '-m', 'fix: change'])
    const { stdout: featureSha } = await git(dir, ['rev-parse', 'HEAD'])

    const manager = new VersionManager({
      baseline: { strategy: 'file', file: '.release-base' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
            { type: 'readme-marker', file: 'README.md', start: '', end: '', template: 'Versione {{version}}' },
          ],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          message: 'Versione {{version}} - {{branch}}',
          currentBranchMessage: 'Versione {{version}} - dev',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          branches: [{ name: 'release', message: 'Versione {{version}} - release' }],
        },
      }],
    })

    await manager.run({ commit: true, push: false })

    const { stdout: releaseBase } = await git(dir, ['show', 'release:.release-base'])
    assert.equal(releaseBase.trim(), featureSha.trim())
    const { stdout: releasePkg } = await git(dir, ['show', 'release:package.json'])
    assert.equal(JSON.parse(releasePkg).version, '0.0.1')
    const { stdout: unmerged } = await git(dir, ['diff', '--name-only', '--diff-filter=U'])
    assert.equal(unmerged, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('il branch corrente del sottomodulo collegato si propaga al branch corrente del genitore con nomi diversi', async () => {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-parent-'))
  const childDir = path.join(parentDir, 'child')
  try {
    await git(parentDir, ['init'])
    await git(parentDir, ['config', 'user.email', 'test@example.invalid'])
    await git(parentDir, ['config', 'user.name', 'Utente Test'])

    await git(parentDir, ['init', 'child'])
    await git(childDir, ['config', 'user.email', 'test@example.invalid'])
    await git(childDir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(childDir, 'package.json'), JSON.stringify({ name: 'child', version: '0.0.0' }, null, 2) + '\n')
    await git(childDir, ['add', '.'])
    await git(childDir, ['commit', '-m', 'chore: child initial'])
    await git(childDir, ['checkout', '-b', 'child-dev'])
    const { stdout: childInitialSha } = await git(childDir, ['rev-parse', 'HEAD'])

    await writeFile(path.join(parentDir, 'package.json'), JSON.stringify({ name: 'parent', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(parentDir, 'README.md'), '# Parent\n\n\nvecchio\n\n')
    await git(parentDir, ['add', 'package.json', 'README.md'])
    await git(parentDir, ['update-index', '--add', '--cacheinfo', `160000,${childInitialSha.trim()},child`])
    await git(parentDir, ['commit', '-m', 'chore: parent initial'])
    await git(parentDir, ['checkout', '-b', 'parent-dev'])

    await writeFile(path.join(childDir, 'fix.txt'), 'x\n')
    await git(childDir, ['add', 'fix.txt'])
    await git(childDir, ['commit', '-m', 'fix: child change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [
        {
          id: 'child-repo',
          root: childDir,
          units: [{
            id: 'child-unit',
            name: 'child',
            type: 'layer',
            pathFilter: [],
            version: { file: 'package.json', field: 'version' },
            write: [{ type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }],
          }],
          git: {
            requireClean: true,
            commit: true,
            push: false,
            messageFromUnit: 'child-unit',
            message: 'Versione {{version}} - child:{{branch}}',
            commitPerBranch: true,
            commitPerBranchMode: 'apply',
            branches: [],
            linkedSubmoduleInParent: {
              mode: 'propagate',
              parentRepoId: 'parent-repo',
              submodulePath: 'child',
            },
          },
        },
        {
          id: 'parent-repo',
          root: parentDir,
          units: [{
            id: 'app',
            name: 'parent',
            type: 'app',
            pathFilter: [],
            version: { file: 'package.json', field: 'version' },
            bumpFrom: ['child-unit'],
            bumpFromMinor: 'patch',
            write: [
              { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
              { type: 'readme-marker', file: 'README.md', start: '', end: '', template: 'Versione {{version}}' },
            ],
          }],
          git: {
            requireClean: true,
            commit: true,
            push: false,
            messageFromUnit: 'app',
            message: 'Versione {{version}} - parent:{{branch}}',
            commitPerBranch: true,
            commitPerBranchMode: 'apply',
            branches: [],
          },
        },
      ],
    })

    await manager.run({ commit: true, push: false })

    const { stdout: childHead } = await git(childDir, ['rev-parse', 'HEAD'])
    const { stdout: parentGitlink } = await git(parentDir, ['rev-parse', 'HEAD:child'])
    assert.equal(parentGitlink.trim(), childHead.trim())

    const { stdout: subject } = await git(parentDir, ['log', '-1', '--pretty=%s'])
    assert.equal(subject.trim(), 'Versione 0.0.1 - parent:parent-dev')
  } finally {
    await rm(parentDir, { recursive: true, force: true })
  }
})

test('la modalità apply unisce i commit della sorgente in una destinazione che ha commit diversi', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-merge-target-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'main'])

    await git(dir, ['checkout', 'main'])
    await writeFile(path.join(dir, 'main.txt'), 'main\n')
    await git(dir, ['add', 'main.txt'])
    await git(dir, ['commit', '-m', 'fix: main-only change'])

    await git(dir, ['checkout', '-b', 'feature', 'HEAD~1'])
    await writeFile(path.join(dir, 'feature.txt'), 'feature\n')
    await git(dir, ['add', 'feature.txt'])
    await git(dir, ['commit', '-m', 'feat: feature change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch', feat: 'minor', chore: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [{ type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          includeCurrentBranch: true,
          mergeCurrentBranchIntoTargets: true,
          branches: [{ name: 'main', message: 'Versione {{version}} - main' }],
        },
      }],
    })

    await manager.run({ commit: true, push: false })

    const { stdout: mainFiles } = await git(dir, ['ls-tree', '--name-only', 'main'])
    assert.match(mainFiles, /main\.txt/)
    assert.match(mainFiles, /feature\.txt/)
    const { stdout: restoredBranch } = await git(dir, ['branch', '--show-current'])
    assert.equal(restoredBranch.trim(), 'feature')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('il push in modalità apply accetta una sorgente in avanti e crea una destinazione locale mancante dal server remoto', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-remote-target-'))
  const remoteDir = path.join(root, 'remote.git')
  const dir = path.join(root, 'work')
  try {
    await git(root, ['init', '--bare', remoteDir])
    await git(root, ['init', dir])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await git(dir, ['remote', 'add', 'origin', remoteDir])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'main'])
    await git(dir, ['checkout', '-b', 'feature'])
    await git(dir, ['push', '-u', 'origin', 'main', 'feature'])
    await git(dir, ['branch', '-D', 'main'])

    await writeFile(path.join(dir, 'feature.txt'), 'feature\n')
    await git(dir, ['add', 'feature.txt'])
    await git(dir, ['commit', '-m', 'feat: feature change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { feat: 'minor', chore: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [{ type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: true,
          messageFromUnit: 'app',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          includeCurrentBranch: true,
          syncTargetsWithRemote: true,
          mergeCurrentBranchIntoTargets: true,
          branches: [{ name: 'main', remote: 'origin', message: 'Versione {{version}} - main' }],
        },
      }],
    })

    await manager.run({ commit: true, push: true })

    const { stdout: remoteMainFiles } = await git(dir, ['ls-tree', '--name-only', 'origin/main'])
    assert.match(remoteMainFiles, /feature\.txt/)
    const { stdout: restoredBranch } = await git(dir, ['branch', '--show-current'])
    assert.equal(restoredBranch.trim(), 'feature')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('la modalità apply interrompe un merge di destinazione fallito e ripristina il branch sorgente', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-merge-conflict-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'conflict.txt'), 'initial\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'main'])

    await git(dir, ['checkout', 'main'])
    await writeFile(path.join(dir, 'conflict.txt'), 'main\n')
    await git(dir, ['add', 'conflict.txt'])
    await git(dir, ['commit', '-m', 'fix: main change'])

    await git(dir, ['checkout', '-b', 'feature', 'HEAD~1'])
    await writeFile(path.join(dir, 'conflict.txt'), 'feature\n')
    await git(dir, ['add', 'conflict.txt'])
    await git(dir, ['commit', '-m', 'feat: feature change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch', feat: 'minor', chore: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [{ type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          includeCurrentBranch: true,
          mergeCurrentBranchIntoTargets: true,
          branches: [{ name: 'main', message: 'Versione {{version}} - main' }],
        },
      }],
    })

    await assert.rejects(() => manager.run({ commit: true, push: false }), /Merge fallito di feature su main/)

    const { stdout: restoredBranch } = await git(dir, ['branch', '--show-current'])
    assert.equal(restoredBranch.trim(), 'feature')
    const { stdout: status } = await git(dir, ['status', '--porcelain'])
    assert.equal(status, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('crea un tag annotato configurato sulla testa di un branch di destinazione esplicito', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-tags-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n\nvecchio\n\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'release'])

    await writeFile(path.join(dir, 'fix.txt'), 'x\n')
    await git(dir, ['add', 'fix.txt'])
    await git(dir, ['commit', '-m', 'fix: change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo-repo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
            { type: 'readme-marker', file: 'README.md', start: '', end: '', template: 'Versione {{version}}' },
          ],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          message: 'Versione {{version}} - {{branch}}',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          branches: [{ name: 'release', message: 'Versione {{version}} - release' }],
          tag: {
            enabled: true,
            targets: 'release',
            name: 'demo-v{{version}}',
            message: 'Demo {{version}} {{branch}}',
          },
        },
      }],
    })

    const result = await manager.run({ commit: true, push: false })

    assert.deepEqual(result.results[0].git.tags.map((tag) => tag.name), ['demo-v1.0.1'])
    const { stdout: tagTarget } = await git(dir, ['rev-list', '-n', '1', 'demo-v1.0.1'])
    const { stdout: releaseHead } = await git(dir, ['rev-parse', 'release'])
    assert.equal(tagTarget.trim(), releaseHead.trim())
    const { stdout: tagMessage } = await git(dir, ['tag', '-n99', 'demo-v1.0.1'])
    assert.match(tagMessage, /Demo 1\.0\.1 release/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rifiuta nomi di tag duplicati tra più destinazioni di tag', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-tags-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n\nvecchio\n\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'release'])

    await writeFile(path.join(dir, 'fix.txt'), 'x\n')
    await git(dir, ['add', 'fix.txt'])
    await git(dir, ['commit', '-m', 'fix: change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo-repo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
            { type: 'readme-marker', file: 'README.md', start: '', end: '', template: 'Versione {{version}}' },
          ],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          message: 'Versione {{version}} - {{branch}}',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          branches: [{ name: 'release', message: 'Versione {{version}} - release' }],
          tag: {
            enabled: true,
            targets: 'all',
            name: 'demo-v{{version}}',
          },
        },
      }],
    })

    await assert.rejects(
        () => manager.run({ commit: true, push: false }),
        /Nome tag duplicato "demo-v1\.0\.1"/
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('consente un unico nome tag per più destinazioni quando puntano allo stesso commit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-tags-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2) + '\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'stable'])

    await writeFile(path.join(dir, 'fix.txt'), 'x\n')
    await git(dir, ['add', 'fix.txt'])
    await git(dir, ['commit', '-m', 'fix: change'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo-repo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [{ type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          message: 'Versione {{version}} - {{branch}}',
          commitPerBranch: false,
          branches: [{ name: 'stable' }],
          tag: {
            enabled: true,
            targets: 'all',
            name: 'demo-v{{version}}',
          },
        },
      }],
    })

    const result = await manager.run({ commit: true, push: false })

    assert.deepEqual(result.results[0].git.tags.map((tag) => tag.name), ['demo-v1.0.1'])
    const { stdout: tags } = await git(dir, ['tag', '--list', 'demo-v1.0.1'])
    assert.equal(tags.trim(), 'demo-v1.0.1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('il merge a cascata (cascade merge) si propaga attraverso i branch intermedi invece di unire direttamente la sorgente', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-cascade-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Utente Test'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])

    // Crea staging e main dalla stessa base
    await git(dir, ['branch', 'staging'])
    await git(dir, ['branch', 'main'])

    // Branch feature: aggiunge un commit di tipo feature
    await git(dir, ['checkout', '-b', 'feature'])
    await writeFile(path.join(dir, 'feature.txt'), 'feature\n')
    await git(dir, ['add', 'feature.txt'])
    await git(dir, ['commit', '-m', 'feat: feature change'])

    // Branch staging: aggiunge un commit solo su staging (diverge da feature)
    await git(dir, ['checkout', 'staging'])
    await writeFile(path.join(dir, 'staging.txt'), 'staging\n')
    await git(dir, ['add', 'staging.txt'])
    await git(dir, ['commit', '-m', 'fix: staging-only change'])

    // Branch main: aggiunge un commit solo su main (diverge sia da feature che da staging)
    await git(dir, ['checkout', 'main'])
    await writeFile(path.join(dir, 'main.txt'), 'main\n')
    await git(dir, ['add', 'main.txt'])
    await git(dir, ['commit', '-m', 'fix: main-only change'])

    // Torna a feature (branch sorgente)
    await git(dir, ['checkout', 'feature'])

    const manager = new VersionManager({
      baseline: { strategy: 'none' },
      rules: {
        bracket: { enabled: true, map: {} },
        conventional: { enabled: true, map: { fix: 'patch', feat: 'minor', chore: 'patch' } },
        breaking: { enabled: true },
        allowUnprefixed: false,
      },
      repos: [{
        id: 'demo',
        root: dir,
        units: [{
          id: 'app',
          name: 'demo',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [{ type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          includeCurrentBranch: true,
          mergeCurrentBranchIntoTargets: true,
          mergeCascade: true,
          branches: [
            { name: 'staging', message: 'Versione {{version}} - staging' },
            { name: 'main', message: 'Versione {{version}} - main' },
          ],
        },
      }],
    })

    await manager.run({ commit: true, push: false })

    // Verifica che tutti i branch abbiano il file di versione aggiornato
    for (const branch of ['feature', 'staging', 'main']) {
      const { stdout: pkg } = await git(dir, ['show', `${branch}:package.json`])
      const parsed = JSON.parse(pkg)
      assert.equal(parsed.version, '0.1.0', `${branch} dovrebbe avere la versione 0.1.0`)
    }

    // Verifica che main contenga staging.txt (unito tramite staging, non direttamente da feature)
    const { stdout: mainFiles } = await git(dir, ['ls-tree', '--name-only', 'main'])
    assert.match(mainFiles, /staging\.txt/, 'main dovrebbe contenere staging.txt tramite la cascata')
    assert.match(mainFiles, /feature\.txt/, 'main dovrebbe contenere feature.txt tramite la cascata passando da staging')
    assert.match(mainFiles, /main\.txt/, 'main dovrebbe mantenere i propri file')

    // Verifica che il commit di testa di main sia un commit di merge (2 genitori) proveniente da staging
    const { stdout: mergeParents } = await git(dir, ['log', 'main', '-1', '--format=%P'])
    const parents = mergeParents.trim().split(' ')
    assert.equal(parents.length, 2, 'la testa di main dovrebbe essere un commit di merge con 2 genitori')

    // Il secondo genitore dovrebbe essere il commit della versione di staging, non di feature
    const { stdout: secondParentBranch } = await git(dir, ['name-rev', '--name-only', parents[1]])
    assert.match(secondParentBranch, /staging/, 'il secondo genitore del merge dovrebbe provenire dal branch staging')

    // Verifica se mi trovo sul branch originale
    const { stdout: restoredBranch } = await git(dir, ['branch', '--show-current'])
    assert.equal(restoredBranch.trim(), 'feature')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})