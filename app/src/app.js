import {
  clamp,
  createId,
  escapeHtml,
  formatBytes,
  formatTime,
  normalizeText,
  progressPercent,
  relativeDate,
  safeFilename,
  searchSnippet,
} from './core.js';
import {
  deleteAnnotation,
  deleteBookAndData,
  getBookBlob,
  initializeLibrary,
  resetLibrary,
  saveAnnotation,
  saveBook,
  saveBookWithBlob,
  saveCollection,
  saveSetting,
} from './db.js';
import { hydrateIcons, iconSvg } from './icons.js';
import { parsePublicationFile } from './parsers.js';
import { createBookSaveCoordinator } from './save-coordinator.js';
import {
  AudioRenderer,
  PdfRenderer,
  coverMarkup,
  renderRestrictedAax,
  renderTextSection,
} from './renderers.js';

const state = {
  books: [],
  annotations: [],
  collections: [],
  settings: {},
  route: 'library',
  collectionId: null,
  query: '',
  filter: 'all',
  activeBookId: null,
  selectedQuote: '',
  selectedRange: null,
  menuBookId: null,
  pdfRenderer: null,
  audioRenderer: null,
  readerSession: null,
  readerSessionSequence: 0,
  readerTransitionSequence: 0,
  lastSaveErrorAt: 0,
};

const dom = {
  app: document.querySelector('#app'),
  bootScreen: document.querySelector('#boot-screen'),
  mainContent: document.querySelector('#main-content'),
  libraryCount: document.querySelector('#library-count'),
  collectionNav: document.querySelector('#collection-nav'),
  librarySearch: document.querySelector('#library-search'),
  importButton: document.querySelector('#import-button'),
  fileInput: document.querySelector('#file-input'),
  settingsButton: document.querySelector('#settings-button'),
  settingsDialog: document.querySelector('#settings-dialog'),
  newCollectionButton: document.querySelector('#new-collection-button'),
  collectionDialog: document.querySelector('#collection-dialog'),
  collectionForm: document.querySelector('#collection-form'),
  collectionName: document.querySelector('#collection-name'),
  mobileMenuButton: document.querySelector('#mobile-menu-button'),
  readerView: document.querySelector('#reader-view'),
  readerStage: document.querySelector('#reader-stage'),
  readerContent: document.querySelector('#reader-content'),
  readerTitle: document.querySelector('#reader-title'),
  readerLocationLabel: document.querySelector('#reader-location-label'),
  readerProgressLabel: document.querySelector('#reader-progress-label'),
  readerProgressBar: document.querySelector('#reader-progress-bar'),
  readerFooter: document.querySelector('#reader-footer'),
  pageIndicator: document.querySelector('#page-indicator'),
  previousSection: document.querySelector('#previous-section'),
  nextSection: document.querySelector('#next-section'),
  closeReader: document.querySelector('#close-reader'),
  bookmarkButton: document.querySelector('#bookmark-button'),
  tocButton: document.querySelector('#reader-toc-button'),
  tocPanel: document.querySelector('#toc-panel'),
  tocList: document.querySelector('#toc-list'),
  appearanceButton: document.querySelector('#appearance-button'),
  appearancePanel: document.querySelector('#appearance-panel'),
  readerSearchButton: document.querySelector('#reader-search-button'),
  bookSearchPanel: document.querySelector('#book-search-panel'),
  bookSearchInput: document.querySelector('#book-search-input'),
  bookSearchResults: document.querySelector('#book-search-results'),
  fontSizeRange: document.querySelector('#font-size-range'),
  lineHeightRange: document.querySelector('#line-height-range'),
  focusModeToggle: document.querySelector('#focus-mode-toggle'),
  selectionToolbar: document.querySelector('#selection-toolbar'),
  noteDialog: document.querySelector('#note-dialog'),
  noteForm: document.querySelector('#note-form'),
  noteQuote: document.querySelector('#note-quote'),
  noteText: document.querySelector('#note-text'),
  bookMenuDialog: document.querySelector('#book-menu-dialog'),
  bookMenuTitle: document.querySelector('#book-menu-title'),
  toastRegion: document.querySelector('#toast-region'),
};

function activeBook() {
  return state.books.find((book) => book.id === state.activeBookId) ?? null;
}

function bookById(id) {
  return state.books.find((book) => book.id === id) ?? null;
}

function annotationsForBook(bookId) {
  return state.annotations.filter((annotation) => annotation.bookId === bookId);
}

