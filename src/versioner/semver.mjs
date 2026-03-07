export const BUMP_WEIGHT = { patch: 0, minor: 1, major: 2 };

export function parseSemver(v) {
  const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+)\.(\d+))?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), preTag: m[4] ?? null, preNum: m[5] != null ? Number(m[5]) : null };
}

export function formatSemver(s) {
  const base = `${s.major}.${s.minor}.${s.patch}`;
  return (s.preTag && s.preNum != null) ? `${base}-${s.preTag}.${s.preNum}` : base;
}

export function bumpSemver(current, kind, preid = null) {
  const s = parseSemver(current);
  if (!s) throw new Error(`Versione corrente non valida: ${current}`);

  if (kind === 'major') return formatSemver({ major: s.major + 1, minor: 0, patch: 0, preTag: null, preNum: null });
  if (kind === 'minor') return formatSemver({ major: s.major, minor: s.minor + 1, patch: 0, preTag: null, preNum: null });
  if (kind === 'patch') return formatSemver({ major: s.major, minor: s.minor, patch: s.patch + 1, preTag: null, preNum: null });

  if (kind === 'prerelease') {
    const tag = preid || 'alpha';
    if (s.preTag && s.preNum != null) {
      if (s.preTag === tag) return formatSemver({ ...s, preNum: s.preNum + 1 });
      return formatSemver({ ...s, preTag: tag, preNum: 0 });
    }
    const bumped = parseSemver(bumpSemver(current, 'patch'));
    return formatSemver({ ...bumped, preTag: tag, preNum: 0 });
  }

  throw new Error(`Tipo bump sconosciuto: ${kind}`);
}

export function maxBumpKind(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (BUMP_WEIGHT[b] > BUMP_WEIGHT[a]) ? b : a;
}
