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

test('commitPerBranch apply mode writes files before single-branch commit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-manager-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Test User'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n<!-- APP_VERSION_START -->\nold\n<!-- APP_VERSION_END -->\n')
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
            { type: 'readme-marker', file: 'README.md', start: '<!-- APP_VERSION_START -->', end: '<!-- APP_VERSION_END -->', template: 'Version {{version}}' },
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
    assert.match(await readFile(path.join(dir, 'README.md'), 'utf8'), /Version 0\.0\.1/)
    assert.match(await readFile(path.join(dir, '.release-base'), 'utf8'), /^[0-9a-f]{40}\n$/)

    const { stdout: subject } = await git(dir, ['log', '-1', '--pretty=%s'])
    assert.match(subject.trim(), /^Versione 0\.0\.1 - /)

    const { stdout: status } = await git(dir, ['status', '--porcelain'])
    assert.equal(status, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('commitPerBranch apply mode treats versionsBranch as a target when branches are empty', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-manager-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Test User'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n<!-- APP_VERSION_START -->\nold\n<!-- APP_VERSION_END -->\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await git(dir, ['branch', 'versions'])

    await writeFile(path.join(dir, 'fix.txt'), 'x\n')
    await git(dir, ['add', 'fix.txt'])
    await git(dir, ['commit', '-m', 'fix: change'])

    const { stdout: currentBranch } = await git(dir, ['branch', '--show-current'])
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
            { type: 'readme-marker', file: 'README.md', start: '<!-- APP_VERSION_START -->', end: '<!-- APP_VERSION_END -->', template: 'Version {{version}}' },
          ],
        }],
        git: {
          requireClean: true,
          commit: true,
          push: false,
          messageFromUnit: 'app',
          message: 'Versione {{version}} - {{branch}}',
          currentBranchMessage: 'Versione {{version}} - current:{{branch}}',
          commitPerBranch: true,
          commitPerBranchMode: 'apply',
          branches: [],
          versionsBranch: 'versions',
          versionsBranchMessage: 'Versione {{version}} - versions',
          mergeCurrentBranchIntoVersionsBranch: true,
        },
      }],
    })

    const result = await manager.run({ commit: true, push: false })

    assert.deepEqual(result.results[0].git.branches.sort(), [currentBranch.trim(), 'versions'].sort())

    const { stdout: currentSubject } = await git(dir, ['log', '-1', '--pretty=%s', currentBranch.trim()])
    const { stdout: versionsSubject } = await git(dir, ['log', '-1', '--pretty=%s', 'versions'])
    assert.match(currentSubject.trim(), /^Versione 0\.0\.1 - current:/)
    assert.equal(versionsSubject.trim(), 'Versione 0.0.1 - versions')

    const { stdout: versionsPkg } = await git(dir, ['show', 'versions:package.json'])
    assert.equal(JSON.parse(versionsPkg).version, '0.0.1')

    const { stdout: restoredBranch } = await git(dir, ['branch', '--show-current'])
    assert.equal(restoredBranch.trim(), currentBranch.trim())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