function showToast(title, message, tone = 'success', timeout = 4_200) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${iconSvg(tone === 'error' ? 'alert' : tone === 'warning' ? 'info' : 'check')}</span>
    <span class="toast-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></span>
    <button type="button" aria-label="Dismiss notification">${iconSvg('x')}</button>`;
  const close = () => {
    if (!toast.isConnected) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 190);
  };
  toast.querySelector('button').addEventListener('click', close);
  dom.toastRegion.append(toast);
  if (timeout) setTimeout(close, timeout);
  return {
    update(nextTitle, nextMessage) {
      toast.querySelector('.toast-copy strong').textContent = nextTitle;
      toast.querySelector('.toast-copy span').textContent = nextMessage;
    },
    close,
  };
}

const bookSaves = createBookSaveCoordinator({
  save: saveBook,
  onError() {
    const now = Date.now();
    if (now - state.lastSaveErrorAt < 4_000) return;
    state.lastSaveErrorAt = now;
    showToast(
      'Reading progress was not saved',
      'Reader could not update local storage. Your library content was not sent anywhere.',
      'error',
      7_000,
    );
  },
});

function applySettings() {
  const settings = {
    appTheme: 'system',
    viewMode: 'grid',
    readerTheme: 'paper',
    readerFontSize: 19,
    readerLineHeight: 1.7,
    readerFont: 'serif',
    focusMode: false,
    ...state.settings,
  };
  state.settings = settings;
  document.documentElement.dataset.appTheme = settings.appTheme;
  dom.readerView.dataset.theme = settings.readerTheme;
  dom.readerContent.style.setProperty('--reader-font-size', `${settings.readerFontSize}px`);
  dom.readerContent.style.setProperty('--reader-line-height', String(settings.readerLineHeight));
  dom.readerContent.classList.toggle('font-sans', settings.readerFont === 'sans');
  dom.readerView.classList.toggle('is-focus-mode', Boolean(settings.focusMode));
  dom.fontSizeRange.value = String(settings.readerFontSize);
  dom.lineHeightRange.value = String(settings.readerLineHeight);
  dom.focusModeToggle.checked = Boolean(settings.focusMode);
  document
    .querySelectorAll('[data-app-theme]')
    .forEach((button) => button.classList.toggle('is-active', button.dataset.appTheme === settings.appTheme));
  document
    .querySelectorAll('[data-reader-theme]')
    .forEach((button) =>
      button.classList.toggle('is-active', button.dataset.readerTheme === settings.readerTheme),
    );
  document
    .querySelectorAll('[data-reader-font]')
    .forEach((button) =>
      button.classList.toggle('is-active', button.dataset.readerFont === settings.readerFont),
    );
}

function routeTitle() {
  if (state.route === 'progress') return ['In progress', 'Pick up where you left off.'];
  if (state.route === 'audiobooks') return ['Audiobooks', 'Listen locally, at your pace.'];
  if (state.route === 'highlights') return ['Highlights & notes', 'The ideas you chose to keep.'];
  if (state.route === 'collection') {
    const collection = state.collections.find((item) => item.id === state.collectionId);
    return [collection?.name ?? 'Collection', 'A shelf shaped by you.'];
  }
  return ['Your library', 'Everything you are reading, in one quiet place.'];
}

function filteredBooks() {
  let books = [...state.books];
  if (state.route === 'progress')
    books = books.filter((book) => progressPercent(book) > 0 && progressPercent(book) < 100);
  if (state.route === 'audiobooks') books = books.filter((book) => ['audio', 'aax'].includes(book.format));
  if (state.route === 'collection')
    books = books.filter((book) => book.collectionIds?.includes(state.collectionId));
  if (state.filter !== 'all') {
    if (state.filter === 'books')
      books = books.filter((book) => ['epub', 'text', 'markdown', 'html'].includes(book.format));
    else if (state.filter === 'documents') books = books.filter((book) => book.format === 'pdf');
    else if (state.filter === 'audio') books = books.filter((book) => ['audio', 'aax'].includes(book.format));
  }
  if (state.query) {
    const query = state.query.toLowerCase();
    books = books.filter((book) => {
      const metadata = `${book.title} ${book.author} ${book.description ?? ''}`.toLowerCase();
      if (metadata.includes(query)) return true;
      if (book.sections?.some((section) => section.text?.toLowerCase().includes(query))) return true;
      return annotationsForBook(book.id).some((annotation) =>
        `${annotation.quote} ${annotation.note ?? ''}`.toLowerCase().includes(query),
      );
    });
  }
  return books.sort((a, b) => {
    const aDate = new Date(a.lastOpenedAt || a.importedAt || 0).getTime();
    const bDate = new Date(b.lastOpenedAt || b.importedAt || 0).getTime();
    return bDate - aDate;
  });
}

function currentContinueBook() {
  return (
    state.books
      .filter((book) => book.access === 'open' && progressPercent(book) > 0 && progressPercent(book) < 100)
      .sort((a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0))[0] ?? null
  );
}

function renderCollectionNav() {
  dom.collectionNav.innerHTML = state.collections.length
    ? state.collections
        .map((collection) => {
          const count = state.books.filter((book) => book.collectionIds?.includes(collection.id)).length;
          return `<button class="collection-item${state.route === 'collection' && state.collectionId === collection.id ? ' is-active' : ''}" type="button" data-collection-id="${collection.id}">
            <span>${iconSvg('folder')}</span><span>${escapeHtml(collection.name)}</span><span class="nav-count">${count}</span>
          </button>`;
        })
        .join('')
    : '<p class="muted" style="padding:0 12px;font-size:11px">No collections yet</p>';
  dom.collectionNav.querySelectorAll('[data-collection-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.route = 'collection';
      state.collectionId = button.dataset.collectionId;
      syncNavigation();
      renderMain();
    });
  });
}

function syncNavigation() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.route === state.route);
  });
  dom.libraryCount.textContent = String(state.books.length);
  renderCollectionNav();
}

function bookCard(book) {
  const progress = progressPercent(book);
  const restricted = book.access === 'restricted';
  return `<article class="book-card" data-book-card="${book.id}">
    <button class="book-card-main" type="button" data-open-book="${book.id}" aria-label="Open ${escapeHtml(book.title)}">
      <div class="book-cover-wrap">
        ${coverMarkup(book)}
        <span class="format-badge">${restricted ? `${iconSvg('lock')} ` : ''}${escapeHtml(book.formatLabel || book.format)}</span>
        ${progress > 0 ? `<span class="book-progress" aria-label="${progress}% read"><span style="width:${progress}%"></span></span>` : ''}
      </div>
      <div class="book-info">
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(book.author)}${restricted ? ' · Protected' : ''}</p>
      </div>
    </button>
    <button class="icon-button book-more" type="button" data-book-menu="${book.id}" aria-label="More options for ${escapeHtml(book.title)}">${iconSvg('more')}</button>
  </article>`;
}

function continueMarkup(book) {
  if (!book) return '';
  const progress = progressPercent(book);
  const location =
    book.format === 'pdf'
      ? `Page ${book.progress?.page || 1}`
      : book.format === 'audio'
        ? formatTime(book.progress?.audioTime || 0)
        : book.sections?.[book.progress?.sectionIndex || 0]?.title || 'Continue reading';
  return `<section class="continue-card" aria-label="Continue reading">
    ${coverMarkup(book).replace('class="book-cover', 'class="continue-cover')}
    <div class="continue-copy">
      <span class="eyebrow">Continue reading</span>
      <h2>${escapeHtml(book.title)}</h2>
      <p>${escapeHtml(book.author)}</p>
      <div class="continue-meta">
        <span class="progress-line"><span style="width:${progress}%"></span></span>
        <span>${progress}%</span>
        <span>·</span>
        <span>${escapeHtml(location)}</span>
      </div>
    </div>
    <button class="primary-button continue-action" type="button" data-open-book="${book.id}">${iconSvg(book.format === 'audio' ? 'play' : 'book-open')} ${book.format === 'audio' ? 'Keep listening' : 'Keep reading'}</button>
  </section>`;
}

function pageHeading(extra = '') {
  const [title, subtitle] = routeTitle();
  return `<header class="page-heading">
    <div><span class="eyebrow">Personal library</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
    ${extra}
  </header>`;
}

function renderLibraryPage() {
  const books = filteredBooks();
  const continueBook = state.route === 'library' && !state.query ? currentContinueBook() : null;
  const viewControls = `<div class="view-controls" role="group" aria-label="Library view">
    <button type="button" data-view="grid" class="${state.settings.viewMode !== 'list' ? 'is-active' : ''}" aria-label="Grid view">${iconSvg('grid')}</button>
    <button type="button" data-view="list" class="${state.settings.viewMode === 'list' ? 'is-active' : ''}" aria-label="List view">${iconSvg('rows')}</button>
  </div>`;
  const filters = ['all', 'books', 'documents', 'audio']
    .map(
      (filter) =>
        `<button class="filter-chip${state.filter === filter ? ' is-active' : ''}" type="button" data-filter="${filter}">${filter[0].toUpperCase() + filter.slice(1)}</button>`,
    )
    .join('');
  const emptyCopy = state.query
    ? ['Nothing matched', `Try a different title, author, or phrase than “${state.query}”.`]
    : state.route === 'progress'
      ? ['Nothing in progress', 'Open a book and your reading position will appear here.']
      : state.route === 'audiobooks'
        ? ['No audiobooks yet', 'Import an unprotected M4B, M4A, MP3, AAC, OGG, or WAV file.']
        : state.route === 'collection'
          ? ['This collection is empty', 'Use a book’s options menu to add it here.']
          : ['Your shelf is ready', 'Add an EPUB, PDF, text file, or audiobook to begin.'];

  dom.mainContent.innerHTML = `
    ${pageHeading(viewControls)}
    ${continueMarkup(continueBook)}
    <div class="library-toolbar">
      <h2 class="section-title">${state.query ? `Search results · ${books.length}` : state.route === 'library' ? 'All books' : `${books.length} publication${books.length === 1 ? '' : 's'}`}</h2>
      <div class="filter-row" role="group" aria-label="Filter publications">${filters}</div>
    </div>
    ${
      books.length
        ? `<div class="book-grid${state.settings.viewMode === 'list' ? ' is-list' : ''}">${books.map(bookCard).join('')}</div>`
        : `<div class="empty-state"><span class="empty-icon">${iconSvg(state.query ? 'search' : 'library')}</span><h2>${escapeHtml(emptyCopy[0])}</h2><p>${escapeHtml(emptyCopy[1])}</p><button class="primary-button" type="button" data-trigger-import>${iconSvg('plus')} Add books</button></div>`
    }
  `;
  bindDynamicMainEvents();
}

function renderHighlightsPage() {
  const query = state.query.toLowerCase();
  const annotations = [...state.annotations]
    .filter(
      (item) =>
        !query ||
        `${item.quote} ${item.note ?? ''} ${bookById(item.bookId)?.title ?? ''}`
          .toLowerCase()
          .includes(query),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const noteCount = state.annotations.filter((item) => item.note).length;
  const bookCount = new Set(state.annotations.map((item) => item.bookId)).size;
  dom.mainContent.innerHTML = `
    ${pageHeading()}
    <div class="stat-row">
      <div class="stat-card"><strong>${state.annotations.length}</strong><span>Saved passages</span></div>
      <div class="stat-card"><strong>${noteCount}</strong><span>Personal notes</span></div>
      <div class="stat-card"><strong>${bookCount}</strong><span>Books revisited</span></div>
    </div>
    ${
      annotations.length
        ? `<div class="highlight-list">${annotations
            .map((annotation) => {
              const book = bookById(annotation.bookId);
              return `<article class="highlight-card" data-open-annotation="${annotation.id}">
            <span class="highlight-accent"></span>
            <div><blockquote>“${escapeHtml(annotation.quote)}”</blockquote>${annotation.note ? `<p class="highlight-note">${escapeHtml(annotation.note)}</p>` : ''}<p class="highlight-meta">${escapeHtml(book?.title ?? 'Unknown book')} · ${escapeHtml(annotation.sectionTitle ?? 'Saved location')} · ${relativeDate(annotation.createdAt)}</p></div>
            <button class="icon-button" type="button" data-delete-annotation="${annotation.id}" aria-label="Delete highlight">${iconSvg('trash')}</button>
          </article>`;
            })
            .join('')}</div>`
        : `<div class="empty-state"><span class="empty-icon">${iconSvg('highlight')}</span><h2>No saved passages</h2><p>Select a sentence while reading to highlight it or attach a private note.</p></div>`
    }
  `;
  bindDynamicMainEvents();
}

function renderMain() {
  syncNavigation();
  if (state.route === 'highlights') renderHighlightsPage();
  else renderLibraryPage();
}

function bindDynamicMainEvents() {
  dom.mainContent
    .querySelectorAll('[data-open-book]')
    .forEach((button) => button.addEventListener('click', () => openBook(button.dataset.openBook)));
  dom.mainContent.querySelectorAll('[data-book-menu]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openBookMenu(button.dataset.bookMenu);
    }),
  );
  dom.mainContent
    .querySelectorAll('[data-trigger-import]')
    .forEach((button) => button.addEventListener('click', () => dom.fileInput.click()));
  dom.mainContent.querySelectorAll('[data-filter]').forEach((button) =>
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      renderMain();
    }),
  );
  dom.mainContent.querySelectorAll('[data-view]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.settings.viewMode = button.dataset.view;
      await saveSetting('viewMode', state.settings.viewMode);
      renderMain();
    }),
  );
  dom.mainContent.querySelectorAll('[data-delete-annotation]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = button.dataset.deleteAnnotation;
      await deleteAnnotation(id);
      state.annotations = state.annotations.filter((item) => item.id !== id);
      renderMain();
      showToast('Highlight removed', 'The saved passage was deleted.');
    }),
  );
  dom.mainContent.querySelectorAll('[data-open-annotation]').forEach((card) =>
    card.addEventListener('click', () => {
      const annotation = state.annotations.find((item) => item.id === card.dataset.openAnnotation);
      if (!annotation) return;
      const book = bookById(annotation.bookId);
      if (!book) return;
      book.progress = { ...book.progress, sectionIndex: annotation.sectionIndex ?? 0, sectionFraction: 0 };
      openBook(book.id);
    }),
  );
}

async function handleFiles(files) {
  if (!files.length) return;
  let imported = 0;
  for (const file of files) {
    const progress = showToast('Importing publication', file.name, 'success', 0);
    try {
      const { book, blobRecord } = await parsePublicationFile(file, (message) =>
        progress.update('Importing publication', message),
      );
      const duplicate = state.books.find((existing) => existing.fingerprint === book.fingerprint);
      if (duplicate) {
        progress.update('Already in your library', duplicate.title);
        setTimeout(progress.close, 2_800);
        continue;
      }
      await saveBookWithBlob(book, blobRecord);
      state.books.push(book);
      imported += 1;
      progress.update(
        book.access === 'restricted' ? 'Protected title catalogued' : 'Added to your library',
        `${book.title} · ${formatBytes(book.size)}`,
      );
      setTimeout(progress.close, 3_800);
    } catch (error) {
      progress.close();
      showToast(
        'Could not import file',
        error?.message || `Reader could not open ${file.name}.`,
        'error',
        7_000,
      );
    }
  }
  dom.fileInput.value = '';
  if (imported) renderMain();
}

function scheduleBookSave(book, delay = 550) {
  return bookSaves.schedule(book, delay);
}

function saveBookNow(book) {
  return bookSaves.flush(book);
}

function destroyReaderSession() {
  if (state.readerSession) state.readerSession.active = false;
  state.readerSession = null;
  state.pdfRenderer?.destroy();
  state.audioRenderer?.destroy();
  state.pdfRenderer = null;
  state.audioRenderer = null;
}

function beginReaderSession(bookId) {
  destroyReaderSession();
  const session = {
    active: true,
    bookId,
    id: state.readerSessionSequence + 1,
  };
  state.readerSessionSequence = session.id;
  state.readerSession = session;
  return session;
}

function isReaderSessionActive(session, bookId) {
  return session?.active && state.readerSession === session && state.activeBookId === bookId;
}

function updateReaderHeader() {
  const book = activeBook();
  if (!book) return;
  const percent = progressPercent(book);
  dom.readerTitle.textContent = book.title;
  dom.readerProgressLabel.textContent = `${percent}%`;
  dom.readerProgressBar.style.width = `${percent}%`;

  if (book.format === 'pdf') {
    dom.readerLocationLabel.textContent = `Page ${book.progress?.page || 1} of ${book.progress?.pageCount || '—'}`;
    dom.pageIndicator.textContent = `${book.progress?.page || 1} of ${book.progress?.pageCount || '—'}`;
    dom.previousSection.disabled = (book.progress?.page || 1) <= 1;
    dom.nextSection.disabled =
      Boolean(book.progress?.pageCount) && (book.progress?.page || 1) >= book.progress.pageCount;
  } else if (book.format === 'audio') {
    dom.readerLocationLabel.textContent = `${formatTime(book.progress?.audioTime || 0)} of ${formatTime(book.progress?.duration || 0)}`;
    dom.pageIndicator.textContent = `${percent}% listened`;
    dom.previousSection.disabled = true;
    dom.nextSection.disabled = true;
  } else if (book.format === 'aax') {
    dom.readerLocationLabel.textContent = 'Protected · metadata only';
    dom.pageIndicator.textContent = 'Playback unavailable';
    dom.previousSection.disabled = true;
    dom.nextSection.disabled = true;
  } else {
    const index = book.progress?.sectionIndex || 0;
    const count = book.sections?.length || 1;
    dom.readerLocationLabel.textContent = book.sections?.[index]?.title || `Section ${index + 1}`;
    dom.pageIndicator.textContent = `${index + 1} of ${count}`;
    dom.previousSection.disabled = index <= 0;
    dom.nextSection.disabled = index >= count - 1;
  }
  updateBookmarkButton();
}

function currentLocator(book) {
  if (book.format === 'pdf') return { type: 'pdf', page: book.progress?.page || 1 };
  if (book.format === 'audio') return { type: 'audio', time: Math.floor(book.progress?.audioTime || 0) };
  return { type: 'section', sectionIndex: book.progress?.sectionIndex || 0 };
}

function locatorEquals(a, b) {
  return a?.type === b?.type && a.page === b.page && a.time === b.time && a.sectionIndex === b.sectionIndex;
}

function updateBookmarkButton() {
  const book = activeBook();
  if (!book) return;
  const locator = currentLocator(book);
  const isBookmarked = book.bookmarks?.some((bookmark) => locatorEquals(bookmark.locator, locator));
  dom.bookmarkButton.innerHTML = iconSvg(isBookmarked ? 'bookmark-filled' : 'bookmark');
  dom.bookmarkButton.setAttribute('aria-label', isBookmarked ? 'Remove bookmark' : 'Add bookmark');
}

async function openBook(bookId) {
  const book = bookById(bookId);
  if (!book) return;
  const transition = state.readerTransitionSequence + 1;
  state.readerTransitionSequence = transition;
  state.activeBookId = book.id;
  state.selectedQuote = '';
  closeReaderPanels();
  dom.app.hidden = true;
  dom.readerView.hidden = false;
  book.lastOpenedAt = new Date().toISOString();
  updateReaderHeader();
  await saveBookNow(book);
  if (state.readerTransitionSequence !== transition || state.activeBookId !== book.id) return;
  applySettings();
  renderToc(book);
  await renderActivePublication(book.id, transition);
  if (state.readerTransitionSequence !== transition || state.activeBookId !== book.id) return;
  updateReaderHeader();
  dom.readerStage.focus({ preventScroll: true });
}

async function renderActivePublication(
  expectedBookId = state.activeBookId,
  transition = state.readerTransitionSequence,
) {
  const book = bookById(expectedBookId);
  if (!book || state.activeBookId !== expectedBookId || state.readerTransitionSequence !== transition) return;
  const session = beginReaderSession(book.id);
  dom.readerStage.scrollTop = 0;
  dom.readerFooter.hidden = false;

  try {
    if (book.format === 'pdf') {
      const record = await getBookBlob(book.id);
      if (!isReaderSessionActive(session, book.id)) return;
      if (!record?.blob) throw new Error('The PDF file is no longer available in the local library.');
      const renderer = new PdfRenderer(dom.readerContent, (progress) => {
        if (!isReaderSessionActive(session, book.id)) return;
        book.progress = { ...book.progress, ...progress };
        scheduleBookSave(book);
        updateReaderHeader();
      });
      state.pdfRenderer = renderer;
      const progress = await renderer.open(
        record.blob,
        book.progress?.page || 1,
        book.progress?.zoom || 1.15,
      );
      if (!isReaderSessionActive(session, book.id) || state.pdfRenderer !== renderer) return;
      book.progress = { ...book.progress, ...progress };
      scheduleBookSave(book);
    } else if (book.format === 'audio') {
      const record = await getBookBlob(book.id);
      if (!isReaderSessionActive(session, book.id)) return;
      if (!record?.blob) throw new Error('The audio file is no longer available in the local library.');
      const renderer = new AudioRenderer(
        dom.readerContent,
        (progress) => {
          if (!isReaderSessionActive(session, book.id)) return;
          book.progress = { ...book.progress, ...progress };
          scheduleBookSave(book, 1_200);
          updateReaderHeader();
        },
        showToast,
      );
      state.audioRenderer = renderer;
      renderer.open(record.blob, book);
    } else if (book.format === 'aax') {
      renderRestrictedAax(dom.readerContent, book);
    } else {
      const index = clamp(book.progress?.sectionIndex || 0, 0, Math.max(0, (book.sections?.length || 1) - 1));
      book.progress = { ...book.progress, sectionIndex: index };
      renderTextSection(dom.readerContent, book, index, annotationsForBook(book.id));
      requestAnimationFrame(() => {
        if (!isReaderSessionActive(session, book.id)) return;
        const maxScroll = Math.max(0, dom.readerStage.scrollHeight - dom.readerStage.clientHeight);
        dom.readerStage.scrollTop = maxScroll * clamp(book.progress?.sectionFraction || 0);
      });
    }
  } catch (error) {
    if (!isReaderSessionActive(session, book.id)) return;
    dom.readerContent.className = 'reader-content';
    dom.readerContent.innerHTML = `<div class="empty-state"><span class="empty-icon">${iconSvg('alert')}</span><h2>Unable to open publication</h2><p>${escapeHtml(error?.message || 'The local publication could not be loaded.')}</p></div>`;
    showToast(
      'Reader could not open this title',
      error?.message || 'The publication is unavailable.',
      'error',
      7_000,
    );
  }
  updateReaderHeader();
}

async function closeReader() {
  const transition = state.readerTransitionSequence + 1;
  state.readerTransitionSequence = transition;
  const book = activeBook();
  if (book) {
    if (!['pdf', 'audio', 'aax'].includes(book.format)) updateScrollProgress(book);
    destroyReaderSession();
    await saveBookNow(book);
  } else {
    destroyReaderSession();
  }
  if (state.readerTransitionSequence !== transition) return;
  state.activeBookId = null;
  dom.readerView.hidden = true;
  dom.app.hidden = false;
  closeReaderPanels();
  renderMain();
}

function updateScrollProgress(book) {
  const maxScroll = dom.readerStage.scrollHeight - dom.readerStage.clientHeight;
  book.progress = {
    ...book.progress,
    sectionFraction: maxScroll > 0 ? clamp(dom.readerStage.scrollTop / maxScroll) : 1,
  };
  scheduleBookSave(book);
  updateReaderHeader();
}

async function navigateReader(direction) {
  const book = activeBook();
  if (!book) return;
  if (book.format === 'pdf') {
    await state.pdfRenderer?.goTo((book.progress?.page || 1) + direction);
    return;
  }
  if (['audio', 'aax'].includes(book.format)) return;
  const count = book.sections?.length || 0;
  const next = clamp((book.progress?.sectionIndex || 0) + direction, 0, Math.max(0, count - 1));
  if (next === book.progress?.sectionIndex) return;
  book.progress = { ...book.progress, sectionIndex: next, sectionFraction: 0 };
  await saveBookNow(book);
  renderTextSection(dom.readerContent, book, next, annotationsForBook(book.id));
  dom.readerStage.scrollTop = 0;
  renderToc(book);
  updateReaderHeader();
}

function renderToc(book) {
  if (book.format === 'pdf') {
    dom.tocList.innerHTML = `<p class="muted">Use the page controls to move through this PDF.</p>`;
    return;
  }
  if (['audio', 'aax'].includes(book.format)) {
    dom.tocList.innerHTML = `<p class="muted">${book.format === 'aax' ? 'Chapter audio is protected.' : 'Embedded audio chapters are not available in this build.'}</p>`;
    return;
  }
  dom.tocList.innerHTML = (book.sections ?? [])
    .map(
      (section, index) =>
        `<button type="button" class="${index === (book.progress?.sectionIndex || 0) ? 'is-active' : ''}" data-toc-index="${index}"><span class="toc-number">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(section.title || `Section ${index + 1}`)}</span></button>`,
    )
    .join('');
  dom.tocList.querySelectorAll('[data-toc-index]').forEach((button) =>
    button.addEventListener('click', async () => {
      book.progress = { ...book.progress, sectionIndex: Number(button.dataset.tocIndex), sectionFraction: 0 };
      await saveBookNow(book);
      renderTextSection(dom.readerContent, book, book.progress.sectionIndex, annotationsForBook(book.id));
      dom.readerStage.scrollTop = 0;
      dom.tocPanel.hidden = true;
      renderToc(book);
      updateReaderHeader();
    }),
  );
}

function toggleReaderPanel(panel) {
  const wasHidden = panel.hidden;
  closeReaderPanels();
  panel.hidden = !wasHidden;
  if (!panel.hidden) panel.querySelector('button, input')?.focus();
}

function closeReaderPanels() {
  [dom.tocPanel, dom.appearancePanel, dom.bookSearchPanel].forEach((panel) => {
    panel.hidden = true;
  });
  dom.selectionToolbar.hidden = true;
}

async function toggleBookmark() {
  const book = activeBook();
  if (!book || book.format === 'aax') return;
  const locator = currentLocator(book);
  const bookmarks = [...(book.bookmarks ?? [])];
  const index = bookmarks.findIndex((bookmark) => locatorEquals(bookmark.locator, locator));
  if (index >= 0) {
    bookmarks.splice(index, 1);
    showToast('Bookmark removed', 'This location is no longer bookmarked.');
  } else {
    bookmarks.push({ id: createId('bookmark'), locator, createdAt: new Date().toISOString() });
    showToast('Bookmark saved', 'You can return to this location later.');
  }
  book.bookmarks = bookmarks;
  await saveBookNow(book);
  updateBookmarkButton();
}

function showSelectionToolbar() {
  const selection = window.getSelection();
  const text = normalizeText(selection?.toString() ?? '').slice(0, 1_500);
  if (!text || !selection?.rangeCount || !dom.readerContent.contains(selection.anchorNode)) {
    dom.selectionToolbar.hidden = true;
    return;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) return;
  state.selectedQuote = text;
  state.selectedRange = range.cloneRange();
  const rect = range.getBoundingClientRect();
  const width = 250;
  dom.selectionToolbar.style.left = `${clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12)}px`;
  dom.selectionToolbar.style.top = `${Math.max(74, rect.top - 50)}px`;
  dom.selectionToolbar.hidden = false;
}

async function saveSelectedAnnotation(note = '') {
  const book = activeBook();
  if (!book || !state.selectedQuote) return;
  const annotation = {
    id: createId('annotation'),
    bookId: book.id,
    type: note ? 'note' : 'highlight',
    quote: state.selectedQuote,
    note: normalizeText(note),
    sectionIndex: book.progress?.sectionIndex || 0,
    sectionTitle:
      book.sections?.[book.progress?.sectionIndex || 0]?.title || dom.readerLocationLabel.textContent,
    createdAt: new Date().toISOString(),
  };
  await saveAnnotation(annotation);
  state.annotations.push(annotation);
  const scroll = dom.readerStage.scrollTop;
  if (!['pdf', 'audio', 'aax'].includes(book.format)) {
    renderTextSection(dom.readerContent, book, book.progress.sectionIndex, annotationsForBook(book.id));
    dom.readerStage.scrollTop = scroll;
  }
  window.getSelection()?.removeAllRanges();
  dom.selectionToolbar.hidden = true;
  showToast(
    note ? 'Note saved' : 'Highlight saved',
    note ? 'Your note stays in this local library.' : 'The passage was added to Highlights.',
  );
}

function runBookSearch() {
  const book = activeBook();
  const query = normalizeText(dom.bookSearchInput.value);
  if (!book || query.length < 2 || !book.sections?.length) {
    dom.bookSearchResults.innerHTML = query
      ? '<p class="muted">Type at least two characters.</p>'
      : '<p class="muted">Results will appear here.</p>';
    return;
  }
  const results = book.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.text?.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);
  dom.bookSearchResults.innerHTML = results.length
    ? results
        .map(
          ({ section, index }) =>
            `<button class="search-result" type="button" data-search-section="${index}"><strong>${escapeHtml(section.title)}</strong><span>${escapeHtml(searchSnippet(section.text, query))}</span></button>`,
        )
        .join('')
    : '<p class="muted">No matches in the extracted text.</p>';
  dom.bookSearchResults.querySelectorAll('[data-search-section]').forEach((button) =>
    button.addEventListener('click', async () => {
      book.progress = {
        ...book.progress,
        sectionIndex: Number(button.dataset.searchSection),
        sectionFraction: 0,
      };
      await saveBookNow(book);
      renderTextSection(dom.readerContent, book, book.progress.sectionIndex, annotationsForBook(book.id));
      dom.readerStage.scrollTop = 0;
      dom.bookSearchPanel.hidden = true;
      renderToc(book);
      updateReaderHeader();
    }),
  );
}

function openBookMenu(bookId) {
  const book = bookById(bookId);
  if (!book) return;
  state.menuBookId = bookId;
  dom.bookMenuTitle.textContent = book.title;
  dom.bookMenuDialog.showModal();
}

function exportDownload(filename, data, type = 'application/json') {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function exportLibrary() {
  if (
    !window.confirm(
      'Create a JSON metadata export? It can contain private titles, filenames, reading progress, quotes, and notes. Reader cannot restore a library from this file.',
    )
  )
    return;
  const exportData = {
    schemaVersion: '1.0',
    exportedAt: new Date().toISOString(),
    app: 'Reader',
    books: state.books.map(({ coverDataUrl, sections, ...book }) => ({
      ...book,
      coverIncluded: Boolean(coverDataUrl),
      extractedSectionCount: sections?.length || 0,
    })),
    annotations: state.annotations,
    collections: state.collections,
    settings: state.settings,
  };
  exportDownload(
    `reader-library-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(exportData, null, 2),
  );
  showToast(
    'Sensitive metadata export created',
    'Store the JSON file privately. It is not a restorable library backup.',
  );
}

