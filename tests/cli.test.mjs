import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const versionerBin = path.resolve('bin/versioner.mjs')

async function git(cwd, args) {
  return await execFileAsync('git', args, { cwd })
}

test('--no-changelog disables configured changelog outputs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-cli-'))
  try {
    await git(dir, ['init'])
    await git(dir, ['config', 'user.email', 'test@example.invalid'])
    await git(dir, ['config', 'user.name', 'Test User'])
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2) + '\n')
    await writeFile(path.join(dir, 'README.md'), '# Demo\n\n<!-- APP_VERSION_START -->\nold\n<!-- APP_VERSION_END -->\n')
    await writeFile(path.join(dir, 'version.config.mjs'), `export default {
  baseline: { strategy: 'file', file: '.release-base' },
  rules: {
    bracket: { enabled: true, map: { FEAT: 'minor' } },
    conventional: { enabled: true, map: { feat: 'minor' } },
    breaking: { enabled: true },
    allowUnprefixed: false
  },
  repos: [{
    id: 'demo',
    root: '.',
    changelog: {
      enabled: true,
      global: { enabled: true, output: 'CHANGELOG.md' },
      versioned: { enabled: true, output: 'docs/changelogs/CHANGELOG_{{version}}.md' }
    },
    units: [{
      id: 'app',
      name: 'demo',
      type: 'app',
      pathFilter: [],
      version: { file: 'package.json', field: 'version' },
      write: [
        { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
        { type: 'readme-marker', file: 'README.md', start: '<!-- APP_VERSION_START -->', end: '<!-- APP_VERSION_END -->', template: 'Version {{version}}' }
      ]
    }],
    git: { requireClean: true, commit: false, push: false, messageFromUnit: 'app' }
  }]
}\n`)
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'chore: initial'])
    await writeFile(path.join(dir, 'feature.txt'), 'x\n')
    await git(dir, ['add', 'feature.txt'])
    await git(dir, ['commit', '-m', 'feat: add feature'])

    await execFileAsync('node', [versionerBin, '--config', 'version.config.mjs', '--no-commit', '--no-push', '--no-changelog'], { cwd: dir })

    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.version, '0.1.0')
    assert.equal(existsSync(path.join(dir, 'CHANGELOG.md')), false)
    assert.equal(existsSync(path.join(dir, 'docs/changelogs/CHANGELOG_0.1.0.md')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
