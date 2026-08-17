import {
  coverForTitle,
  createId,
  detectFormat,
  escapeHtml,
  formatDisplayName,
  getExtension,
  normalizeText,
  stripMarkup,
  titleFromFilename,
} from './core.js';
import {
  IMPORT_LIMITS,
  ImportPolicyError,
  boundedText,
  classifyPublicationHref,
  createExtractionBudget,
  decodePublicationText,
  detectRasterImageMime,
  fingerprintPublicationFile,
  normalizeArchiveEntryName,
  readZipEntryBytes,
  readZipEntryText,
  resolvePublicationPath,
} from './import-policy.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read publication image'));
    reader.readAsDataURL(blob);
  });
}

function elementText(root, selectors) {
  for (const selector of selectors) {
    const value = normalizeText(root.querySelector(selector)?.textContent ?? '');
    if (value) return value;
  }
  return '';
}

function isImportLimitError(error) {
  return error instanceof ImportPolicyError && error.code === 'reader-import-limit';
}

function safePublicationId(value) {
  const reserved = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'window',
    'document',
    'location',
    'top',
    'parent',
    'frames',
  ]);
  return /^[a-zA-Z][\w:.-]{0,100}$/.test(value) && !reserved.has(value.toLowerCase());
}

function enforceMarkupLimits(root) {
  const elements = [...root.querySelectorAll('*')];
  if (elements.length > IMPORT_LIMITS.markupNodes) {
    throw new ImportPolicyError(
      'This publication section contains too many markup nodes.',
      'reader-import-limit',
    );
  }
  if ((root.textContent?.length ?? 0) > IMPORT_LIMITS.markupTextCharacters) {
    throw new ImportPolicyError('This publication section contains too much text.', 'reader-import-limit');
  }

  const stack = [...root.children].map((element) => ({ element, depth: 1 }));
  while (stack.length) {
    const { element, depth } = stack.pop();
    if (depth > IMPORT_LIMITS.markupDepth) {
      throw new ImportPolicyError('This publication section nests markup too deeply.', 'reader-import-limit');
    }
    for (const child of element.children) stack.push({ element: child, depth: depth + 1 });
  }
}

const SAFE_HTML_ELEMENTS = new Set([
  'A',
  'ABBR',
  'ARTICLE',
  'ASIDE',
  'B',
  'BDI',
  'BDO',
  'BLOCKQUOTE',
  'BR',
  'CAPTION',
  'CITE',
  'CODE',
  'COL',
  'COLGROUP',
  'DD',
  'DEL',
  'DETAILS',
  'DFN',
  'DIV',
  'DL',
  'DT',
  'EM',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'I',
  'IMG',
  'KBD',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'Q',
  'RP',
  'RT',
  'RUBY',
  'S',
  'SAMP',
  'SECTION',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUMMARY',
  'SUP',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TIME',
  'TR',
  'U',
  'UL',
  'VAR',
  'WBR',
]);

const SAFE_GLOBAL_ATTRIBUTES = new Set(['dir', 'id', 'lang', 'title']);
const SAFE_ELEMENT_ATTRIBUTES = Object.freeze({
  A: new Set(['href']),
  BDO: new Set(['dir']),
  COL: new Set(['span']),
  COLGROUP: new Set(['span']),
  IMG: new Set(['alt', 'src']),
  OL: new Set(['reversed', 'start', 'type']),
  Q: new Set([]),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['abbr', 'colspan', 'rowspan', 'scope']),
  TIME: new Set(['datetime']),
});

const DOMPURIFY_ALLOWED_TAGS = Object.freeze(
  [...SAFE_HTML_ELEMENTS, 'BODY', 'HEAD', 'HTML', 'TITLE'].map((tagName) => tagName.toLowerCase()),
);
const DOMPURIFY_ALLOWED_ATTRIBUTES = Object.freeze([
  ...new Set([
    ...SAFE_GLOBAL_ATTRIBUTES,
    ...Object.values(SAFE_ELEMENT_ATTRIBUTES).flatMap((attributes) => [...attributes]),
  ]),
]);

