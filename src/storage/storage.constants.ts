export const S3_CLIENT = Symbol('S3_CLIENT');

export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** MIME acceptés à l’upload (le sniffe magic bytes fait foi ensuite). */
export const ALLOWED_AUDIO_MIME = [
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  /** Souvent envoyé par le picker mobile RN */
  'application/octet-stream',
] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export const AUDIO_CONTENT_TYPE_M4A = 'audio/mp4';
export const AUDIO_CONTENT_TYPE_AAC = 'audio/aac';