function exportBookAnnotations(book) {
  const annotations = annotationsForBook(book.id);
  const lines = [
    `# ${book.title}`,
    ``,
    `By ${book.author}`,
    ``,
    `Exported ${new Date().toLocaleString()}`,
    ``,
  ];
  if (!annotations.length) lines.push('_No annotations saved._');
  for (const annotation of annotations) {
    lines.push(
      `## ${annotation.sectionTitle || 'Saved passage'}`,
      '',
      `> ${annotation.quote.replaceAll('\n', '\n> ')}`,
      '',
    );
    if (annotation.note) lines.push(annotation.note, '');
    lines.push(`_${new Date(annotation.createdAt).toLocaleString()}_`, '');
  }
  exportDownload(`${safeFilename(book.title)}-annotations.md`, lines.join('\n'), 'text/markdown');
  showToast(
    'Annotations exported',
    `${annotations.length} saved passage${annotations.length === 1 ? '' : 's'} written to Markdown.`,
  );
}

async function addBookToCollection(book) {
  if (!state.collections.length) {
    dom.bookMenuDialog.close();
    dom.collectionDialog.showModal();
    return;
  }
  let collection = state.collections[0];
  if (state.collections.length > 1) {
    const answer = window.prompt(
      `Choose a collection:\n${state.collections.map((item, index) => `${index + 1}. ${item.name}`).join('\n')}`,
      '1',
    );
    if (!answer) return;
    collection = state.collections[Number(answer) - 1];
    if (!collection) {
      showToast('Collection not found', 'Choose one of the listed collection numbers.', 'error');
      return;
    }
  }
  const ids = new Set(book.collectionIds ?? []);
  const alreadyAdded = ids.has(collection.id);
  alreadyAdded ? ids.delete(collection.id) : ids.add(collection.id);
  book.collectionIds = [...ids];
  await saveBookNow(book);
  renderCollectionNav();
  showToast(
    alreadyAdded ? 'Removed from collection' : 'Added to collection',
    `${book.title} ${alreadyAdded ? 'was removed from' : 'is now in'} ${collection.name}.`,
  );
}

