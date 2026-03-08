#!/usr/bin/env node
  import path from 'node:path';
  import { pathToFileURL } from 'node:url';

  import { VersionManager } from '../src/versioner/index.mjs';

  function parseArgs(argv) {
    const args = {
      config: 'version.config.mjs',
      since: null,
      commit: null,
      push: null,
      allowDirty: false,
      dryRun: false,
      preid: null,
      changelog: null
    };

    for (let i = 2; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--config') args.config = argv[++i];
      else if (a === '--since') args.since = argv[++i];
      else if (a === '--commit') args.commit = true;
      else if (a === '--no-commit') args.commit = false;
      else if (a === '--changelog') args.changelog = true;
      else if (a === '--no-changelog') args.changelog = false;
      else if (a === '--push') args.push = true;
      else if (a === '--no-push') args.push = false;
      else if (a === '--allow-dirty') args.allowDirty = true;
      else if (a === '--dry-run') args.dryRun = true;
      else if (a === '--preid') args.preid = argv[++i];
      else if (a === '-h' || a === '--help') {
        console.log(`Uso:
  node bin/versioner.mjs --config version.config.mjs [--since <tag|hash>] [--commit|--no-commit] [--push|--no-push] [--allow-dirty] [--dry-run] [--preid alpha]
`);
        process.exit(0);
      }
    }
    return args;
  }

  async function loadConfig(cfgPath) {
    const abs = path.isAbsolute(cfgPath) ? cfgPath : path.join(process.cwd(), cfgPath);
    const mod = await import(pathToFileURL(abs).href);
    return mod.default || mod.config || mod;
  }

  async function main() {
    const args = parseArgs(process.argv);
    const config = await loadConfig(args.config);

    if (args.preid) config.preid = args.preid;

    const mgr = new VersionManager(config);
    const res = await mgr.run({
      since: args.since,
      commit: args.commit,
      push: args.push,
      allowDirty: args.allowDirty,
      dryRun: args.dryRun,
      changelog: args.changelog,
    });

    // output sintetico
    for (const r of res.results) {
      console.log(`\nRepo: ${r.repo} (${r.repoRoot})`);
      console.log(`Baseline: ${r.baselineRef || '(none)'}`);
      if (!r.unitResults.length) console.log('Nessuna unit da bumpare.');
      for (const u of r.unitResults) {
        console.log(`- ${u.unitId}: ${u.from} -> ${u.to} (${u.bump})`);
      }
      console.log(`Git: ${r.git.mode}`);
    }
  }

  main().catch((err) => {
    console.error(`Errore: ${err?.message ?? err}`);
    process.exit(1);
  });
