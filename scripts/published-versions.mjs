export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.pre.length && right.pre.length) return 1;
  if (left.pre.length && !right.pre.length) return -1;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    if (left.pre[index] === undefined) return -1;
    if (right.pre[index] === undefined) return 1;
    if (left.pre[index] === right.pre[index]) continue;
    const ln = /^\d+$/.test(left.pre[index]);
    const rn = /^\d+$/.test(right.pre[index]);
    if (ln && rn) return Number(left.pre[index]) > Number(right.pre[index]) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left.pre[index] > right.pre[index] ? 1 : -1;
  }
  return 0;
}

export function parseSemver(value) {
  const match = `${value}`.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);
  if (!match) throw new Error(`Invalid SemVer: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4]?.split('.') ?? [] };
}

const NUMERIC = '(?:0|[1-9][0-9]*)';
const IDENTIFIER = `(?:${NUMERIC}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`, 'u');

function sortedSemvers(values) {
  return [...values].filter((version) => SEMVER.test(version)).sort(compareSemver);
}

// Ascending npm versions newer than the oldest version already in `ledger`; versions predating the ledger are ignored.
export function publishedVersions(npmTime, ledger = []) {
  const oldest = sortedSemvers(ledger)[0];
  return sortedSemvers(Object.keys(npmTime)).filter((version) => !oldest || compareSemver(version, oldest) > 0);
}
