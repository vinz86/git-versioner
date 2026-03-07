/**
 * version.config.example.mjs
 *
 * Config completa per Versioner.
 * Obiettivo: riutilizzabile su più progetti (monorepo, repo separati o misti).
 *
 * NOTE GENERALI
 * ------------------------------------------------------------------
 * - I path sono relativi a "root" del repo (oppure assoluti).
 * - I template supportano:
 *   {{version}}, {{prevVersion}}, {{stamp}}, {{branch}},
 *   {{repo}}, {{unit}}, {{name}}, {{bump}}
 *
 * - stamp è nel formato: DD/MM/YYYY hh:mm
 *
 * - commitPerBranchMode: 'apply'
 *   È la modalità consigliata:
 *   1) checkout del branch target
 *   2) opzionale merge del branch sorgente
 *   3) scrittura file versione
 *   4) commit con messaggio del branch target
 *   5) push del branch target
 *
 * - versionsBranch
 *   È trattato come ramo separato:
 *   - può avere messaggio commit dedicato
 *   - può NON mergiare il branch corrente
 *   - può essere pushato in modo dedicato
 *
 * - bumpFrom
 *   Permette all'app principale di ereditare il bump massimo dai layer.
 *   Con bumpFromMajor / bumpFromMinor puoi "rimappare" quanto ereditato.
 *   Esempio:
 *   - major interna di un layer -> minor dell'app
 *   - minor interna di un layer -> patch dell'app
 */

