# Guida d'uso di git-versioner

Questa guida spiega come usare `git-versioner`, come strutturare il file `version.config.mjs` e come configurarlo per:

- repository singolo
- monorepo con app + layer
- progetti multi-repo
- branch dedicato `versions`
- propagazione dei commit del branch corrente sui branch target
- preflight checks e guardrail Git

---

## Descrizione

`git-versioner` è una CLI di versioning basata su Git che:

- analizza i commit successivi a una baseline
- calcola il bump semver (`patch`, `minor`, `major`)
- aggiorna file di versione e altri file configurati
- può creare commit separati per branch
- può propagare il branch corrente su branch target prima del commit di versione
- può gestire un branch separato `versions`
- può eseguire controlli preliminari prima del versioning

Il tool è pensato per:

- monorepo con più layer
- repository separati ma coordinati
- flussi con `main`, `current_version`, `versions`

---

## Dove mettere la configurazione

La configurazione **non dovrebbe stare nel repository del tool**.

La struttura consigliata è:

```txt
progetto/
├─ tools/
│  └─ git-versioner/
├─ version.config.mjs
├─ package.json
└─ layers/
```

Esempio script nel `package.json` del progetto:

```json
{
  "scripts": {
    "release:kit": "node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit",
    "release:kit:push": "node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --commit --push",
    "release:kit:dry": "node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --dry-run --explain"
  }
}
```

---

## Flusso consigliato

Ordine consigliato:

1. working tree pulito
2. branch corretto e sincronizzato
3. esecuzione dei preflight
4. `--dry-run --explain`
5. esecuzione reale con `--commit` e, se serve, `--push`

Regola pratica: **merge prima, versioning dopo**.

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

- `baseline`: da dove partire per leggere i commit nuovi
- `rules`: come interpretare i commit e ricavarne il bump
- `repos`: quali repository e unità gestire

---

## 1. baseline

La baseline dice al tool da dove iniziare per calcolare i commit “nuovi”.

```js
baseline: {
  strategy: 'file',
  file: '.release-base',
  tagMatch: '*[0-9]*.[0-9]*.[0-9]*'
}
```

### `strategy`

Valori possibili:

- `tag`
  - usa l’ultimo tag semver
- `file`
  - usa un file con hash commit, ad esempio `.release-base`
  - se manca o non è valido, può fare fallback sul tag
- `none`
  - usa tutta la history
  - sconsigliato su repo grandi

### `file`

Usato solo se `strategy = 'file'`.

Di solito contiene il commit base da cui partire.

### `tagMatch`

Pattern usato per cercare l’ultimo tag compatibile con il semver.

Esempi validi:

- `1.2.3`
- `v1.2.3`

---

## 2. preid

Serve solo in caso di prerelease.

```js
preid: 'alpha'
```

Esempi:

- `alpha`
- `beta`
- `rc`

Se non si usa prerelease, si può omettere.

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

- `[FIX]`
- `[FEAT]`
- `[PATCH]`
- `[BREAKING]`

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

- `fix(api): ...`
- `feat(ui): ...`
- `feat!: ...`

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

- `false`: i commit senza prefisso riconosciuto non contano
- `true`: il tool può considerarli secondo la sua logica

---

## 4. repos

La sezione `repos` contiene i repository da gestire.

```js
repos: [
  {
    id: 'monorepo',
    root: '.',
    preflight: { ... },
    units: [ ... ],
    git: { ... }
  }
]
```

### `id`

Nome del repository nella configurazione.

### `root`

Path del repository Git.

Può essere:

- `.` per il repo corrente
- `../layer-external-repo` per un repo separato

---

## 5. preflight

Ogni repo può definire comandi preliminari da eseguire prima del versioning.

```js
preflight: {
  commands: [
    'npm run check:guardrails',
    'npm run build'
  ]
}
```

Comportamento:

- i comandi vengono eseguiti nella `root` del repo
- l’output è **verbose** e in chiaro su terminale
- se un comando fallisce, il processo si interrompe
- sono utili per build, guardrail, smoke check e validazioni locali

### Quando usarli

Buoni candidati:

- `npm run check:all`
- `npm run build`
- `npm run lint`
- `npm run test`

Meno ideali:

- comandi che modificano il repo in modo non controllato
- comandi che dipendono da rete o ambiente instabile

---

## 6. units

Ogni repo contiene una o più `units`.

Una unit può essere:

- app
- layer
- modulo
- package versionato

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

- `app`
- `layer`

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

significa solo i commit che toccano quel layer.

#### `noMerges`

Se `true`, i merge commit non vengono considerati per quella unit.

---

## 7. version

La sezione `version` dice dove leggere e scrivere la versione principale della unit.

```js
version: {
  file: 'package.json',
  field: 'version'
}
```

### `file`

File da cui leggere e scrivere la versione.

### `field`

Campo JSON che contiene la versione.

Di solito `version`.

---

## 8. write

La sezione `write` permette di aggiornare altri file oltre alla versione principale.

Esempio:

```js
write: [
  {
    type: 'jsonSet',
    file: 'version.json',
    path: 'version',
    template: '{{version}}'
  },
  {
    type: 'readmeMarker',
    file: 'README.md',
    marker: 'APP_VERSION',
    template: '{{version}}'
  },
  {
    type: 'textReplace',
    file: 'src/version.ts',
    find: /APP_VERSION = '.*?'/,
    template: "APP_VERSION = '{{version}}'"
  }
]
```

Tipi comuni:

- `jsonSet`
- `readmeMarker`
- `textReplace`

Template supportati in generale:

- `{{version}}`
- `{{prevVersion}}`
- `{{name}}`
- `{{id}}`
- `{{type}}`
- `{{branch}}`
- `{{stamp}}`

---

