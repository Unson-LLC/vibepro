import { createHash } from 'node:crypto';

export function deriveDispatchIdentity(dispatch) {
  const surface = requireText(dispatch.inspection_surface_hash, 'inspection_surface_hash');
  const digest = `${dispatch.run_id}:${dispatch.adapter_id}:${dispatch.task_id}:${dispatch.role}:${surface}:${dispatch.reviewer_identity ?? ''}:${dispatch.implementation_session_id ?? ''}`;
  return `dispatch-${createHash('sha256').update(digest).digest('hex').slice(0, 16)}`;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}
