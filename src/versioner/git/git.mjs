import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function git(args, { cwd, allowFail = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout;
  } catch (e) {
    if (allowFail) return null;
    const msg = (e?.stderr?.toString?.() || e?.message || 'Errore git').trim();
    const cmd = `git ${args.join(' ')}`;
    throw new Error(`${msg}\nCMD: ${cmd}\nCWD: ${cwd}`);
  }
}

export async function isWorkTree(cwd) {
  const out = await git(['rev-parse', '--is-inside-work-tree'], { cwd, allowFail: true });
  return (out ?? '').trim() === 'true';
}

export async function getStatusPorcelain(cwd) {
  const out = await git(['status', '--porcelain'], { cwd, allowFail: true });
  return (out ?? '').trim();
}

export async function getCurrentBranch(cwd) {
  const out = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, allowFail: true });
  return (out ?? '').trim();
}

export async function revParse(cwd, ref) {
  const out = await git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd, allowFail: true });
  return out ? out.trim() : null;
}

export async function getLastSemverTag(cwd, match = '*[0-9]*.[0-9]*.[0-9]*') {
  const t = await git(['describe', '--tags', '--abbrev=0', '--match', match], { cwd, allowFail: true });
  return t ? t.trim() : null;
}

export async function getTagsList(cwd) {
  const out = await git(['tag', '--list'], { cwd, allowFail: true });
  return (out ?? '').split('\n').map(s => s.trim()).filter(Boolean);
}

export async function getDefaultRemote(cwd) {
  const out = await git(['remote'], { cwd, allowFail: true });
  const remotes = (out ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!remotes.length) return null;
  if (remotes.includes('origin')) return 'origin';
  return remotes[0];
}

export async function addAll(cwd) {
  await git(['add', '-A'], { cwd });
}

export async function commit(cwd, message) {
  await git(['commit', '-m', message], { cwd });
}

export async function checkout(cwd, branch) {
  await git(['checkout', branch], { cwd });
}

export async function checkoutRef(cwd, ref) {
  await git(['checkout', ref], { cwd });
}

export async function addPath(cwd, filePath) {
  await git(['add', filePath], { cwd });
}

export async function setGitlink(cwd, filePath, sha) {
  await git(['update-index', '--cacheinfo', `160000,${sha},${filePath}`], { cwd });
}

export async function checkoutNew(cwd, branch) {
  await git(['checkout', '-b', branch], { cwd });
}

export async function branchDelete(cwd, branch) {
  await git(['branch', '-D', branch], { cwd, allowFail: true });
}

export async function cherryPick(cwd, sha) {
  await git(['cherry-pick', sha], { cwd });
}

export async function cherryPickAbort(cwd) {
  await git(['cherry-pick', '--abort'], { cwd, allowFail: true });
}

export async function amendMessage(cwd, message) {
  await git(['commit', '--amend', '-m', message, '--no-edit'], { cwd });
}

export async function merge(cwd, ref, { noEdit = true, noFF = false, noCommit = false } = {}) {
  const args = ['merge'];
  if (noFF) args.push('--no-ff');
  if (noCommit) args.push('--no-commit');
  if (noEdit) args.push('--no-edit');
  args.push(ref);
  await git(args, { cwd });
}

export async function push(cwd, remote = null, refspec = null, forceWithLease = false) {
  const args = ['push'];
  if (forceWithLease || (typeof refspec === 'string' && refspec.endsWith(':refs/heads/versions'))) args.push('--force-with-lease');
  if (remote) args.push(remote);
  if (refspec) args.push(refspec);
  await git(args, { cwd });
}

export async function pushHeadToBranch(cwd, branchName, remote = null, forceWithLease = false) {
  const r = remote || (await getDefaultRemote(cwd));
  if (!r) throw new Error(`Nessun remote configurato in ${cwd}`);

  const args = ['push'];
  if (forceWithLease) args.push('--force-with-lease');
  args.push(r, `HEAD:refs/heads/${branchName}`);
  if (branchName === 'versions') args.splice(1, 0, '--force-with-lease');

  await git(args, { cwd });
}

export async function logCommits(cwd, { range, paths = [], noMerges = false } = {}) {
  // Record separator \x1e, field separator \x1f
  const fmt = '%H%x1f%s%x1f%b%x1e';
  const args = ['log', range, `--pretty=format:${fmt}`];
  if (noMerges) args.push('--no-merges');
  if (paths?.length) {
    args.push('--');
    for (const p of paths) args.push(p);
  }
  const out = await git(args, { cwd, allowFail: true });
  if (!out) return [];
  return out.split('\x1e').map(r => r.trim()).filter(Boolean).map(rec => {
    const [hash, subject, body] = rec.split('\x1f');
    return { hash, subject: subject ?? '', body: body ?? '', message: `${subject ?? ''}\n${body ?? ''}`.trim() };
  });
}

export async function diffNameOnly(cwd, commitHash) {
  const out = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', commitHash], { cwd, allowFail: true });
  return (out ?? '').split('\n').map(s => s.trim()).filter(Boolean);
}
