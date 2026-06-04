import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { applyJsonSet } from '../src/versioner/fileOps.mjs'

test('applyJsonSet supports createIfMissing in dry-run without writing files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-fileops-'))
  try {
    const result = await applyJsonSet(
      dir,
      {
        type: 'json-set',
        file: 'version.json',
        createIfMissing: true,
        initial: { name: '{{name}}', version: '0.0.0' },
        set: { version: '{{version}}' }
      },
      { name: 'layer', version: '1.2.3' },
      true
    )

    assert.equal(result.changed, true)
    assert.equal(result.file, 'version.json')
    assert.equal(existsSync(path.join(dir, 'version.json')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyJsonSet creates and updates missing JSON files when not in dry-run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'git-versioner-fileops-'))
  try {
    const result = await applyJsonSet(
      dir,
      {
        type: 'json-set',
        file: 'version.json',
        createIfMissing: true,
        initial: { name: '{{name}}', version: '0.0.0' },
        set: { version: '{{version}}' }
      },
      { name: 'layer', version: '1.2.3' },
      false
    )

    assert.equal(result.changed, true)
    const saved = JSON.parse(await readFile(path.join(dir, 'version.json'), 'utf8'))
    assert.deepEqual(saved, { name: 'layer', version: '1.2.3' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
