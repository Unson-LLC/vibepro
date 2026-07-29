export const AGGREGATE_REVIEW = Object.freeze({
  stage: 'architecture_spec',
  role: 'architecture_boundary'
});

export const AGGREGATE_INSPECTION_INPUT_PLACEHOLDERS = Object.freeze([
  '<design-story-spec-path>',
  '<runtime-source-path>',
  '<test-path>'
]);

export function reviewInspectionInputPlaceholders(stage, role, fallback = '<inspection-input>') {
  if (stage === AGGREGATE_REVIEW.stage && role === AGGREGATE_REVIEW.role) {
    return [...AGGREGATE_INSPECTION_INPUT_PLACEHOLDERS];
  }
  return [fallback];
}