## 9. changelog

Se usi il modulo changelog, puoi generare o aggiornare un file di changelog per la unit.

La configurazione precisa dipende dal progetto, ma in generale il changelog viene costruito dai commit classificati nella finestra di versione.

Consiglio pratico:

- tieni il changelog come side effect della release
- non modificare a mano il blocco generato dal tool

---

## 10. git

La sezione `git` controlla commit, merge, push e guardrail.

```js
git: {
  requireClean: true,
  commit: true,
  push: true,
  messageFromUnit: 'app',
  message: 'Versione {{version}} del {{stamp}} - {{branch}}',
  autoPushGeneratedLockfile: false,
  allowedBranches: ['main', 'release/*'],
  blockedBranches: ['feature/*'],
  requireSyncedWithUpstream: false,
}
```

### `requireClean`

Se `true`, il repo deve essere pulito prima di partire.

### `commit`

Se `true`, crea commit.

Se `false`, aggiorna solo i file.

### `push`

Se `true`, esegue anche il push.

### `messageFromUnit`

Unit da cui prendere i valori principali usati nel commit message.

Di solito l’app principale.

### `message`

Messaggio commit di default.

Template supportati:

- `{{version}}`
- `{{prevVersion}}`
- `{{branch}}`
- `{{stamp}}`
- `{{name}}`

### `allowedBranches`

Lista di pattern consentiti per il branch corrente.

Esempio:

```js
allowedBranches: ['main', 'current_version', 'release/*']
```

### `blockedBranches`

Lista di pattern vietati.

Esempio:

```js
blockedBranches: ['feature/*']
```

### `requireSyncedWithUpstream`

Se `true`, il tool si blocca se il branch corrente non è allineato con il suo upstream locale.

Casi che bloccano:

- branch ahead
- branch behind
- branch divergente

### `autoPushGeneratedLockfile`

Serve per gestire il caso in cui un preflight generi `package-lock.json` e il tool si fermerebbe perché il repo non è più pulito.

```js
git: {
  commit: true,
  push: true,
  autoPushGeneratedLockfile: true,
}
```

Comportamento:

- entra in gioco solo se `commit=true` e `push=true`
- si attiva solo se il working tree sporco contiene esclusivamente file generati tollerati
- attualmente il caso previsto è `package-lock.json`
- crea un commit tecnico
- fa push del branch corrente
- poi prosegue con il versioning

Commit tecnico usato:

```txt
chore(versioner): sync generated package-lock.json
```

Quel commit tecnico viene ignorato nel calcolo del bump.

---

## 11. Dry-run ed explain

### Dry-run

```bash
node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --dry-run
```

Il dry-run non modifica file e non crea commit, ma mostra il piano di esecuzione.

### Explain

```bash
node tools/git-versioner/bin/versioner.mjs --config ./version.config.mjs --dry-run --explain
```

Con `--explain` il tool stampa informazioni diagnostiche aggiuntive, ad esempio:

- branch corrente
- baseline usata
- stato upstream
- unit da bumpare
- commit considerati
- motivazioni del bump

È la modalità consigliata prima di una release reale.

---

## 12. Esempio completo di repo

```js
export default {
  baseline: {
    strategy: 'file',
    file: '.release-base',
    tagMatch: '*[0-9]*.[0-9]*.[0-9]*',
  },
  rules: {
    bracket: {
      enabled: true,
      map: {
        FIX: 'patch',
        FEAT: 'minor',
        BREAKING: 'major',
      },
    },
    conventional: {
      enabled: true,
      map: {
        fix: 'patch',
        feat: 'minor',
        refactor: 'patch',
      },
    },
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
        commit: true,
        push: true,
        requireSyncedWithUpstream: true,
        allowedBranches: ['main', 'current_version'],
        blockedBranches: ['feature/*'],
        autoPushGeneratedLockfile: true,
        messageFromUnit: 'app',
        message: 'Versione {{version}} del {{stamp}} - {{branch}}',
      },
      units: [
        {
          id: 'app',
          name: 'Bibrid',
          type: 'app',
          pathFilter: [],
          version: {
            file: 'package.json',
            field: 'version',
          },
          write: [
            {
              type: 'jsonSet',
              file: 'version.json',
              path: 'version',
              template: '{{version}}',
            },
            {
              type: 'readmeMarker',
              file: 'README.md',
              marker: 'APP_VERSION',
              template: '{{version}}',
            },
          ],
        },
      ],
    },
  ],
}
```

---

## 13. Troubleshooting

### Il repo è sporco dopo i preflight

Possibili cause:

- un preflight ha generato `package-lock.json`
- un comando ha scritto file non attesi
- il repo non era pulito in partenza

Contromisure:

- usa `autoPushGeneratedLockfile` solo se vuoi accettare il caso `package-lock.json`
- lascia i preflight il più possibile non distruttivi
- rilancia con `--dry-run --explain`

### Il branch non è ammesso

Controlla:

- `allowedBranches`
- `blockedBranches`
- branch corrente reale

### Il branch non è sincronizzato

Se `requireSyncedWithUpstream=true`, fai prima:

```bash
git fetch --all --prune
git status -sb
```

poi riallinea il branch.

### Il bump non è quello atteso

Controlla:

- `rules.bracket`
- `rules.conventional`
- presenza di breaking change
- commit tecnici che non dovrebbero contare
- output di `--explain`

---

## 14. Raccomandazioni pratiche

- usa sempre `--dry-run --explain` prima di una release importante
- evita di fare versioning su branch effimeri o feature branch
- evita cherry-pick arbitrari del commit di release
- preferisci merge prima e versioning dopo
- tieni i preflight veloci, affidabili e ripetibili
- tratta il lockfile tecnico come eccezione controllata, non come norma
