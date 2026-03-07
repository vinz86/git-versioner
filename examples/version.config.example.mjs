/**
 * version.config.example.mjs
 *
 * Config esempio per git-versioner.
 *
 * --------------------------------------------------
 * - I path sono relativi alla root del repo.
 * - Template disponibili: {{version}} {{prevVersion}} {{stamp}} {{branch}} {{repo}} {{unit}} {{name}} {{bump}}
 * - stamp formato: DD/MM/YYYY hh:mm
 * - commitPerBranchMode: 'apply'  (consigliato)----> checkout branch -> write -> commit -> push
 * - versionsBranch: branch separato per snapshot/version tracking
 * - bumpFrom: permette all'app di ereditare il bump massimo dai layer
 */

export default {

  // Da dove iniziare a leggere i commit nuovi
  baseline: {
    strategy: 'file', // 'tag' | 'file' | 'none'
    file: '.release-base',
    tagMatch: '*[0-9]*.[0-9]*.[0-9]*'
  },

  // preid: 'alpha', // opzionale per prerelease (o beta ecc)

  // Come vengono tradotti i commit in bump semver
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

    // se false i commit senza prefisso non influenzano il bump
    allowUnprefixed: false
  },

  repos: [
    {
      id: 'monorepo',
      root: '.',

      units: [

        // APP
        {
          id: 'app',
          name: 'my-app',
          type: 'app',

          // commit da considerare
          pathFilter: [],

          // file che contiene la versione
          version: {
            file: 'package.json',
            field: 'version'
          },

          //eredita bump dai layer
          bumpFrom: ['layer-core', 'layer-ui'],

          // modifica i bump dei layer
          // bumpFromMajor: 'minor',
          // bumpFromMinor: 'patch',

          // ignora commit di versioning
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
          },

          //file da aggiornare
          write: [
            {
              type: 'json-set',
              file: 'package.json',
              set: { version: '{{version}}' }
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

        //LAYER (esempio)
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
            }
          ]
        }
      ],

      //GIT
      git: {

        requireClean: true,

        commit: true,
        push: true,

        messageFromUnit: 'app',
        message: 'Versione {{version}} del {{stamp}} - {{branch}}',

        // commit separati per branch
        commitPerBranch: true,
        commitPerBranchMode: 'apply',

        // merge branch corrente nei target
        mergeCurrentBranchIntoTargets: true,

        includeCurrentBranch: true,
        currentBranchMessage: 'Versione {{version}} del {{stamp}} - {{branch}}',

        // branch target
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

        // branch snapshot versioni
        versionsBranch: 'versions',
        versionsBranchMessage: 'Versione {{version}} del {{stamp}} - versions',

        // mantiene versions lineare
        mergeCurrentBranchIntoVersionsBranch: false,

        // versionsBranchForce: 'force-with-lease'
      }
    },

    // ESEMPIO REPO SEPARATO
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