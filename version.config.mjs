// tools/versioner/version.config.mjs
// Caso d'uso Bibrid:
// - App (repo monorepo) eredita bump massimo dai layer
// - Niente branch development/current_version
// - Push su main + push HEAD -> versions
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
        BREAKING: 'major',
      },
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
        chore: 'patch',
      },
    },
    breaking: { enabled: true },
    allowUnprefixed: false,
  },

  repos: [
    {
      id: 'bibrid',
      root: '.',

      units: [
        // -------------------
        // APP (root)
        // -------------------
        {
          id: 'app',
          name: 'bibrid',
          type: 'app',
          pathFilter: [],

          // Source-of-truth
          version: {file: 'package.json', field: 'version'},

          // L’app eredita bump massimo dai layer
          bumpFrom: [
            'layer-domain',
            'layer-foundation',
            'layer-app-server',
            'layer-platform',
            'layer-ui-kit',
            'layer-app-shell',
          ],
          // Remap dei bump ereditati dai layer verso l'app.
          // Esempio: una major interna al layer alza solo la minor dell'app,
          // mentre una minor del layer alza solo la patch dell'app.
          bumpFromMajor: 'minor',
          bumpFromMinor: 'patch',

          autoBump: {
            enabled: true,
            subjectRe: '\\bVersione?\\b\\s*\\d+\\.\\d+\\.\\d+',
            versionFiles: [
              '.release-base',
              'version.json',
              'package.json',
              'CHANGELOG.md',
              'README.md',
              'pnpm-lock.yaml',
              'package-lock.json',
              'yarn.lock',
              'bun.lockb',
              'nuxt.config.ts',
            ],
          },

          write: [
            // Root package
            {type: 'json-set', file: 'package.json', set: {version: '{{version}}'}},

            // Apps (se esistono, vengono aggiornati; se mancano, lo step viene skippato)
            {type: 'json-set', file: 'apps/mobile-capacitor/package.json', set: {version: '{{version}}'}},
            {type: 'json-set', file: 'apps/desktop-electron/package.json', set: {version: '{{version}}'}},

            // README root marker
            {
              type: 'readme-marker',
              file: 'README.md',
              start: '<!-- APP_VERSION_START -->',
              end: '<!-- APP_VERSION_END -->',
              template: '> Versione **{{version}}** del {{stamp}}',
            },
          ],
        },

        // -------------------
        // LAYERS
        // - crea version.json se manca (createIfMissing)
        // - aggiorna anche package.json del layer
        // -------------------
        makeLayer('domain', '0.0.0'),
        makeLayer('foundation', '0.0.0'),
        makeLayer('app-server', '0.0.1'),
        makeLayer('platform', '0.0.0'),
        makeLayer('ui-kit', '0.0.0'),
        makeLayer('app-shell', '0.0.0'),
      ],

      git: {
        requireClean: true,
        commit: true,
        push: true,

        commitPerBranch: true,
        commitPerBranchMode: 'apply',
        // Quando pusha sugli altri branch, mergea prima anche i commit del branch corrente
        // e poi aggiunge il commit di versione su ciascun branch target.
        mergeCurrentBranchIntoTargets: true,
        // Il branch versions resta lineare e riceve solo il suo commit di versione, salvo override esplicito.
        mergeCurrentBranchIntoVersionsBranch: false,

        messageFromUnit: 'app',
        // include anche il branch corrente (quello da cui lanci lo script)
        includeCurrentBranch: true,
        // messaggio commit per branch corrente (se diverso)
        currentBranchMessage: 'Versione {{version}} del {{stamp}} - {{branch}}',

        branches: [
          {name: 'main', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - main'},
          {name: 'current_version', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - current_version'},
        ],

        versionsBranch: 'versions',
        versionsBranchMessage: 'Versione {{version}} del {{stamp}} - versions',
      }
    }
  ],
};

function makeLayer(layerDirName, defaultVersion) {
  const base = `layers/${layerDirName}`;

  return {
    id: `layer-${layerDirName}`,
    name: layerDirName,
    type: 'layer',
    pathFilter: [base],

    // Source-of-truth: version.json (creato se manca)
    version: {
      file: `${base}/version.json`,
      field: 'version',
      createIfMissing: true,
      default: defaultVersion,
      initial: {
        name: layerDirName,
        version: defaultVersion,
        date: '{{stamp}}',
      },
    },

    write: [
      // version.json
      {
        type: 'json-set',
        file: `${base}/version.json`,
        createIfMissing: true,
        initial: { name: layerDirName, version: defaultVersion, date: '{{stamp}}' },
        set: { name: layerDirName, version: '{{version}}', date: '{{stamp}}' },
      },

      // package.json del layer (se non esiste, skip)
      {
        type: 'json-set',
        file: `${base}/package.json`,
        set: { version: '{{version}}' },
      },

      // README marker layer (se non esiste o mancano i marker, skip)
      {
        type: 'readme-marker',
        file: `${base}/README.md`,
        start: '<!-- LAYER_VERSION_START -->',
        end: '<!-- LAYER_VERSION_END -->',
        template: 'Version {{version}} del {{stamp}}',
      },
    ],
  };
}