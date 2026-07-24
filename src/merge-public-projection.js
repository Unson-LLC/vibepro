const PUBLIC_MERGE_WARNING = 'Merge processing produced a warning. Inspect stop_reason and reconciliation state.';

export function projectPublicMergeWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  return [PUBLIC_MERGE_WARNING];
}
