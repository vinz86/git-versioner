# Guida d'uso di git-versioner

Questa guida spiega come usare `git-versioner`, come strutturare il file `version.config.mjs` e come configurarlo per:

* repository singolo
* monorepo con app + layer
* progetti multi-repo
* branch dedicato `versions`
* propagazione dei commit del branch corrente sui branch target

---

## Descrizione

`git-versioner` è una CLI di versioning basata su Git che:

* analizza i commit successivi a una baseline
* calcola il bump semver (`patch`, `minor`, `major`)
* aggiorna file di versione e altri file configurati
* può creare commit separati per branch
* può propagare il branch corrente su branch target prima del commit di versione
* può gestire un branch separato `versions`

Il tool è pensato per:

* monorepo con più layer
* repository separati ma coordinati
* flussi con `main`, `current_version`, `versions`

---

## Dove mettere la configurazione

La configurazione **non dovrebbe stare nel repository del tool**.

La struttura consigliata è:

```txt
|progetto/
|--|tools/
|--|--|git-versioner/
|--|version.config.mjs # config del progetto
|--|package.json
|--|layers/
```

Esempio script nel `package.json` del progetto:

```json
{
  "scripts": {
    "release:kit": "node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit",
    "release:kit:push": "node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit --push",
    "release:kit:safe": "node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit --push --auto-push-generated-lockfile"
  }
}
```

---

## Struttura generale della configurazione

La config esporta un oggetto di questo tipo:

```js
export default {
  baseline: { ... },
  rules: { ... },
  repos: [ ... ]
}
```

Le sezioni principali sono:

* `baseline`: da dove partire per leggere i commit nuovi
* `rules`: come interpretare i commit e ricavarne il bump
* `repos`: quali repository e unità gestire

---

## 1. baseline

La baseline dice al tool da dove iniziare per calcolare i commit “nuovi”

```js
baseline: {
  strategy: 'file',
  file: '.release-base',
  tagMatch: '*[0-9]*.[0-9]*.[0-9]*'
}
```

### `strategy`

Valori possibili:

* `tag`

    * usa l’ultimo tag semver
* `file`

    * usa un file con hash commit, ad esempio `.release-base`
    * se manca o non è valido, può fare fallback sul tag
* `none`

    * usa tutta la history
    * sconsigliato su repo grandi (non testato) TODO

### `file`

Usato solo se `strategy = 'file'`.

Di solito contiene il commit base da cui partire

### `tagMatch`

Pattern usato per cercare l’ultimo tag compatibile con il semver

Esempi validi:

* `1.2.3`
* `v1.2.3`

---

## 2. preid

Serve solo in caso di prerelease.

```js
preid: 'alpha'
```

Esempi:

* `alpha`
* `beta`
* `rc`

Se non si usa prerelease, si può omettere

---

## 3. rules

Le `rules` definiscono come i commit vengono tradotti in bump semver.

```js
rules: {
  bracket: { ... },
  conventional: { ... },
  breaking: { enabled: true },
  allowUnprefixed: false
}
```

### 3.1 bracket

Supporta commit con prefissi tipo:

* `[FIX]`
* `[FEAT]`
* `[PATCH]`
* `[BREAKING]`

Esempio:

```js
bracket: {
  enabled: true,
  map: {
    FIX: 'patch',
    FEAT: 'minor',
    MAJOR: 'major',
    BREAKING: 'major'
  }
}
```

### 3.2 conventional

Supporta Conventional Commits.

Esempi:

* `fix(api): ...`
* `feat(ui): ...`
* `feat!: ...`

Esempio config:

```js
conventional: {
  enabled: true,
  map: {
    fix: 'patch',
    feat: 'minor',
    refactor: 'patch'
  }
}
```

### 3.3 breaking

Se `enabled: true`, il tool intercetta breaking change e forza `major`.

```js
breaking: { enabled: true }
```

### 3.4 allowUnprefixed

```js
allowUnprefixed: false
```

* `false`: i commit senza prefisso riconosciuto non contano
* `true`: il tool può considerarli secondo la sua logica

---

## 4. repos

La sezione `repos` contiene i repository da gestire

```js
repos: [
  {
    id: 'monorepo',
    root: '.',
    units: [ ... ],
    git: { ... }
  }
]
```

