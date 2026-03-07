# git-versioner

CLI di versioning per progetti git:

- monorepo
- multi-repo
- app + layers

## Uso
- [GUIDA](./docs/GUIDA.md)

```bash
node bin/git-versioner.mjs --config ./version.config.mjs --commit --push

## Repo esterni e submodule

Per i repo esterni montati come submodule nel parent si può usare:

```js
linkedSubmoduleInParent: {
  mode: 'legacy' | 'propagate',
  parentRepoId: 'bibrid',
  submodulePath: 'layers/ui-kit'
}
```

- `legacy`: comportamento attuale, nessun update automatico del parent
- `propagate`: dopo il release del repo esterno, il versioner aggiorna anche il puntatore del submodule nel repo parent sui branch corrispondenti