function sanitizeToDetachedDocument(html) {
  if (!globalThis.DOMPurify?.sanitize) throw new Error('The HTML sanitizer is unavailable.');
  const root = globalThis.DOMPurify.sanitize(String(html), {
    ALLOWED_TAGS: DOMPURIFY_ALLOWED_TAGS,
    ALLOWED_ATTR: DOMPURIFY_ALLOWED_ATTRIBUTES,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    PARSER_MEDIA_TYPE: 'text/html',
    RETURN_DOM: true,
    SANITIZE_DOM: true,
    WHOLE_DOCUMENT: true,
  });
  const body = root?.querySelector?.('body');
  if (
    root?.tagName !== 'HTML' ||
    root.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
    body?.namespaceURI !== 'http://www.w3.org/1999/xhtml'
  ) {
    throw new Error('The HTML sanitizer returned an invalid document.');
  }
  return { body, root };
}

function reduceToSafeMarkup(root) {
  const seenIds = new Set();
  for (const element of [...root.querySelectorAll('*')]) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !SAFE_HTML_ELEMENTS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const allowed = SAFE_ELEMENT_ATTRIBUTES[element.tagName] ?? new Set();
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!SAFE_GLOBAL_ATTRIBUTES.has(name) && !allowed.has(name)) element.removeAttribute(attribute.name);
    }
    const id = element.getAttribute('id');
    if (id) {
      if (!safePublicationId(id) || seenIds.has(id)) {
        element.removeAttribute('id');
      } else {
        seenIds.add(id);
      }
    }
  }
}

async function sanitizeHtml(
  html,
  { sourcePath = '', zip = null, extractionBudget = null, imageBudget = null, signal } = {},
) {
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  // Callers enforce file/ZIP byte budgets before parsing; these limits bound the retained DOM.
  const { body, root } = sanitizeToDetachedDocument(html);
  enforceMarkupLimits(body);
  const title = elementText(root, ['h1', 'h2', 'title']);

  body
    .querySelectorAll(
      'script, iframe, frame, frameset, object, embed, form, input, button, textarea, select, option, meta, base, link, style, svg, math, template, noscript, portal',
    )
    .forEach((node) => node.remove());
  reduceToSafeMarkup(body);

  body.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    const link = classifyPublicationHref(href, sourcePath);
    if (link.kind === 'anchor') {
      anchor.dataset.readerAnchor = link.target;
      anchor.removeAttribute('href');
      anchor.setAttribute('role', 'link');
      anchor.tabIndex = 0;
      return;
    }
    if (link.kind === 'external') {
      anchor.dataset.externalHref = link.href;
      anchor.removeAttribute('href');
      anchor.setAttribute('role', 'link');
      anchor.tabIndex = 0;
      anchor.rel = 'noreferrer noopener';
      anchor.title = 'External link — confirmation required';
      return;
    }
    if (link.kind !== 'internal') {
      anchor.removeAttribute('href');
      anchor.removeAttribute('role');
      anchor.removeAttribute('tabindex');
      return;
    }
    anchor.dataset.readerHref = link.path;
    anchor.removeAttribute('href');
    anchor.setAttribute('role', 'link');
    anchor.tabIndex = 0;
  });

  const images = [...body.querySelectorAll('img')];
  if (images.length > IMPORT_LIMITS.embeddedImageCount) {
    throw new ImportPolicyError('This publication contains too many embedded images.', 'reader-import-limit');
  }
  for (const image of images) {
    image.removeAttribute('srcset');
    image.removeAttribute('loading');
    const source = image.getAttribute('src') ?? '';
    const resolved = zip ? resolvePublicationPath(sourcePath, source) : null;
    if (!zip || !resolved) {
      image.remove();
      continue;
    }
    const entry = zip.file(resolved);
    if (!entry) {
      image.remove();
      continue;
    }
    try {
      const bytes = await readZipEntryBytes(entry, {
        budget: extractionBudget,
        maximumBytes: IMPORT_LIMITS.embeddedImageBytes,
        label: 'EPUB image',
        signal,
      });
      imageBudget?.consume(bytes.byteLength);
      const mime = detectRasterImageMime(bytes);
      if (!mime) {
        image.remove();
        continue;
      }
      image.src = await blobToDataUrl(new Blob([bytes], { type: mime }));
      image.decoding = 'async';
      image.loading = 'lazy';
      image.removeAttribute('width');
      image.removeAttribute('height');
    } catch (error) {
      image.remove();
      if (isImportLimitError(error)) throw error;
    }
  }

  body.querySelectorAll('audio, video, source, track').forEach((node) => node.remove());

  const text = normalizeText(body.textContent ?? '');
  return { html: body.innerHTML, text, title };
}