### `id`

Nome del repository nella configurazione

### `root`

Path del repository Git

Può essere:

* `.` per il repo corrente
* `../layer-external-repo` per un repo separato

---

## 5. units

Ogni repo contiene una o più `units`.

Una unit può essere:

* app
* layer
* modulo
* package versionato

Esempio:

```js
{
  id: 'app',
  name: 'my-app',
  type: 'app',
  pathFilter: [],
  version: {
    file: 'package.json',
    field: 'version'
  },
  write: [ ... ]
}
```

### Campi principali

#### `id`

Identificatore univoco della unit.

#### `name`

Nome descrittivo.

#### `type`

Valore libero ma consigliati:

* `app`
* `layer`

#### `pathFilter`

Lista di cartelle/file da considerare per il calcolo dei commit di quella unit.

Esempi:

```js
pathFilter: []
```

significa tutto il repo.

```js
pathFilter: ['layers/layer-core']
```

significa solo i commit che toccano quel layer

#### `noMerges`

Se `true`, i merge commit non vengono considerati per quella unit

---

## 6. version

Definisce il file “source of truth” della versione.

```js
version: {
  file: 'package.json',
  field: 'version'
}
```

Per file che possono non esistere ancora:

```js
version: {
  file: 'layers/layer-core/version.json',
  field: 'version',
  createIfMissing: true,
  default: '0.0.0',
  initial: {
    name: 'layer-core',
    version: '0.0.0',
    date: '{{stamp}}'
  }
}
```

### Opzioni

* `file`: file JSON da leggere/scrivere
* `field`: campo della versione
* `createIfMissing`: crea il file se manca
* `default`: versione iniziale
* `initial`: struttura iniziale del file

---

## 7. bumpFrom

Permette all’app principale di ereditare il bump massimo da altre parti (es layer)

```js
bumpFrom: ['layer-core', 'layer-ui']
```

Esempio:

* `layer-core` -> `minor`
* `layer-ui` -> `patch`
* `app` eredita almeno `minor`

### Rimappare il bump ereditato

Per attenuare il bump ereditato:

```js
bumpFromMajor: 'minor',
bumpFromMinor: 'patch'
```

Significa:

* una `major` di un layer fa solo `minor` sull’app
* una `minor` di un layer fa solo `patch` sull’app

Valori ammessi:

* `major`
* `minor`
* `patch`

Se omessi, il bump mantiene la severity originale.

---

## 8. autoBump

Serve a ignorare commit già generati dal tool di versioning.

```js
autoBump: {
  enabled: true,
  subjectRe: '\\bVersione?\\b\\s*\\d+\\.\\d+\\.\\d+',
  versionFiles: [
    'package.json',
    'version.json',
    '.release-base',
    'CHANGELOG.md',
    'README.md'
  ]
}
```

### `subjectRe`

Regex per riconoscere i commit di versione

### `versionFiles`

Lista di file normalmente toccati dal release/versioner

---

## 9. write

Le azioni `write` indicano quali file aggiornare.

Tipi principali:

* `json-set`
* `readme-marker`
* `text-replace`

### 9.1 json-set

Aggiorna campi JSON.

```js
{
  type: 'json-set',
  file: 'package.json',
  set: {
    version: '{{version}}'
  }
}
```

### 9.2 readme-marker

Aggiorna una sezione delimitata da marker.

```js
{
  type: 'readme-marker',
  file: 'README.md',
  start: '<!-- APP_VERSION_START -->',
  end: '<!-- APP_VERSION_END -->',
  template: '> Versione **{{version}}** del {{stamp}}'
}
```

### 9.3 text-replace

Fa replace testuale usando regex

```js
{
  type: 'text-replace',
  file: 'nuxt.config.ts',
  replace: [
    {
      pattern: "appVersion\\s*:\\s*['\"][^'\"]+['\"]",
      with: "appVersion: '{{version}}'"
    }
  ]
}
```

---

## 10. preflight

Puoi definire una lista di comandi da eseguire **prima** della generazione versione.

```js
preflight: {
  commands: [
    "npm run check:guardrails",
    "npm run build"
  ]
}
```

Uso tipico:

* controlli architetturali
* build
* smoke test rapidi

