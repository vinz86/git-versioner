# git-versioner

<!-- TOOL_VERSION_START -->
> Versione **0.1.1**
<!-- TOOL_VERSION_END -->

CLI di versioning per progetti Git con supporto a:

- repository singolo
- monorepo
- multi-repo coordinati
- app + layers
- changelog e file di versione multipli

## Uso rapido

```bash
node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --dry-run --explain
node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit --push
```

## Opzioni utili recenti

- `preflight.commands`: esegue controlli preliminari prima del versioning, con output verbose
- `git.autoPushGeneratedLockfile`: consente il commit/push tecnico del solo `package-lock.json` generato dai preflight
- `git.allowedBranches` / `git.blockedBranches`: guardrail sul branch corrente
- `git.requireSyncedWithUpstream`: blocca il versioning se il branch non è allineato con l'upstream
- `--explain`: rende il dry-run molto più diagnostico

## CLI

```bash
node tools/git-versioner/bin/versioner.mjs \
  --config ./version.config.mjs \
  [--since <tag|hash>] \
  [--commit|--no-commit] \
  [--push|--no-push] \
  [--allow-dirty] \
  [--dry-run] \
  [--explain] \
  [--preid alpha]
```

## Esempio minimo di configurazione

```js
export default {
  baseline: {
    strategy: 'file',
    file: '.release-base',
    tagMatch: '*[0-9]*.[0-9]*.[0-9]*',
  },
  rules: {
    bracket: { enabled: true, map: { FIX: 'patch', FEAT: 'minor', BREAKING: 'major' } },
    conventional: { enabled: true, map: { fix: 'patch', feat: 'minor' } },
    breaking: { enabled: true },
    allowUnprefixed: false,
  },
  repos: [
    {
      id: 'app',
      root: '.',
      preflight: {
        commands: ['npm run check:all'],
      },
      git: {
        requireClean: true,
        requireSyncedWithUpstream: false,
        allowedBranches: ['main', 'release/*'],
        blockedBranches: ['feature/*'],
        autoPushGeneratedLockfile: false,
        commit: true,
        push: true,
      },
      units: [
        {
          id: 'app',
          name: 'App',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [],
        },
      ],
    },
  ],
}
```

## Documentazione completa

- [GUIDA](./docs/GUIDA.md)
- [Esempio config](./examples/version.config.example.mjs)