async function removeBook(book) {
  if (
    !window.confirm(
      `Remove “${book.title}” from this local library? Its notes and stored file will also be deleted.`,
    )
  )
    return;
  const wasActive = state.activeBookId === book.id;
  if (wasActive) {
    state.readerTransitionSequence += 1;
    destroyReaderSession();
  }
  await bookSaves.invalidateBook(book.id);
  try {
    await deleteBookAndData(book.id);
    state.books = state.books.filter((item) => item.id !== book.id);
    state.annotations = state.annotations.filter((item) => item.bookId !== book.id);
    dom.bookMenuDialog.close();
    if (wasActive) {
      state.activeBookId = null;
      dom.readerView.hidden = true;
      dom.app.hidden = false;
      closeReaderPanels();
    }
    renderMain();
    showToast('Book removed', `${book.title} and its local reading data were deleted.`);
  } catch {
    bookSaves.reviveBook(book.id);
    if (wasActive) {
      state.activeBookId = null;
      dom.readerView.hidden = true;
      dom.app.hidden = false;
      closeReaderPanels();
      renderMain();
    }
    showToast(
      'Book was not removed',
      'Reader could not complete the local deletion. Nothing was reported or uploaded.',
      'error',
      7_000,
    );
  }
}

function bindStaticEvents() {
  document.querySelectorAll('[data-route]').forEach((button) =>
    button.addEventListener('click', () => {
      state.route = button.dataset.route;
      state.collectionId = null;
      dom.app.classList.remove('is-menu-open');
      renderMain();
    }),
  );
  dom.mobileMenuButton.addEventListener('click', () => dom.app.classList.toggle('is-menu-open'));
  dom.importButton.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', () => handleFiles([...dom.fileInput.files]));
  dom.librarySearch.addEventListener('input', () => {
    state.query = normalizeText(dom.librarySearch.value);
    renderMain();
  });
  dom.settingsButton.addEventListener('click', () => dom.settingsDialog.showModal());
  dom.newCollectionButton.addEventListener('click', () => {
    dom.collectionName.value = '';
    dom.collectionDialog.showModal();
    dom.collectionName.focus();
  });
  dom.collectionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') {
      dom.collectionDialog.close();
      return;
    }
    const name = normalizeText(dom.collectionName.value);
    if (!name) return;
    const collection = { id: createId('collection'), name, createdAt: new Date().toISOString() };
    await saveCollection(collection);
    state.collections.push(collection);
    dom.collectionDialog.close();
    renderCollectionNav();
    showToast('Collection created', `${name} is ready for books.`);
  });
  document.querySelectorAll('[data-app-theme]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.settings.appTheme = button.dataset.appTheme;
      applySettings();
      await saveSetting('appTheme', state.settings.appTheme);
    }),
  );
  document.querySelector('#export-library-button').addEventListener('click', exportLibrary);
  document.querySelector('#reset-library-button').addEventListener('click', async () => {
    if (
      !window.confirm(
        'Reset the local library and restore the welcome titles? Imported files and annotations will be deleted.',
      )
    )
      return;
    dom.settingsDialog.close();
    const previousBookIds = state.books.map((book) => book.id);
    state.readerTransitionSequence += 1;
    destroyReaderSession();
    state.activeBookId = null;
    dom.readerView.hidden = true;
    dom.app.hidden = false;
    closeReaderPanels();
    await bookSaves.invalidateAll(previousBookIds);
    try {
      const library = await resetLibrary();
      Object.assign(state, library, { route: 'library', collectionId: null, query: '', filter: 'all' });
      dom.readerView.hidden = true;
      dom.app.hidden = false;
      dom.librarySearch.value = '';
      applySettings();
      renderMain();
      showToast('Library reset', 'The welcome titles have been restored.');
    } catch {
      previousBookIds.forEach((bookId) => bookSaves.reviveBook(bookId));
      renderMain();
      showToast(
        'Library was not reset',
        'Reader could not complete the local reset. Your prior library remains available.',
        'error',
        7_000,
      );
    }
  });

  dom.closeReader.addEventListener('click', closeReader);
  dom.previousSection.addEventListener('click', () => navigateReader(-1));
  dom.nextSection.addEventListener('click', () => navigateReader(1));
  dom.bookmarkButton.addEventListener('click', toggleBookmark);
  dom.tocButton.addEventListener('click', () => toggleReaderPanel(dom.tocPanel));
  dom.appearanceButton.addEventListener('click', () => toggleReaderPanel(dom.appearancePanel));
  dom.readerSearchButton.addEventListener('click', () => {
    toggleReaderPanel(dom.bookSearchPanel);
    if (!dom.bookSearchPanel.hidden) {
      dom.bookSearchInput.value = '';
      runBookSearch();
      dom.bookSearchInput.focus();
    }
  });
  document
    .querySelectorAll('.panel-close')
    .forEach((button) => button.addEventListener('click', () => closeReaderPanels()));
  dom.bookSearchInput.addEventListener('input', runBookSearch);
  document.querySelectorAll('[data-reader-theme]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.settings.readerTheme = button.dataset.readerTheme;
      applySettings();
      await saveSetting('readerTheme', state.settings.readerTheme);
    }),
  );
  document.querySelectorAll('[data-reader-font]').forEach((button) =>
    button.addEventListener('click', async () => {
      state.settings.readerFont = button.dataset.readerFont;
      applySettings();
      await saveSetting('readerFont', state.settings.readerFont);
    }),
  );
  dom.fontSizeRange.addEventListener('input', async () => {
    state.settings.readerFontSize = Number(dom.fontSizeRange.value);
    applySettings();
    await saveSetting('readerFontSize', state.settings.readerFontSize);
  });
  dom.lineHeightRange.addEventListener('input', async () => {
    state.settings.readerLineHeight = Number(dom.lineHeightRange.value);
    applySettings();
    await saveSetting('readerLineHeight', state.settings.readerLineHeight);
  });
  dom.focusModeToggle.addEventListener('change', async () => {
    state.settings.focusMode = dom.focusModeToggle.checked;
    applySettings();
    await saveSetting('focusMode', state.settings.focusMode);
  });
  dom.readerStage.addEventListener(
    'scroll',
    () => {
      const book = activeBook();
      if (book && !['pdf', 'audio', 'aax'].includes(book.format)) updateScrollProgress(book);
    },
    { passive: true },
  );
  dom.readerContent.addEventListener('mouseup', () => setTimeout(showSelectionToolbar, 0));
  dom.readerContent.addEventListener('keyup', () => setTimeout(showSelectionToolbar, 0));
  dom.readerContent.addEventListener('keydown', (event) => {
    const readerLink = event.target.closest('a[role="link"]');
    if (readerLink && event.key === 'Enter') {
      event.preventDefault();
      readerLink.click();
    }
  });
  dom.readerContent.addEventListener('click', (event) => {
    const external = event.target.closest('[data-external-href]');
    const internal = event.target.closest('[data-reader-href]');
    const anchor = event.target.closest('[data-reader-anchor]');
    if (external) {
      event.preventDefault();
      showToast(
        'External link blocked',
        'Reader does not open publication links without an explicit trusted-browser handoff.',
        'warning',
        6_000,
      );
    } else if (internal) {
      event.preventDefault();
      const book = activeBook();
      const index = book?.sections?.findIndex(
        (section) => section.sourcePath === internal.dataset.readerHref,
      );
      if (index >= 0) {
        book.progress = { ...book.progress, sectionIndex: index, sectionFraction: 0 };
        scheduleBookSave(book, 0);
        renderTextSection(dom.readerContent, book, index, annotationsForBook(book.id));
        dom.readerStage.scrollTop = 0;
        renderToc(book);
        updateReaderHeader();
      }
    } else if (anchor) {
      event.preventDefault();
      dom.readerContent
        .querySelector(`#${CSS.escape(anchor.dataset.readerAnchor)}`)
        ?.scrollIntoView({ behavior: 'smooth' });
    }
  });
  dom.selectionToolbar.querySelectorAll('[data-selection-action]').forEach((button) =>
    button.addEventListener('click', async () => {
      const action = button.dataset.selectionAction;
      if (action === 'highlight') await saveSelectedAnnotation();
      if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(state.selectedQuote);
          dom.selectionToolbar.hidden = true;
          showToast('Copied', 'The selected passage is on your clipboard.');
        } catch {
          showToast(
            'Copy unavailable',
            'Clipboard permission was not available. Your selection is still active.',
            'error',
          );
        }
      }
      if (action === 'note') {
        dom.noteQuote.textContent = `“${state.selectedQuote}”`;
        dom.noteText.value = '';
        dom.selectionToolbar.hidden = true;
        dom.noteDialog.showModal();
        dom.noteText.focus();
      }
    }),
  );
  dom.noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') {
      dom.noteDialog.close();
      return;
    }
    const note = dom.noteText.value;
    dom.noteDialog.close();
    await saveSelectedAnnotation(note);
  });
  document.querySelector('#reader-more-button').addEventListener('click', () => {
    const book = activeBook();
    if (book) openBookMenu(book.id);
  });

  document.querySelector('#book-menu-details').addEventListener('click', () => {
    const book = bookById(state.menuBookId);
    if (!book) return;
    dom.bookMenuDialog.close();
    showToast(
      `${book.formatLabel} · ${formatBytes(book.size)}`,
      `${book.author} · Imported ${relativeDate(book.importedAt)}${book.access === 'restricted' ? ' · Metadata only' : ''}`,
      'success',
      7_000,
    );
  });
  document.querySelector('#book-menu-collection').addEventListener('click', async () => {
    const book = bookById(state.menuBookId);
    if (book) await addBookToCollection(book);
    dom.bookMenuDialog.close();
  });
  document.querySelector('#book-menu-export').addEventListener('click', () => {
    const book = bookById(state.menuBookId);
    if (book) exportBookAnnotations(book);
    dom.bookMenuDialog.close();
  });
  document.querySelector('#book-menu-delete').addEventListener('click', () => {
    const book = bookById(state.menuBookId);
    if (book) removeBook(book);
  });

  document.addEventListener('keydown', async (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'k' && dom.readerView.hidden) {
      event.preventDefault();
      dom.librarySearch.focus();
    }
    if (!dom.readerView.hidden && modifier && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleReaderPanel(dom.bookSearchPanel);
      dom.bookSearchInput.focus();
    }
    if (!dom.readerView.hidden && modifier && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      await toggleBookmark();
    }
    if (!dom.readerView.hidden && event.key === 'ArrowRight' && !event.target.matches('input,textarea'))
      await navigateReader(1);
    if (!dom.readerView.hidden && event.key === 'ArrowLeft' && !event.target.matches('input,textarea'))
      await navigateReader(-1);
    if (event.key === 'Escape') {
      if (![dom.tocPanel, dom.appearancePanel, dom.bookSearchPanel].every((panel) => panel.hidden))
        closeReaderPanels();
      else if (!dom.readerView.hidden && !document.querySelector('dialog[open]')) await closeReader();
      dom.app.classList.remove('is-menu-open');
    }
    if (
      !dom.readerView.hidden &&
      modifier &&
      ['+', '='].includes(event.key) &&
      activeBook()?.format === 'pdf'
    ) {
      event.preventDefault();
      await state.pdfRenderer?.zoom(0.15);
    }
    if (!dom.readerView.hidden && modifier && event.key === '-' && activeBook()?.format === 'pdf') {
      event.preventDefault();
      await state.pdfRenderer?.zoom(-0.15);
    }
  });

  document.addEventListener('visibilitychange', () => {
    const book = activeBook();
    if (document.visibilityState === 'hidden' && book) {
      if (!['pdf', 'audio', 'aax'].includes(book.format)) updateScrollProgress(book);
      void saveBookNow(book);
    }
  });
  window.addEventListener('pagehide', () => {
    const book = activeBook();
    if (!book) return;
    if (!['pdf', 'audio', 'aax'].includes(book.format)) updateScrollProgress(book);
    void saveBookNow(book);
  });
}

async function start() {
  hydrateIcons();
  bindStaticEvents();
  try {
    const library = await initializeLibrary();
    Object.assign(state, library);
    applySettings();
    renderMain();
    dom.app.hidden = false;
    dom.bootScreen.classList.add('is-hiding');
    setTimeout(() => dom.bootScreen.remove(), 300);
  } catch (error) {
    dom.bootScreen.innerHTML = `<span class="empty-icon">${iconSvg('alert')}</span><h1>Reader could not open</h1><p>${escapeHtml(error?.message || 'The local library database is unavailable.')}</p>`;
  }
}

start();