Se uno dei comandi fallisce, il processo si interrompe.

I comandi vengono eseguiti nella root del repo configurato (`repo.root`).

---

## 11. git

La sezione `git` controlla commit, merge e push

```js
git: {
  requireClean: true,
  commit: true,
  push: true,
  messageFromUnit: 'app',
  message: 'Versione {{version}} del {{stamp}} - {{branch}}'
}
```

### `requireClean`

Se `true`, il repo deve essere pulito prima di partire.

### `commit`

Se `true`, crea commit

Se `false`, aggiorna solo i file.

### `push`

Se `true`, esegue anche il push

### `autoPushGeneratedLockfile`

Se `true`, quando il repo è sporco **solo** per un `package-lock.json` generato, il tool può creare automaticamente un commit tecnico e fare push del file prima di proseguire.

Condizioni:

* `commit = true`
* `push = true`
* il repo deve essere sporco solo per `package-lock.json` e per eventuali path già tollerati dal tool (es. submodule gitlink)

Il commit tecnico usa il messaggio:

* `chore(versioner): sync generated package-lock.json`

Questo commit viene ignorato nel calcolo del bump.

### `messageFromUnit`

Unit da cui prendere i valori principali usati nel commit message.

Di solito l’app principale

### `message`

Messaggio commit di default

Template supportati:

* `{{version}}`
* `{{prevVersion}}`
* `{{stamp}}`
* `{{branch}}`
* `{{repo}}`
* `{{unit}}`
* `{{name}}`
* `{{bump}}`

---

## 11. commitPerBranch

```js
commitPerBranch: true
```

### Se `false`

Un commit unico viene pushato su più branch

### Se `true`

Ogni branch riceve il suo commit dedicato

È utile per messaggi diversi su:

* `main`
* `current_version`
* `versions`
* branch corrente

---

## 12. commitPerBranchMode

```js
commitPerBranchMode: 'apply'
```

Valori:

* `apply`
* `cherry-pick`

### `apply` (consigliato)

Flusso:

1. checkout del branch target
2. merge opzionale del branch sorgente
3. scrittura file versione
4. commit con messaggio del branch target
5. push del branch target

Nota: se lanci il tool con `--no-commit --no-push`, in modalita' `apply` le modifiche vengono scritte solo sul branch/worktree corrente del repo, senza fare checkout degli altri branch.

### `cherry-pick`

Più fragile in caso di conflitti (da testare TODO)

---

## 13. mergeCurrentBranchIntoTargets

```js
mergeCurrentBranchIntoTargets: true
```

Se `true`, prima del commit di versione su ciascun branch target, il tool prova a mergiare il branch corrente

* per propagare i commit funzionali del branch corrente e poi aggiungere anche il commit di versione

Se `false`, sui target va solo il commit di versione

---

## 14. includeCurrentBranch

```js
includeCurrentBranch: true
```

Se `true`, il branch da cui lanci il tool viene incluso tra i branch da processare.

Se `false`, vengono processati solo i branch esplicitamente dichiarati e l’eventuale `versionsBranch`

---

## 15. currentBranchMessage

Messaggio commit per il branch corrente.

```js
currentBranchMessage: 'Versione {{version}} del {{stamp}} - {{branch}}'
```

Se manca, viene usato `message` o il default del tool

---

## 16. branches

Lista dei branch target normali.

```js
branches: [
  {
    name: 'main',
    remote: 'origin',
    message: 'Versione {{version}} del {{stamp}} - main'
  },
  {
    name: 'current_version',
    remote: 'origin',
    message: 'Versione {{version}} del {{stamp}} - current_version'
  }
]
```

Ogni branch può avere:

* `name`
* `remote`
* `message`

---

## 17. versionsBranch

Branch separato dedicato a snapshot/version tracking.

```js
versionsBranch: 'versions'
```

Ha una logica diversa rispetto ai branch normali.

Può:

* avere messaggio dedicato
* non mergiare il branch corrente
* essere pushato con policy specifiche

### `versionsBranchMessage`

```js
versionsBranchMessage: 'Versione {{version}} del {{stamp}} - versions'
```

### `mergeCurrentBranchIntoVersionsBranch`

```js
mergeCurrentBranchIntoVersionsBranch: false
```

