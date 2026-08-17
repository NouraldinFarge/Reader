export const IMPORT_LIMITS = Object.freeze({
  managedFileBytes: 512 * 1024 * 1024,
  epubArchiveBytes: 200 * 1024 * 1024,
  epubEntries: 5_000,
  epubSections: 1_000,
  epubEntryBytes: 16 * 1024 * 1024,
  epubMetadataBytes: 2 * 1024 * 1024,
  embeddedImageBytes: 8 * 1024 * 1024,
  embeddedImageCount: 200,
  embeddedImageTotalBytes: 48 * 1024 * 1024,
  textFileBytes: 32 * 1024 * 1024,
  titleCharacters: 500,
  authorCharacters: 500,
  descriptionCharacters: 5_000,
  navigationLabelCharacters: 500,
  markupNodes: 25_000,
  markupDepth: 80,
  markupTextCharacters: 8_000_000,
  aaxHeaderBytes: 4 * 1024 * 1024,
});

export class ImportPolicyError extends Error {
  constructor(message, code = 'reader-import-policy') {
    super(message);
    this.name = 'ImportPolicyError';
    this.code = code;
  }
}

function decodePath(value) {
  let decoded = String(value ?? '');
  for (let pass = 0; pass < 2; pass += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new ImportPolicyError('The publication contains a malformed encoded path.');
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function hasForbiddenPathPrefix(value) {
  return (
    value.startsWith('/') ||
    value.startsWith('//') ||
    /^[a-z]:($|\/)/i.test(value) ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  );
}

function assertPathCharacters(value) {
  if (!value || /[\0-\x1f\x7f]/.test(value)) {
    throw new ImportPolicyError('The publication contains an empty or control-character path.');
  }
}

export function normalizeArchiveEntryName(path) {
  const decoded = decodePath(path).replaceAll('\\', '/');
  assertPathCharacters(decoded);
  if (hasForbiddenPathPrefix(decoded)) {
    throw new ImportPolicyError('The publication contains an absolute or external archive path.');
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new ImportPolicyError('The publication contains a path outside its package root.');
  }
  const normalized = segments.filter((segment) => segment && segment !== '.').join('/');
  assertPathCharacters(normalized);
  return normalized;
}

export function resolvePublicationPath(baseFile, reference) {
  const rawReference = String(reference ?? '').trim();
  if (!rawReference) return normalizeArchiveEntryName(baseFile);
  if (/[\0-\x1f\x7f]/.test(rawReference)) return null;

  const pathOnly = rawReference.split('#', 1)[0].split('?', 1)[0];
  if (!pathOnly) return normalizeArchiveEntryName(baseFile);

  let decoded;
  try {
    decoded = decodePath(pathOnly).replaceAll('\\', '/');
  } catch {
    return null;
  }
  if (hasForbiddenPathPrefix(decoded)) return null;

  let normalizedBase;
  try {
    normalizedBase = normalizeArchiveEntryName(baseFile);
  } catch {
    return null;
  }
  const baseSegments = normalizedBase.split('/');
  baseSegments.pop();
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!baseSegments.length) return null;
      baseSegments.pop();
    } else {
      baseSegments.push(segment);
    }
  }
  return baseSegments.length ? baseSegments.join('/') : null;
}

export function classifyPublicationHref(href, sourcePath = '') {
  const value = String(href ?? '').trim();
  if (!value || /[\0-\x1f\x7f]/.test(value)) return { kind: 'unsafe' };
  if (value.startsWith('#')) {
    const target = value.slice(1);
    return /^[a-zA-Z][\w:.-]{0,100}$/.test(target) ? { kind: 'anchor', target } : { kind: 'unsafe' };
  }
  if (/^https?:/i.test(value)) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol)
        ? { kind: 'external', href: url.href }
        : { kind: 'unsafe' };
    } catch {
      return { kind: 'unsafe' };
    }
  }
  if (value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return { kind: 'unsafe' };
  const path = resolvePublicationPath(sourcePath, value);
  return path ? { kind: 'internal', path } : { kind: 'unsafe' };
}

export function boundedText(value, maximum, fallback = '') {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  return normalized.slice(0, maximum);
}

export function createExtractionBudget(maximumBytes, label = 'publication') {
  let usedBytes = 0;
  return {
    consume(byteLength) {
      const amount = Number(byteLength);
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new ImportPolicyError(`The ${label} reported an invalid extracted size.`);
      }
      if (usedBytes + amount > maximumBytes) {
        throw new ImportPolicyError(
          `The ${label} expands beyond its ${Math.round(maximumBytes / 1024 / 1024)} MB safety limit.`,
          'reader-import-limit',
        );
      }
      usedBytes += amount;
      return usedBytes;
    },
    get maximumBytes() {
      return maximumBytes;
    },
    get usedBytes() {
      return usedBytes;
    },
  };
}

function concatenateChunks(chunks, byteLength) {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function readZipEntryBytes(
  entry,
  { budget, maximumBytes = IMPORT_LIMITS.epubEntryBytes, label = 'EPUB entry', signal } = {},
) {
  if (!entry?.internalStream) throw new ImportPolicyError(`The ${label} is unavailable.`);
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');

  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let settled = false;
    const helper = entry.internalStream('uint8array');
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      try {
        helper.pause();
      } catch {
        // A completed or failed JSZip stream no longer needs to be paused.
      }
      finish(reject, new DOMException('The import was cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    helper
      .on('data', function onData(value) {
        if (settled) return;
        try {
          const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
          if (byteLength + chunk.byteLength > maximumBytes) {
            throw new ImportPolicyError(
              `The ${label} exceeds its extracted-byte limit.`,
              'reader-import-limit',
            );
          }
          budget?.consume(chunk.byteLength);
          byteLength += chunk.byteLength;
          chunks.push(chunk);
        } catch (error) {
          this.pause();
          finish(reject, error);
        }
      })
      .on('error', (error) => {
        finish(reject, error);
      })
      .on('end', () => {
        finish(resolve, concatenateChunks(chunks, byteLength));
      })
      .resume();
  });
}

export function decodePublicationText(bytes, label = 'Publication text') {
  let encoding = 'utf-8';
  let offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    throw new ImportPolicyError(`${label} is not valid Unicode text.`);
  }
}

export async function readZipEntryText(entry, options) {
  return decodePublicationText(await readZipEntryBytes(entry, options), options?.label);
}

export function detectRasterImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) return null;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintPublicationFile(
  file,
  { directHashLimit = 64 * 1024 * 1024, chunkBytes = 4 * 1024 * 1024, signal } = {},
) {
  if (!globalThis.crypto?.subtle) {
    throw new ImportPolicyError('A secure local content fingerprint is unavailable in this WebView.');
  }
  if (!Number.isSafeInteger(file?.size) || file.size < 0) {
    throw new ImportPolicyError('The publication reported an invalid file size.');
  }
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  if (file.size <= directHashLimit) {
    const bytes = await file.arrayBuffer();
    if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
    return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
  }

  const chunkDigests = [];
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
    const bytes = await file.slice(offset, Math.min(file.size, offset + chunkBytes)).arrayBuffer();
    chunkDigests.push(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
  }
  const domain = new TextEncoder().encode(`reader-chunked-sha256-v1\0${file.size}\0${chunkBytes}\0`);
  const digestInput = new Uint8Array(domain.byteLength + chunkDigests.length * 32);
  digestInput.set(domain);
  chunkDigests.forEach((digest, index) => digestInput.set(digest, domain.byteLength + index * 32));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput));
  return `chunked-sha256-v1:${hex(digest)}`;
}
