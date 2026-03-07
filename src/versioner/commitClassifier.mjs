import { maxBumpKind } from './semver.mjs';

/**
 * Classificatore dei commit.
 * Supporta:
 * - [FIX] ... / [FEAT] ...
 * - fix(scope): ... / feat!: ...
 * - BREAKING CHANGE nel body
 *
 * La configurazione decide quali prefissi/ tipi contano e a quale bump corrispondono.
 */
export class CommitClassifier {
  /**
   * @param {object} rules
   * @param {object} rules.bracket  { enabled: true, map: { FIX:'patch', FEAT:'minor', MAJOR:'major' } }
   * @param {object} rules.conventional { enabled: true, map: { fix:'patch', feat:'minor', refactor:'patch' } }
   * @param {object} rules.breaking { enabled: true } // forza major se rilevato
   */
  constructor(rules = {}) {
    this.rules = {
      bracket: { enabled: true, map: { FIX: 'patch', PATCH: 'patch', FEAT: 'minor', FEATURE: 'minor', MAJOR: 'major', BREAKING: 'major' }, ...(rules.bracket || {}) },
      conventional: { enabled: true, map: { fix: 'patch', feat: 'minor', perf: 'patch', refactor: 'patch', docs: 'patch', test: 'patch', build: 'patch', ci: 'patch', chore: 'patch' }, ...(rules.conventional || {}) },
      breaking: { enabled: true, ...(rules.breaking || {}) },
      allowUnprefixed: Boolean(rules.allowUnprefixed),
    };
  }

  isBreaking(subject, body) {
    const s = String(subject ?? '');
    const b = String(body ?? '');
    if (/\bBREAKING CHANGE\b/i.test(b) || /\bBREAKING-CHANGE\b/i.test(b)) return true;
    // Conventional: type!:
    if (/^\w+(\([^)]+\))?!:/.test(s)) return true;
    // Bracket: [MAJOR] / [BREAKING]
    if (/^\[\s*(MAJOR|BREAKING)\s*\]/i.test(s)) return true;
    return false;
  }

  classify(subject, body) {
    const s = (subject ?? '').trim();
    const b = (body ?? '').trim();

    if (this.rules.breaking.enabled && this.isBreaking(s, b)) return { kind: 'major', tag: 'BREAKING', scope: null, desc: s };

    // [TAG] desc
    if (this.rules.bracket.enabled) {
      const m = /^\[\s*(?<tag>[A-Za-z-]+)\s*\]\s*(?<desc>.+)$/.exec(s);
      if (m) {
        const tag = String(m.groups?.tag ?? '').toUpperCase();
        const kind = this.rules.bracket.map?.[tag] ?? null;
        if (!kind) return null;
        return { kind, tag, scope: null, desc: m.groups?.desc ?? s };
      }
    }

    // type(scope)!: desc
    if (this.rules.conventional.enabled) {
      const m = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<desc>.+)$/.exec(s);
      if (m) {
        const type = String(m.groups?.type ?? '').toLowerCase();
        const kind = this.rules.conventional.map?.[type] ?? null;
        if (!kind) return null;
        return { kind, tag: type.toUpperCase(), scope: m.groups?.scope ?? null, desc: m.groups?.desc ?? s };
      }
    }

    if (this.rules.allowUnprefixed) return { kind: null, tag: 'OTHER', scope: null, desc: s };
    return null;
  }

  /**
   * Calcola il bump massimo su una lista di commit.
   * @param {Array<{subject:string, body:string}>} commits
   * @returns {{kind: ('major'|'minor'|'patch'|null), reasons: Array<any>}}
   */
  decideBump(commits) {
    let kind = null;
    const reasons = [];

    for (const c of commits) {
      const info = this.classify(c.subject, c.body);
      if (!info || !info.kind) continue;
      kind = maxBumpKind(kind, info.kind);
      reasons.push({ ...info, subject: c.subject });
    }

    return { kind, reasons };
  }
}
