export const SUPPORTED_EXTENSIONS = new Set([
  'epub',
  'pdf',
  'txt',
  'md',
  'markdown',
  'html',
  'htm',
  'm4b',
  'm4a',
  'mp3',
  'aac',
  'ogg',
  'wav',
  'aax',
]);

const formatMap = {
  epub: 'epub',
  pdf: 'pdf',
  txt: 'text',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  m4b: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  aac: 'audio',
  ogg: 'audio',
  wav: 'audio',
  aax: 'aax',
};

const coverPalettes = [
  'linear-gradient(145deg, #3e6656, #183d34)',
  'linear-gradient(145deg, #9f634f, #5d2f2d)',
  'linear-gradient(145deg, #556d8d, #263a57)',
  'linear-gradient(145deg, #9a7a43, #58401f)',
  'linear-gradient(145deg, #76617e, #3d2e49)',
  'linear-gradient(145deg, #51767d, #24464d)',
  'linear-gradient(145deg, #787454, #41412a)',
  'linear-gradient(145deg, #8a5967, #492f3b)',
];

export function createId(prefix = 'id') {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function getExtension(filename = '') {
  const match = String(filename)
    .toLowerCase()
    .match(/\.([^.]+)$/);
  return match?.[1] ?? '';
}

export function detectFormat(filename = '', mimeType = '') {
  const extension = getExtension(filename);
  if (formatMap[extension]) return formatMap[extension];
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/epub+zip') return 'epub';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'text/markdown') return 'markdown';
  if (mimeType === 'text/html') return 'html';
  if (mimeType.startsWith('text/')) return 'text';
  return 'unsupported';
}

export function formatDisplayName(format, filename = '') {
  if (format === 'audio') return getExtension(filename).toUpperCase() || 'AUDIO';
  if (format === 'aax') return 'AAX';
  if (format === 'markdown') return 'MD';
  return String(format || 'FILE').toUpperCase();
}

export function titleFromFilename(filename = '') {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    base
      .split(' ')
      .map((part) =>
        part.length <= 3 && part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join(' ') || 'Untitled publication'
  );
}

export function formatBytes(value = 0) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const precision = size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unit]}`;
}

export function formatTime(seconds = 0) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function progressPercent(book) {
  if (!book) return 0;
  const progress = book.progress ?? {};
  const audioDuration = progress.duration || book.duration;
  if (book.format === 'audio' && audioDuration) {
    return Math.round(clamp(progress.audioTime / audioDuration) * 100);
  }
  if (book.format === 'pdf' && progress.pageCount) {
    return Math.round(clamp((progress.page || 1) / progress.pageCount) * 100);
  }
  const count = Math.max(1, book.sections?.length ?? 1);
  const index = clamp(progress.sectionIndex ?? 0, 0, count - 1);
  const sectionFraction = clamp(progress.sectionFraction ?? 0);
  return Math.round(clamp((index + sectionFraction) / count) * 100);
}

export function coverForTitle(title = '') {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return coverPalettes[Math.abs(hash) % coverPalettes.length];
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function safeFilename(value = 'reader-export') {
  return (
    String(value)
      .normalize('NFKD')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-. ]+|[-. ]+$/g, '')
      .slice(0, 90) || 'reader-export'
  );
}

export function normalizeText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function stripMarkup(value = '') {
  return normalizeText(
    String(value)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(nbsp|amp|lt|gt);/gi, (entity, name) => {
        const decoded = { nbsp: ' ', amp: '&', lt: '<', gt: '>' };
        return decoded[name.toLowerCase()] ?? entity;
      }),
  );
}

export function searchSnippet(text, query, radius = 72) {
  const source = normalizeText(text);
  const needle = normalizeText(query).toLowerCase();
  const index = source.toLowerCase().indexOf(needle);
  if (index < 0) return source.slice(0, radius * 2) + (source.length > radius * 2 ? '…' : '');
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + needle.length + radius);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

export function relativeDate(value) {
  if (!value) return 'Not opened yet';
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  const days = Math.floor(delta / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function demoSection(title, html) {
  return { id: createId('section'), title, html, text: stripMarkup(html) };
}

export function createDemoLibrary() {
  const now = Date.now();
  const firstId = createId('book');
  const secondId = createId('book');
  const thirdId = createId('book');

  const books = [
    {
      id: firstId,
      title: 'Welcome to Reader',
      author: 'The Reader Team',
      description: 'A short tour of your private, focused reading space.',
      format: 'text',
      formatLabel: 'GUIDE',
      mimeType: 'text/html',
      size: 18_240,
      access: 'open',
      coverColor: 'linear-gradient(145deg, #315d49, #153b31)',
      importedAt: new Date(now - 3 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 25 * 60_000).toISOString(),
      lastOpenedAt: new Date(now - 25 * 60_000).toISOString(),
      progress: { sectionIndex: 1, sectionFraction: 0.16 },
      collectionIds: [],
      bookmarks: [],
      demo: true,
      sections: [
        demoSection(
          'A quieter library',
          `<h1>A quieter library</h1>
          <p>Reader is designed around a simple promise: your books should feel like books, not feeds. There are no advertisements, streak counters, or crowded storefronts between you and the next page.</p>
          <p>Your library lives on this device. Import an EPUB, PDF, text file, or an unprotected audiobook and Reader will remember your place, organize your notes, and make everything searchable.</p>
          <h2>Begin with intent</h2>
          <p>Use the library to browse slowly. Covers carry the visual weight; details stay close without competing for attention. Search remains available, but it never becomes the room itself.</p>
          <blockquote>Good reading software disappears at exactly the moment a sentence begins to matter.</blockquote>
          <p>Choose <strong>Add books</strong> whenever you are ready to bring in your own files.</p>`,
        ),
        demoSection(
          'Shape the page',
          `<h1>Shape the page</h1>
          <p>Every reader has a preferred rhythm. Open the appearance panel to adjust text size, line spacing, typeface, and the color of the page. These choices are remembered for the next book.</p>
          <h2>Paper, sepia, and night</h2>
          <p>Paper keeps contrast crisp. Sepia warms long evening sessions. Night mode lowers the glare without making text muddy. Reader also respects reduced-motion and keyboard preferences.</p>
          <p>Select any sentence to highlight it or attach a private note. Your annotations stay local and can be exported at any time.</p>
          <h2>Find your way back</h2>
          <p>Bookmarks capture a precise chapter or page. The table of contents lets you move deliberately, while your latest position is saved as you read.</p>`,
        ),
        demoSection(
          'Bring your own books',
          `<h1>Bring your own books</h1>
          <p>Reader opens unencrypted EPUB books, PDF documents, plain text, Markdown, HTML, and common audiobook formats. Imported HTML is sanitized and remote resources are blocked before it reaches the page.</p>
          <p>Protected AAX files are handled differently. Reader can catalogue the filename, size, and protection state, but it does not decrypt or convert the audio. Use the authorized provider application for playback.</p>
          <h2>Your library, portable</h2>
          <p>The settings panel can export your catalog, progress, bookmarks, highlights, and notes as sensitive JSON. It is a one-way metadata export, not a restorable library backup, and should be stored privately.</p>
          <p>That is the whole tour. Close this guide, import something you care about, and let the interface get out of the way.</p>`,
        ),
      ],
    },
    {
      id: secondId,
      title: 'The Practice of Attention',
      author: 'Mara Vale',
      description: 'Notes on making room for difficult, rewarding ideas.',
      format: 'text',
      formatLabel: 'ESSAY',
      mimeType: 'text/html',
      size: 31_820,
      access: 'open',
      coverColor: 'linear-gradient(145deg, #a06b4e, #61372e)',
      importedAt: new Date(now - 12 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 2 * 86_400_000).toISOString(),
      lastOpenedAt: new Date(now - 2 * 86_400_000).toISOString(),
      progress: { sectionIndex: 0, sectionFraction: 0.58 },
      collectionIds: [],
      bookmarks: [],
      demo: true,
      sections: [
        demoSection(
          'The first ten minutes',
          `<h1>The first ten minutes</h1>
          <p>Attention rarely arrives dressed as certainty. More often, it begins as ten undisturbed minutes offered to something that has not yet earned them.</p>
          <p>We imagine concentration as force: a narrowed gaze, a locked door, a determined mind. But useful attention is closer to hospitality. It makes enough room for an idea to show its actual shape.</p>
          <p>The first minutes are awkward because the old velocity is still leaving the body. The impulse to check, skim, or accelerate is not evidence that the book is wrong. It is the sound of speed cooling down.</p>
          <blockquote>Patience is not waiting for meaning. It is making the conditions in which meaning can appear.</blockquote>
          <p>When a paragraph resists you, read it once for structure, once for surprise, and once for what it asks you to reconsider.</p>`,
        ),
        demoSection(
          'A margin wide enough',
          `<h1>A margin wide enough</h1>
          <p>A generous margin is not empty. It is where the reader meets the page without being crowded by it. The same is true of time.</p>
          <p>Leave a small interval after a chapter. Write one sentence that the author did not write for you: what changed, what remains doubtful, or what deserves a return visit.</p>
          <p>Notes need not summarize. The best ones preserve friction. They record the question you had before later knowledge made the question seem obvious.</p>`,
        ),
      ],
    },
    {
      id: thirdId,
      title: 'Maps for an Unhurried Evening',
      author: 'Elias North',
      description: 'Three small journeys through weather, memory, and home.',
      format: 'text',
      formatLabel: 'FICTION',
      mimeType: 'text/html',
      size: 42_700,
      access: 'open',
      coverColor: 'linear-gradient(145deg, #506b88, #263b55)',
      importedAt: new Date(now - 7 * 86_400_000).toISOString(),
      updatedAt: new Date(now - 7 * 86_400_000).toISOString(),
      lastOpenedAt: null,
      progress: { sectionIndex: 0, sectionFraction: 0 },
      collectionIds: [],
      bookmarks: [],
      demo: true,
      sections: [
        demoSection(
          'The rain map',
          `<h1>The rain map</h1>
          <p>At six in the evening, the rain began drawing roads that did not exist. It traced silver routes down the bakery window and joined them at the sill in a town smaller than a hand.</p>
          <p>Nora watched from the last table, naming every crossing. One road led to the station she had missed. Another climbed the hill behind her childhood house. The narrowest one ended at a blue door she could not place.</p>
          <p>Outside, the real street shone without instruction.</p>`,
        ),
        demoSection(
          'North by lamplight',
          `<h1>North by lamplight</h1>
          <p>The compass had no needle, only a small glass chamber filled with dark water. Her grandfather claimed it pointed toward whatever the traveler most needed to remember.</p>
          <p>She held it beneath the lamp. The water leaned west, toward the kitchen, where an unopened letter waited beneath the fruit bowl.</p>`,
        ),
        demoSection(
          'A door left warm',
          `<h1>A door left warm</h1>
          <p>There are homes that recognize us by key and others that know the weight of our hesitation on the step.</p>
          <p>When Nora finally arrived, the porch light was already on. She stood in its modest circle and understood that a welcome can travel farther than a map.</p>`,
        ),
      ],
    },
  ];

  const annotations = [
    {
      id: createId('annotation'),
      bookId: secondId,
      type: 'highlight',
      quote: 'Patience is not waiting for meaning. It is making the conditions in which meaning can appear.',
      note: 'A useful reminder for dense chapters.',
      sectionIndex: 0,
      sectionTitle: 'The first ten minutes',
      createdAt: new Date(now - 36 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return { books, annotations };
}