function chunkTextHtml(html, fallbackTitle) {
  const parser = new DOMParser();
  const document = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  const children = [...document.body.children];
  if (!children.length) {
    return [
      {
        id: createId('section'),
        title: fallbackTitle,
        html: `<p>${escapeHtml(stripMarkup(html))}</p>`,
        text: stripMarkup(html),
      },
    ];
  }

  const sections = [];
  let bucket = [];
  let bucketTitle = fallbackTitle;
  let bucketLength = 0;

  const flush = () => {
    if (!bucket.length) return;
    const sectionHtml = bucket.map((element) => element.outerHTML).join('\n');
    sections.push({
      id: createId('section'),
      title: bucketTitle || `Section ${sections.length + 1}`,
      html: sectionHtml,
      text: normalizeText(bucket.map((element) => element.textContent ?? '').join(' ')),
    });
    bucket = [];
    bucketLength = 0;
  };

  for (const element of children) {
    const text = normalizeText(element.textContent ?? '');
    const isHeading = /^H[12]$/.test(element.tagName);
    if ((isHeading && bucket.length) || bucketLength > 16_000) flush();
    if (isHeading) bucketTitle = text || `Section ${sections.length + 1}`;
    bucket.push(element);
    bucketLength += text.length;
  }
  flush();
  return sections;
}

async function parseTextFile(file, format, { signal } = {}) {
  if (file.size > IMPORT_LIMITS.textFileBytes) {
    throw new ImportPolicyError(
      'This text publication is larger than the current 32 MB safety limit.',
      'reader-import-limit',
    );
  }
  const source = decodePublicationText(new Uint8Array(await file.arrayBuffer()), 'Publication text');
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  let html;
  if (format === 'markdown') {
    if (!globalThis.marked?.parse) throw new Error('The Markdown parser is unavailable.');
    html = globalThis.marked.parse(source, { gfm: true, breaks: false });
  } else if (format === 'html') {
    html = source;
  } else {
    html = source
      .split(/\n\s*\n/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
      .join('\n');
  }

  const sanitized = await sanitizeHtml(html, { signal });
  const title = boundedText(sanitized.title, IMPORT_LIMITS.titleCharacters, titleFromFilename(file.name));
  const sections = chunkTextHtml(sanitized.html, title);
  if (sections.length > IMPORT_LIMITS.epubSections) {
    throw new ImportPolicyError('This text publication contains too many sections.', 'reader-import-limit');
  }
  return {
    title,
    author: 'Unknown author',
    description: `Imported ${format === 'markdown' ? 'Markdown' : format === 'html' ? 'HTML' : 'text'} publication`,
    sections,
  };
}

function parseXml(source, label) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error(`${label} is not valid XML.`);
  return document;
}

function localNameQuery(document, localName) {
  return [...document.getElementsByTagName('*')].filter((element) => element.localName === localName);
}

function xmlText(document, localNames) {
  for (const localName of localNames) {
    const element = localNameQuery(document, localName)[0];
    const value = normalizeText(element?.textContent ?? '');
    if (value) return value;
  }
  return '';
}

