const STORY_ID_PATTERN = /^story-[a-z0-9][a-z0-9._-]*$/;
const STORY_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeStoryId(value) {
  return isSafeStoryPathSegment(value)
    && STORY_ID_PATTERN.test(value);
}

export function isSafeStoryPathSegment(value) {
  return typeof value === 'string'
    && STORY_PATH_SEGMENT_PATTERN.test(value)
    && !value.includes('..')
    && !/[\\/%]/.test(value)
    && decodeSafely(value) === value;
}

export function assertSafeStoryId(value, message = 'story id must be a single safe story-* path segment') {
  if (!isSafeStoryId(value)) {
    const error = new Error(message);
    error.code = 'story_id_invalid';
    throw error;
  }
  return value;
}

export function assertSafeStoryPathSegment(value, message = 'story id must be a single safe path segment') {
  if (!isSafeStoryPathSegment(value)) {
    const error = new Error(message);
    error.code = 'story_id_invalid';
    throw error;
  }
  return value;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
