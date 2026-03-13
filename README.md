# git-versioner

CLI di versioning per progetti git:

- monorepo
- multi-repo
- app + layers
- changelogs

## Uso
- [GUIDA](./docs/GUIDA.md)

```bash
node bin/git-versioner.mjs --config ./version.config.mjs --commit --push
```

Esempio con auto-push del `package-lock.json` generato:

```bash
node bin/git-versioner.mjs --config ./version.config.mjs --commit --push --auto-push-generated-lockfile
```