* `true`: anche `versions` prova a mergiare il branch corrente
* `false`: `versions` riceve solo il commit di versione dedicato

Meglio `false` così il branch `versions` resta lineare

### `versionsBranchForce`

Opzionale e un pò rischioso Può essere utile per forzare il push di `versions`.

Esempio:

```js
versionsBranchForce: 'force-with-lease'
```

---

## 18. Esempio: monorepo app + layer

```js
export default {
  baseline: {
    strategy: 'file',
    file: '.release-base',
    tagMatch: '*[0-9]*.[0-9]*.[0-9]*'
  },

  rules: {
    bracket: {
      enabled: true,
      map: {
        FIX: 'patch',
        FEAT: 'minor',
        BREAKING: 'major'
      }
    },
    conventional: {
      enabled: true,
      map: {
        fix: 'patch',
        feat: 'minor'
      }
    },
    breaking: { enabled: true },
    allowUnprefixed: false
  },

  repos: [
    {
      id: 'monorepo',
      root: '.',
      units: [
        {
          id: 'app',
          name: 'my-app',
          type: 'app',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          bumpFrom: ['layer-core', 'layer-ui'],
          bumpFromMajor: 'minor',
          bumpFromMinor: 'patch',
          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }
          ]
        },
        {
          id: 'layer-core',
          name: 'layer-core',
          type: 'layer',
          pathFilter: ['layers/layer-core'],
          version: {
            file: 'layers/layer-core/version.json',
            field: 'version',
            createIfMissing: true,
            default: '0.0.0',
            initial: { name: 'layer-core', version: '0.0.0', date: '{{stamp}}' }
          },
          write: [
            {
              type: 'json-set',
              file: 'layers/layer-core/version.json',
              createIfMissing: true,
              initial: { name: 'layer-core', version: '0.0.0', date: '{{stamp}}' },
              set: { name: 'layer-core', version: '{{version}}', date: '{{stamp}}' }
            }
          ]
        }
      ],
      git: {
        requireClean: true,
        commit: true,
        push: true,
        messageFromUnit: 'app',
        commitPerBranch: true,
        commitPerBranchMode: 'apply',
        mergeCurrentBranchIntoTargets: true,
        includeCurrentBranch: true,
        currentBranchMessage: 'Versione {{version}} del {{stamp}} - {{branch}}',
        branches: [
          { name: 'main', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - main' },
          { name: 'current_version', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - current_version' }
        ],
        versionsBranch: 'versions',
        versionsBranchMessage: 'Versione {{version}} del {{stamp}} - versions',
        mergeCurrentBranchIntoVersionsBranch: false
      }
    }
  ]
}
```

---

## 19. Esempio: repo separato

```js
export default {
  baseline: {
    strategy: 'file',
    file: '.release-base',
    tagMatch: '*[0-9]*.[0-9]*.[0-9]*'
  },
  rules: {
    bracket: {
      enabled: true,
      map: {
        FIX: 'patch',
        FEAT: 'minor',
        BREAKING: 'major'
      }
    },
    conventional: {
      enabled: true,
      map: {
        fix: 'patch',
        feat: 'minor'
      }
    },
    breaking: { enabled: true },
    allowUnprefixed: false
  },
  repos: [
    {
      id: 'layer-external',
      root: '../layer-external-repo',
      units: [
        {
          id: 'layer-external',
          name: 'layer-external',
          type: 'layer',
          pathFilter: [],
          version: { file: 'package.json', field: 'version' },
          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } }
          ]
        }
      ],
      git: {
        requireClean: true,
        commit: true,
        push: true,
        commitPerBranch: false,
        messageFromUnit: 'layer-external',
        message: 'Versione {{version}} del {{stamp}} - {{branch}}',
        branches: [
          { name: 'main', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - main' }
        ]
      }
    }
  ]
}
```

## 21. Comando

```bash
node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit --push
```

---

## 22. Checklist finale

Prima di usare il tool verifica:

* repo pulito
* config nel progetto corretto
* branch target esistenti
* `versionsBranch` configurato correttamente
* `messageFromUnit` punta alla unit giusta
* `pathFilter` coerenti
* `version.file` e `write.file` esistenti o con `createIfMissing`

---