export default {
  /**
   * Baseline: da dove partire per calcolare i commit "nuovi".
   *
   * strategy:
   * - "tag"  : usa l’ultimo tag semver (match configurabile)
   * - "file" : usa un file (es .release-base) con hash commit;
   *            fallback su tag se manca/non valido
   * - "none" : usa tutta la history (sconsigliato su repo grandi)
   */
  baseline: {
    strategy: 'file',                 // 'tag' | 'file' | 'none'
    file: '.release-base',            // usato solo se strategy = 'file'
    tagMatch: '*[0-9]*.[0-9]*.[0-9]*' // pattern tag semver (accetta anche prefix tipo v1.2.3)
  },

  /**
   * preid: usato solo se bump prerelease è attivo
   * Esempi:
   * - alpha
   * - beta
   * - rc
   *
   * Se non usi prerelease, puoi ometterlo.
   */
  // preid: 'alpha',

  /**
   * Regole per interpretare i commit e decidere il bump:
   *
   * - bracket:
   *   prefissi tipo [FIX], [FEAT], [PATCH], [MAJOR]
   *
   * - conventional:
   *   Conventional Commits tipo:
   *   fix(scope): ...
   *   feat!: ...
   *
   * - breaking.enabled:
   *   se trova breaking change forza major
   *
   * - allowUnprefixed:
   *   se false, i commit senza prefisso non contano nel bump
   *
   * Valori bump:
   * - 'patch'
   * - 'minor'
   * - 'major'
   */
  rules: {
    bracket: {
      enabled: true,
      map: {
        FIX: 'patch',
        PATCH: 'patch',
        FEAT: 'minor',
        FEATURE: 'minor',
        REFACTOR: 'patch',
        PERF: 'patch',
        DOCS: 'patch',
        TEST: 'patch',
        BUILD: 'patch',
        CI: 'patch',
        CHORE: 'patch',
        VERSION: 'patch',
        UPDATE: 'patch',
        MAJOR: 'major',
        BREAKING: 'major'
      }
    },

    conventional: {
      enabled: true,
      map: {
        fix: 'patch',
        feat: 'minor',
        perf: 'patch',
        refactor: 'patch',
        docs: 'patch',
        test: 'patch',
        build: 'patch',
        ci: 'patch',
        chore: 'patch'
      }
    },

    breaking: { enabled: true },

    /**
     * Se false:
     * - un commit senza prefisso riconosciuto non contribuisce al bump
     *
     * Se true:
     * - il tool può considerare anche commit non prefissati
     *   secondo la logica implementata
     */
    allowUnprefixed: false
  },

  /**
   * Repos gestiti.
   *
   * Puoi avere:
   * - monorepo: un solo repo con app + layers
   * - repo separati: app su repo A, layer su repo B/C
   */
  repos: [
    {
      id: 'monorepo',
      root: '.',

      units: [
        // ==========================================================
        // UNIT: APP
        // ==========================================================
        {
          id: 'app',
          name: 'my-app',
          type: 'app',

          /**
           * pathFilter:
           * limita i commit considerati per questa unit.
           *
           * Esempi:
           * - [] = tutto il repo
           * - ['apps/my-app'] = solo modifiche lì
           * - ['apps/my-app', 'layers', 'server'] = più aree
           */
          pathFilter: [
            // 'apps/my-app',
            // 'layers',
            // 'server',
            // 'pages',
            // 'components',
            // 'composables'
          ],

          /**
           * noMerges:
           * se true, i merge commit non vengono considerati
           * nel calcolo del bump di questa unit.
           */
          // noMerges: true,

          /**
           * Version source-of-truth:
           * - file: file JSON che contiene la versione
           * - field: campo da aggiornare
           *
           * Opzioni supportate:
           * - createIfMissing
           * - default
           * - initial
           */
          version: {
            file: 'package.json',
            field: 'version',
            // createIfMissing: false,
            // default: '0.0.0',
            // initial: { name: 'my-app', version: '0.0.0', date: '{{stamp}}' }
          },

          /**
           * bumpFrom:
           * l’app eredita il bump massimo da altre unit.
           *
           * Esempio:
           * se layer-core fa minor
           * e layer-ui fa patch
           * l'app eredita almeno minor
           */
          bumpFrom: ['layer-core', 'layer-ui'],

          /**
           * Rimappatura del bump ereditato da bumpFrom.
           *
           * Uso tipico:
           * vuoi che una major interna di un layer
           * NON faccia diventare major anche l'app.
           *
           * Esempio:
           * - bumpFromMajor: 'minor'
           *   una major dei layer alza solo la minor dell'app
           *
           * - bumpFromMinor: 'patch'
           *   una minor dei layer alza solo la patch dell'app
           *
           * Valori ammessi:
           * - 'major'
           * - 'minor'
           * - 'patch'
           *
           * Se omessi:
           * il bump ereditato mantiene la sua severità originale.
           */
          // bumpFromMajor: 'minor',
          // bumpFromMinor: 'patch',

          /**
           * autoBump:
           * ignora commit autogenerati dal versionamento.
           *
           * subjectRe:
           * regex per riconoscere commit di versione
           *
           * versionFiles:
           * file tipici toccati dal release/versioning
           */
          autoBump: {
            enabled: true,
            subjectRe: '\\bVersione?\\b\\s*\\d+\\.\\d+\\.\\d+',
            versionFiles: [
              'package.json',
              'version.json',
              '.release-base',
              'CHANGELOG.md',
              'README.md',
              'pnpm-lock.yaml',
              'package-lock.json',
              'yarn.lock',
              'bun.lockb',
              'nuxt.config.ts'
            ]
          },

          /**
           * write:
           * azioni di scrittura sui file.
           *
           * Tipi principali:
           * - json-set
           * - readme-marker
           * - text-replace
           */
          write: [
            {
              type: 'json-set',
              file: 'package.json',
              set: {
                version: '{{version}}'
              }
            },

            {
              type: 'readme-marker',
              file: 'README.md',
              start: '<!-- APP_VERSION_START -->',
              end: '<!-- APP_VERSION_END -->',
              template: '> Versione **{{version}}** del {{stamp}}'
            },

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
          ]
        },

        // ==========================================================
        // UNIT: LAYER (esempio)
        // ==========================================================
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
            initial: {
              name: 'layer-core',
              version: '0.0.0',
              date: '{{stamp}}'
            }
          },

          write: [
            {
              type: 'json-set',
              file: 'layers/layer-core/version.json',
              createIfMissing: true,
              initial: {
                name: 'layer-core',
                version: '0.0.0',
                date: '{{stamp}}'
              },
              set: {
                name: 'layer-core',
                version: '{{version}}',
                date: '{{stamp}}'
              }
            },

            {
              type: 'json-set',
              file: 'layers/layer-core/package.json',
              set: { version: '{{version}}' }
            },

            {
              type: 'readme-marker',
              file: 'layers/layer-core/README.md',
              start: '<!-- LAYER_VERSION_START -->',
              end: '<!-- LAYER_VERSION_END -->',
              template: 'Version {{version}} del {{stamp}}'
            }
          ]
        }
      ],

      /**
       * Config Git per il repo.
       */
      git: {
        /**
         * requireClean:
         * se true, il tool parte solo se il repo è pulito.
         */
        requireClean: true,

        /**
         * commit:
         * se true, crea commit.
         * se false, aggiorna solo i file.
         */
        commit: true,

        /**
         * push:
         * se true, esegue anche push sui branch target.
         */
        push: true,

        /**
         * messageFromUnit:
         * unit da cui prendere i valori template principali
         * per i commit message.
         *
         * Tipicamente:
         * - l'app principale
         */
        messageFromUnit: 'app',

        /**
         * message:
         * messaggio di default se non specificato sui singoli branch.
         */
        message: 'Versione {{version}} del {{stamp}} - {{branch}}',

        /**
         * commitPerBranch:
         *
         * - false:
         *   un commit unico (stesso hash) -> pushato su più branch
         *
         * - true:
         *   commit separati per branch
         *   utile se vuoi messaggi commit diversi per main/current_version/versions
         */
        commitPerBranch: true,

        /**
         * commitPerBranchMode:
         *
         * - 'apply'
         *   checkout branch -> apply write -> commit -> push
         *   È la modalità consigliata.
         *
         * - 'cherry-pick'
         *   commit base -> cherry-pick sui target -> amend messaggio
         *   Più fragile in caso di conflitti.
         */
        commitPerBranchMode: 'apply',

        /**
         * mergeCurrentBranchIntoTargets:
         *
         * Se true:
         * prima di scrivere il commit versione su ciascun branch target,
         * il tool prova a mergiare il branch corrente dentro quel target.
         *
         * Uso tipico:
         * vuoi propagare sia:
         * - i commit funzionali del branch corrente
         * - sia il commit di versionamento
         *
         * Se false:
         * sui target va solo il commit di versione.
         */
        mergeCurrentBranchIntoTargets: true,

        /**
         * includeCurrentBranch:
         *
         * Se true:
         * include anche il branch da cui stai lanciando il tool
         * tra quelli da processare.
         *
         * Se false:
         * processa solo i branch esplicitamente elencati in "branches"
         * e l'eventuale versionsBranch.
         */
        includeCurrentBranch: true,

        /**
         * currentBranchMessage:
         * messaggio commit dedicato al branch corrente.
         *
         * Se omesso, usa "message" oppure la logica di default.
         */
        currentBranchMessage: 'Versione {{version}} del {{stamp}} - {{branch}}',

        /**
         * branches:
         * elenco branch target normali.
         *
         * Ogni branch può avere:
         * - name
         * - remote
         * - message
         */
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
        ],

        /**
         * versionsBranch:
         * branch separato dedicato a snapshot/version tracking.
         *
         * A differenza dei branch normali:
         * - può avere messaggio proprio
         * - può NON mergiare il branch corrente
         * - può essere pushato con policy dedicate
         */
        versionsBranch: 'versions',

        /**
         * versionsBranchMessage:
         * messaggio specifico per il commit sul branch versions.
         *
         * Se omesso, il tool usa un default tipo:
         * 'Versione {{version}} del {{stamp}} - versions'
         */
        versionsBranchMessage: 'Versione {{version}} del {{stamp}} - versions',

        /**
         * mergeCurrentBranchIntoVersionsBranch:
         *
         * Se true:
         * anche il branch "versions" prova a mergiare il branch corrente
         * prima del commit di versione.
         *
         * Se false:
         * "versions" riceve solo il commit di versione dedicato.
         *
         * Consiglio:
         * nella maggior parte dei casi conviene false,
         * così "versions" resta lineare e pulito.
         */
        mergeCurrentBranchIntoVersionsBranch: false,

        /**
         * versionsBranchForce:
         * opzionale, se il tuo tool/supporto Git lo prevede.
         *
         * Esempi:
         * - 'force'
         * - 'force-with-lease'
         *
         * Utile soprattutto se "versions" viene riscritto spesso.
         */
        // versionsBranchForce: 'force-with-lease'
      }
    },

    // ==========================================================
    // ESEMPIO: repo separato (layer in repo dedicato)
    // ==========================================================
    {
      id: 'layer-external',
      root: '../layer-external-repo',

      units: [
        {
          id: 'layer-external',
          name: 'layer-external',
          type: 'layer',
          pathFilter: [],

          version: {
            file: 'package.json',
            field: 'version'
          },

          write: [
            {
              type: 'json-set',
              file: 'package.json',
              set: { version: '{{version}}' }
            }
          ]
        }
      ],

      git: {
        requireClean: true,
        commit: true,
        push: true,

        /**
         * In repo semplice puoi anche scegliere commitPerBranch: false
         * se vuoi un unico commit da pushare su un solo branch.
         */
        commitPerBranch: false,

        messageFromUnit: 'layer-external',
        message: 'Versione {{version}} del {{stamp}} - {{branch}}',

        branches: [
          {
            name: 'main',
            remote: 'origin',
            message: 'Versione {{version}} del {{stamp}} - main'
          }
        ]
      }
    }
  ]
};