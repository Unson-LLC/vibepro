// Shared vocabulary for scanners that would otherwise report `pass` when they
// scanned zero targets. "No findings because nothing was examined" and "no
// findings after examining N targets" are different claims; conflating them
// (the vacuum-pass pattern) makes a gate's `pass` unreadable. This module
// gives scanners a single place to resolve the distinction and to attach the
// scan-coverage evidence that backs it up.

export function resolveScanConclusiveness({ scannedCount, applicable }) {
  if ((scannedCount ?? 0) > 0) {
    return { status: null, reason: null };
  }
  if (applicable) {
    return {
      status: 'inconclusive',
      reason: '検査対象を1件も発見できなかった。検査対象の不在はpassの証拠にならないため、判定不能（inconclusive）として扱う。'
    };
  }
  return {
    status: 'not_applicable',
    reason: 'このスキャナの走査対象に該当しないため、検査対象0件は対象外（not_applicable）として扱う。'
  };
}

export function buildScanCoverage({ scannedCount, roots }) {
  return {
    scanned_count: scannedCount ?? 0,
    roots: Array.isArray(roots) ? [...roots] : []
  };
}

const STATUS_LABELS = {
  inconclusive: {
    ja: 'inconclusive（検査対象を発見できなかった＝合格ではない）',
    en: 'inconclusive (no scan targets discovered — not a pass)'
  },
  not_applicable: {
    ja: 'not_applicable（このスキャナの対象外）',
    en: 'not_applicable (out of scope for this scanner)'
  }
};

// Renders a scanner status for human-facing summaries/reports. Statuses
// outside the vacuum-pass vocabulary (pass/fail/block/needs_review/...) pass
// through unchanged.
export function describeScanStatus(status, language = 'ja') {
  const entry = STATUS_LABELS[status];
  if (!entry) return status;
  return entry[language] ?? entry.ja;
}
