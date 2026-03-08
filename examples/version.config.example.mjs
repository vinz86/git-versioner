/**
 * version.config.example.mjs
 *
 * Esempio completo per monorepo app + layer interni + repo layer separato.
 *
 * Note utili:
 * - Il changelog principale viene scritto in CHANGELOG.md
 * - Ogni release genera anche docs/changelogs/CHANGELOG_<versione>.md
 * - Il changelog versionato include una sezione "Versioni correnti" con app e layer
 * - Per i layer conviene valorizzare packageName per avere un nome chiaro nel changelog
 */

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
    /**
     * REPO PRINCIPALE: BIBRID
     */
    {
      id: 'bibrid',
      root: '.',

      changelog: {
        enabled: true,
        global: {
          enabled: false,
          output: 'CHANGELOG.md',
        },
        versioned: {
          enabled: true,
          output: 'docs/changelogs/CHANGELOG_{{version}}.md',
        },
      },

      units: [
        {
          id: 'app',
          name: 'bibrid',
          type: 'app',
          pathFilter: [],

          version: { file: 'package.json', field: 'version' },

          bumpFrom: [
            'layer-domain',
            'layer-foundation',
            'layer-app-server',
            'layer-platform',
            'layer-ui-kit',
            'layer-app-shell',
          ],

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
              'docs/changelogs',
              'README.md',
              'pnpm-lock.yaml',
              'package-lock.json',
              'yarn.lock',
              'bun.lockb',
              'nuxt.config.ts',
            ],
          },

          write: [
            { type: 'json-set', file: 'package.json', set: { version: '{{version}}' } },
            { type: 'json-set', file: 'apps/mobile-capacitor/package.json', set: { version: '{{version}}' } },
            { type: 'json-set', file: 'apps/desktop-electron/package.json', set: { version: '{{version}}' } },
            {
              type: 'readme-marker',
              file: 'README.md',
              start: '<!-- APP_VERSION_START -->',
              end: '<!-- APP_VERSION_END -->',
              template: '> Versione **{{version}}** del {{stamp}}',
            },
          ],
        },

        makeLayer('domain', '0.0.0'),
        makeLayer('foundation', '0.0.0'),
        makeLayer('app-server', '0.0.1'),
        makeLayer('platform', '0.0.0'),
        makeLayer('app-shell', '0.0.0'),
      ],

      git: {
        requireClean: true,
        commit: true,
        push: true,

        commitPerBranch: true,
        commitPerBranchMode: 'apply',
        mergeCurrentBranchIntoTargets: true,
        mergeCurrentBranchIntoVersionsBranch: false,

        messageFromUnit: 'app',
        includeCurrentBranch: true,
        currentBranchMessage: 'Versione {{version}} del {{stamp}} - {{branch}}',

        branches: [
          { name: 'main', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - main' },
          { name: 'current_version', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - current_version' },
        ],

        versionsBranch: 'versions',
        versionsBranchMessage: 'Versione {{version}} del {{stamp}} - versions',
      },
    },

    /**
     * REPO SEPARATO: UI-KIT
     */
    {
      id: 'ui-kit-repo',
      root: 'layers/ui-kit',

      units: [
        {
          id: 'layer-ui-kit',
          name: 'ui-kit',
          packageName: '@bibrid/ui-kit',
          type: 'layer',
          pathFilter: [],
          version: {
            file: 'version.json',
            field: 'version',
            createIfMissing: true,
            default: '0.0.0',
            initial: {
              name: 'ui-kit',
              version: '0.0.0',
              date: '{{stamp}}',
            },
          },
          write: [
            {
              type: 'json-set',
              file: 'version.json',
              createIfMissing: true,
              initial: { name: 'ui-kit', version: '0.0.0', date: '{{stamp}}' },
              set: { name: 'ui-kit', version: '{{version}}', date: '{{stamp}}' },
            },
            {
              type: 'json-set',
              file: 'package.json',
              set: { version: '{{version}}' },
            },
            {
              type: 'readme-marker',
              file: 'README.md',
              start: '<!-- LAYER_VERSION_START -->',
              end: '<!-- LAYER_VERSION_END -->',
              template: 'Version {{version}} del {{stamp}}',
            },
          ],
        },
      ],

      git: {
        requireClean: true,
        commit: true,
        push: true,

        commitPerBranch: true,
        commitPerBranchMode: 'apply',
        mergeCurrentBranchIntoTargets: true,
        mergeCurrentBranchIntoVersionsBranch: false,

        messageFromUnit: 'layer-ui-kit',
        includeCurrentBranch: true,
        currentBranchMessage: 'Versione {{version}} del {{stamp}} - ui-kit:{{branch}}',
        message: 'Versione {{version}} del {{stamp}} - ui-kit:{{branch}}',

        branches: [
          { name: 'main', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - ui-kit:main' },
          { name: 'current_version', remote: 'origin', message: 'Versione {{version}} del {{stamp}} - ui-kit:current_version' },
        ],

        versionsBranch: 'versions',
        versionsBranchMessage: 'Versione {{version}} del {{stamp}} - ui-kit:versions',

        linkedSubmoduleInParent: {
          mode: 'propagate',
          parentRepoId: 'bibrid',
          submodulePath: 'layers/ui-kit',
        },
      },
    },
  ],
};

function makeLayer(layerDirName, defaultVersion) {
  const base = `layers/${layerDirName}`;

  return {
    id: `layer-${layerDirName}`,
    name: layerDirName,
    packageName: `@bibrid/${layerDirName}`,
    type: 'layer',
    pathFilter: [base],

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
      {
        type: 'json-set',
        file: `${base}/version.json`,
        createIfMissing: true,
        initial: { name: layerDirName, version: defaultVersion, date: '{{stamp}}' },
        set: { name: layerDirName, version: '{{version}}', date: '{{stamp}}' },
      },
      {
        type: 'json-set',
        file: `${base}/package.json`,
        set: { version: '{{version}}' },
      },
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