async function parseEpub(file, onProgress, { signal } = {}) {
  if (file.size > IMPORT_LIMITS.epubArchiveBytes)
    throw new Error('This EPUB is larger than the current 200 MB safety limit.');
  if (!globalThis.JSZip) throw new Error('The EPUB archive reader is unavailable.');
  onProgress?.('Opening EPUB package');
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');

  const archiveBytes = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  const zip = await globalThis.JSZip.loadAsync(archiveBytes, {
    checkCRC32: false,
    createFolders: false,
  });
  const entryNames = Object.keys(zip.files);
  if (entryNames.length > IMPORT_LIMITS.epubEntries)
    throw new Error('This EPUB contains too many files to import safely.');
  const normalizedNames = new Set();
  for (const entry of Object.values(zip.files)) {
    const originalName = entry.unsafeOriginalName ?? entry.name;
    const normalized = normalizeArchiveEntryName(originalName);
    if (!entry.dir && normalizedNames.has(normalized)) {
      throw new ImportPolicyError('This EPUB contains duplicate normalized archive paths.');
    }
    if (!entry.dir) normalizedNames.add(normalized);
  }
  const extractionBudget = createExtractionBudget(IMPORT_LIMITS.epubArchiveBytes, 'EPUB');
  const imageBudget = createExtractionBudget(IMPORT_LIMITS.embeddedImageTotalBytes, 'EPUB embedded images');

  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('This file is missing EPUB container metadata.');
  const containerDocument = parseXml(
    await readZipEntryText(containerEntry, {
      budget: extractionBudget,
      maximumBytes: IMPORT_LIMITS.epubMetadataBytes,
      label: 'EPUB container metadata',
      signal,
    }),
    'EPUB container metadata',
  );
  const rootfile = localNameQuery(containerDocument, 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile) throw new Error('The EPUB package path is missing or unsafe.');

  const packagePath = normalizeArchiveEntryName(rootfile);
  const packageEntry = zip.file(packagePath);
  if (!packageEntry) throw new Error('The EPUB package document could not be found.');
  const packageDocument = parseXml(
    await readZipEntryText(packageEntry, {
      budget: extractionBudget,
      maximumBytes: IMPORT_LIMITS.epubMetadataBytes,
      label: 'EPUB package document',
      signal,
    }),
    'EPUB package document',
  );

  const metadataTitle = boundedText(
    xmlText(packageDocument, ['title']),
    IMPORT_LIMITS.titleCharacters,
    titleFromFilename(file.name),
  );
  const author = boundedText(
    xmlText(packageDocument, ['creator']),
    IMPORT_LIMITS.authorCharacters,
    'Unknown author',
  );
  const description = boundedText(
    xmlText(packageDocument, ['description']),
    IMPORT_LIMITS.descriptionCharacters,
    'Imported EPUB publication',
  );

  const manifestItems = new Map();
  for (const item of localNameQuery(packageDocument, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    if (manifestItems.has(id))
      throw new ImportPolicyError('This EPUB contains duplicate manifest identifiers.');
    const path = resolvePublicationPath(packagePath, href);
    if (!path) continue;
    manifestItems.set(id, {
      id,
      href,
      path,
      mediaType: item.getAttribute('media-type') ?? '',
      properties: new Set((item.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean)),
    });
  }

  const spine = localNameQuery(packageDocument, 'itemref').map((item) => {
    const idref = item.getAttribute('idref');
    const manifestItem = idref ? manifestItems.get(idref) : null;
    if (!manifestItem) throw new ImportPolicyError('This EPUB spine references a missing manifest item.');
    return manifestItem;
  });
  if (!spine.length) throw new Error('This EPUB has no readable spine.');
  if (spine.length > IMPORT_LIMITS.epubSections)
    throw new Error('This EPUB has too many spine sections to import safely.');

  const tocTitles = new Map();
  const navItem = [...manifestItems.values()].find((item) => item.properties.has('nav'));
  if (navItem && zip.file(navItem.path)) {
    const navSource = await readZipEntryText(zip.file(navItem.path), {
      budget: extractionBudget,
      maximumBytes: IMPORT_LIMITS.epubMetadataBytes,
      label: 'EPUB navigation document',
      signal,
    });
    const navDocument = new DOMParser().parseFromString(navSource, 'text/html');
    const tocNav =
      [...navDocument.querySelectorAll('nav')].find((nav) =>
        (nav.getAttribute('epub:type') ?? nav.getAttribute('type') ?? '').split(/\s+/).includes('toc'),
      ) ?? navDocument.querySelector('nav');
    tocNav?.querySelectorAll('a[href]').forEach((anchor) => {
      const path = resolvePublicationPath(navItem.path, anchor.getAttribute('href'));
      if (path) tocTitles.set(path, boundedText(anchor.textContent, IMPORT_LIMITS.navigationLabelCharacters));
    });
  } else {
    const spineElement = localNameQuery(packageDocument, 'spine')[0];
    const ncxId = spineElement?.getAttribute('toc');
    const ncxItem =
      (ncxId && manifestItems.get(ncxId)) ||
      [...manifestItems.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
    const ncxEntry = ncxItem ? zip.file(ncxItem.path) : null;
    if (ncxItem && ncxEntry) {
      const ncxDocument = parseXml(
        await readZipEntryText(ncxEntry, {
          budget: extractionBudget,
          maximumBytes: IMPORT_LIMITS.epubMetadataBytes,
          label: 'EPUB NCX navigation document',
          signal,
        }),
        'EPUB NCX navigation document',
      );
      for (const navPoint of localNameQuery(ncxDocument, 'navPoint')) {
        const source = localNameQuery(navPoint, 'content')[0]?.getAttribute('src');
        const label = boundedText(
          localNameQuery(navPoint, 'text')[0]?.textContent,
          IMPORT_LIMITS.navigationLabelCharacters,
        );
        const path = source ? resolvePublicationPath(ncxItem.path, source) : null;
        if (path && label) tocTitles.set(path, label);
      }
    }
  }

  onProgress?.(`Reading ${spine.length} section${spine.length === 1 ? '' : 's'}`);
  const sections = [];
  for (let index = 0; index < spine.length; index += 1) {
    if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
    const item = spine[index];
    const entry = zip.file(item.path);
    if (!entry) throw new ImportPolicyError('This EPUB is missing a spine document.');
    const source = await readZipEntryText(entry, {
      budget: extractionBudget,
      maximumBytes: IMPORT_LIMITS.epubEntryBytes,
      label: 'EPUB spine document',
      signal,
    });
    const sanitized = await sanitizeHtml(source, {
      sourcePath: item.path,
      zip,
      extractionBudget,
      imageBudget,
      signal,
    });
    if (!sanitized.text) continue;
    sections.push({
      id: item.id || createId('section'),
      title: boundedText(
        tocTitles.get(item.path) || sanitized.title,
        IMPORT_LIMITS.navigationLabelCharacters,
        `Section ${sections.length + 1}`,
      ),
      html: sanitized.html,
      text: sanitized.text,
      sourcePath: item.path,
    });
    if (index % 10 === 0) onProgress?.(`Reading section ${index + 1} of ${spine.length}`);
  }
  if (!sections.length) throw new Error('No readable text remained after the EPUB safety checks.');

  let coverDataUrl = null;
  const coverId = localNameQuery(packageDocument, 'meta')
    .find((meta) => meta.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const coverItem =
    (coverId && manifestItems.get(coverId)) ||
    [...manifestItems.values()].find((item) => item.properties.has('cover-image'));
  if (coverItem) {
    const coverEntry = zip.file(coverItem.path);
    if (coverEntry) {
      try {
        const bytes = await readZipEntryBytes(coverEntry, {
          budget: extractionBudget,
          maximumBytes: IMPORT_LIMITS.embeddedImageBytes,
          label: 'EPUB cover image',
          signal,
        });
        imageBudget.consume(bytes.byteLength);
        const detectedMime = detectRasterImageMime(bytes);
        const declaredMime = coverItem.mediaType === 'image/jpg' ? 'image/jpeg' : coverItem.mediaType;
        if (detectedMime && (!declaredMime || declaredMime === detectedMime)) {
          coverDataUrl = await blobToDataUrl(new Blob([bytes], { type: detectedMime }));
        }
      } catch (error) {
        if (isImportLimitError(error)) throw error;
        coverDataUrl = null;
      }
    }
  }

  return { title: metadataTitle, author, description, sections, coverDataUrl };
}

function findAscii(bytes, value, from = 0) {
  const needle = new TextEncoder().encode(value);
  outer: for (let index = from; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function findBytePattern(bytes, pattern, from = 0) {
  outer: for (let index = from; index <= bytes.length - pattern.length; index += 1) {
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (bytes[index + offset] !== pattern[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function readUint64(view, offset) {
  if (offset < 0 || offset + 8 > view.byteLength) return null;
  if (typeof view.getBigUint64 === 'function') {
    const value = view.getBigUint64(offset);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  const value = view.getUint32(offset) * 2 ** 32 + view.getUint32(offset + 4);
  return Number.isSafeInteger(value) ? value : null;
}

function parseMp4Duration(bytes) {
  const index = findAscii(bytes, 'mvhd');
  if (index < 0) return null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(index + 4);
    if (![0, 1].includes(version)) return null;
    const timescaleOffset = index + (version === 1 ? 24 : 16);
    const durationOffset = index + (version === 1 ? 28 : 20);
    if (timescaleOffset + 4 > view.byteLength || durationOffset + (version === 1 ? 8 : 4) > view.byteLength)
      return null;
    const timescale = view.getUint32(timescaleOffset);
    const duration = version === 1 ? readUint64(view, durationOffset) : view.getUint32(durationOffset);
    const seconds = timescale > 0 && Number.isFinite(duration) ? duration / timescale : null;
    return seconds !== null && Number.isFinite(seconds) && seconds >= 0 && seconds <= 10 * 365 * 24 * 60 * 60
      ? seconds
      : null;
  } catch {
    return null;
  }
}

function extractIlstStrings(bytes, atomPattern) {
  const values = [];
  let position = 0;
  while (position < bytes.length && values.length < 32) {
    const index = findBytePattern(bytes, atomPattern, position);
    if (index < 4) break;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const atomStart = index - 4;
    const atomSize = view.getUint32(atomStart);
    if (atomSize < 16 || atomStart + atomSize > bytes.length) {
      position = index + 4;
      continue;
    }
    const dataIndex = findAscii(bytes.subarray(atomStart, atomStart + atomSize), 'data');
    if (dataIndex >= 4) {
      const payloadStart = atomStart + dataIndex + 12;
      const payloadEnd = atomStart + atomSize;
      if (payloadStart <= payloadEnd && payloadStart >= atomStart) {
        const value = boundedText(
          new TextDecoder('utf-8', { fatal: false })
            .decode(bytes.subarray(payloadStart, payloadEnd))
            .replaceAll('\0', ''),
          1_000,
        );
        if (value) values.push(value);
      }
    }
    position = atomStart + atomSize;
  }
  return values;
}

async function parseAaxMetadata(file, { signal } = {}) {
  const header = new Uint8Array(
    await file.slice(0, Math.min(file.size, IMPORT_LIMITS.aaxHeaderBytes)).arrayBuffer(),
  );
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  const firstAtomSize =
    header.byteLength >= 4
      ? new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0)
      : 0;
  if (
    header.byteLength < 12 ||
    findAscii(header, 'ftyp') !== 4 ||
    firstAtomSize < 12 ||
    firstAtomSize > header.byteLength
  ) {
    throw new ImportPolicyError('This file does not contain a recognizable protected-audio header.');
  }
  const titleCandidates = extractIlstStrings(header, [0xa9, 0x6e, 0x61, 0x6d]);
  const authorCandidates = extractIlstStrings(header, [0xa9, 0x41, 0x52, 0x54]);
  const title = boundedText(
    titleCandidates.sort((a, b) => b.length - a.length)[0],
    IMPORT_LIMITS.titleCharacters,
    titleFromFilename(file.name),
  );
  const author = boundedText(authorCandidates[0], IMPORT_LIMITS.authorCharacters, 'Unknown author');
  const duration = parseMp4Duration(header);
  const protectionMarkers = ['aax ', 'aavd', 'adrm'].filter((marker) => findAscii(header, marker) >= 0);
  if (!protectionMarkers.length) {
    throw new ImportPolicyError('This AAX-like file does not contain a recognized protection marker.');
  }
  return {
    title,
    author,
    description:
      'Protected Audible-style audiobook. Reader stores metadata only and does not decrypt or convert this file.',
    duration,
    protectionMarkers,
    sections: [],
  };
}

async function validateFileSignature(file, format) {
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 1_024)).arrayBuffer());
  const extension = getExtension(file.name);
  const mimeType = String(file.type ?? '').toLowerCase();
  const genericMime = !mimeType || mimeType === 'application/octet-stream';
  const allowedMimes = {
    epub: new Set(['application/epub+zip', 'application/zip']),
    pdf: new Set(['application/pdf', 'application/x-pdf']),
    text: new Set(['text/plain']),
    markdown: new Set(['text/markdown', 'text/plain']),
    html: new Set(['text/html', 'application/xhtml+xml']),
    aax: new Set(['audio/aax', 'audio/vnd.audible.aax']),
  };
  if (!genericMime && format === 'audio' && !mimeType.startsWith('audio/')) {
    throw new ImportPolicyError('The file type does not agree with its audio filename extension.');
  }
  if (!genericMime && allowedMimes[format] && !allowedMimes[format].has(mimeType)) {
    throw new ImportPolicyError('The file type does not agree with its filename extension.');
  }

  if (format === 'epub') {
    const zipSignature = header[0] === 0x50 && header[1] === 0x4b && [0x03, 0x05, 0x07].includes(header[2]);
    if (!zipSignature)
      throw new ImportPolicyError('This file does not contain a recognizable EPUB archive header.');
  }
  if (format === 'pdf') {
    const headerIndex = findAscii(header, '%PDF-');
    const trailer = new Uint8Array(await file.slice(Math.max(0, file.size - 4_096), file.size).arrayBuffer());
    if (headerIndex < 0 || headerIndex > 1_019 || findAscii(trailer, '%%EOF') < 0) {
      throw new ImportPolicyError('This file is not a complete, recognizable PDF document.');
    }
  }
  if (format === 'audio') {
    const ascii = (start, end) => String.fromCharCode(...header.subarray(start, end));
    const hasFrameSync = header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
    const recognizable =
      (extension === 'mp3' && (ascii(0, 3) === 'ID3' || hasFrameSync)) ||
      (extension === 'aac' && hasFrameSync) ||
      (extension === 'wav' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') ||
      (extension === 'ogg' && ascii(0, 4) === 'OggS') ||
      (['m4a', 'm4b'].includes(extension) && findAscii(header, 'ftyp') === 4);
    if (!recognizable)
      throw new ImportPolicyError('This file does not contain a recognizable unprotected-audio header.');
  }
}

export async function parsePublicationFile(file, onProgress, { signal } = {}) {
  const format = detectFormat(file.name, file.type);
  if (format === 'unsupported') throw new Error(`${file.name} is not a supported publication format.`);
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new ImportPolicyError('This publication is empty or reports an invalid size.');
  }
  if (format !== 'aax' && file.size > IMPORT_LIMITS.managedFileBytes) {
    throw new Error(`${file.name} is larger than the current 512 MB managed-library limit.`);
  }
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  await validateFileSignature(file, format);

  const id = createId('book');
  const importedAt = new Date().toISOString();
  let parsed;

  if (format === 'epub') parsed = await parseEpub(file, onProgress, { signal });
  else if (['text', 'markdown', 'html'].includes(format))
    parsed = await parseTextFile(file, format, { signal });
  else if (format === 'aax') parsed = await parseAaxMetadata(file, { signal });
  else {
    parsed = {
      title: titleFromFilename(file.name),
      author: 'Unknown author',
      description: format === 'pdf' ? 'Imported PDF document' : 'Imported audiobook',
      sections: [],
    };
  }

  onProgress?.('Finishing import');
  const fingerprint = await fingerprintPublicationFile(file, { signal });
  const book = {
    id,
    title: boundedText(parsed.title, IMPORT_LIMITS.titleCharacters, titleFromFilename(file.name)),
    author: boundedText(parsed.author, IMPORT_LIMITS.authorCharacters, 'Unknown author'),
    description: boundedText(parsed.description, IMPORT_LIMITS.descriptionCharacters, 'Imported publication'),
    format,
    formatLabel: formatDisplayName(format, file.name),
    mimeType: file.type || (format === 'epub' ? 'application/epub+zip' : 'application/octet-stream'),
    fileName: file.name,
    size: file.size,
    fingerprint,
    access: format === 'aax' ? 'restricted' : 'open',
    accessReason: format === 'aax' ? 'protected-aax' : null,
    protectionMarkers: parsed.protectionMarkers ?? [],
    coverColor: coverForTitle(parsed.title),
    coverDataUrl: parsed.coverDataUrl ?? null,
    importedAt,
    updatedAt: importedAt,
    lastOpenedAt: null,
    progress:
      format === 'audio'
        ? { audioTime: 0, duration: 0 }
        : format === 'pdf'
          ? { page: 1, pageCount: 0, zoom: 1.15 }
          : { sectionIndex: 0, sectionFraction: 0 },
    duration: parsed.duration ?? null,
    collectionIds: [],
    bookmarks: [],
    sections: parsed.sections ?? [],
    demo: false,
  };

  const blobRecord =
    format === 'aax'
      ? null
      : { id, blob: file, fileName: file.name, mimeType: book.mimeType, size: file.size };

  return { book, blobRecord };
}

export function sanitizeImportedHtml(html) {
  return sanitizeHtml(html);
}
