import { escapeHtml, formatTime, progressPercent } from './core.js';
import { iconSvg } from './icons.js';

let pdfModulePromise;

async function getPdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('../vendor/pdfjs/pdf.min.mjs').then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        '../vendor/pdfjs/pdf.worker.min.mjs',
        import.meta.url,
      ).href;
      return module;
    });
  }
  return pdfModulePromise;
}

function locateTextRange(root, quote) {
  if (!quote) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim() || node.parentElement?.closest('mark[data-reader-highlight]'))
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let combined = '';
  while (walker.nextNode()) {
    nodes.push({
      node: walker.currentNode,
      start: combined.length,
      end: combined.length + walker.currentNode.nodeValue.length,
    });
    combined += walker.currentNode.nodeValue;
  }
  const start = combined.indexOf(quote);
  if (start < 0) return null;
  const end = start + quote.length;
  const first = nodes.find((entry) => entry.start <= start && entry.end > start);
  const last = [...nodes].reverse().find((entry) => entry.start < end && entry.end >= end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

export function applyStoredHighlights(root, annotations) {
  for (const annotation of annotations) {
    const range = locateTextRange(root, annotation.quote);
    if (!range || range.collapsed) continue;
    try {
      const marker = document.createElement('mark');
      marker.dataset.readerHighlight = annotation.id;
      marker.title = annotation.note || 'Saved highlight';
      range.surroundContents(marker);
    } catch {
      // A quote spanning complex markup stays safely stored even if it cannot be painted.
    }
  }
}

export function renderTextSection(container, book, sectionIndex, annotations) {
  const section = book.sections?.[sectionIndex];
  const useSans = container.classList.contains('font-sans');
  container.className = 'reader-content';
  container.classList.toggle('font-sans', useSans);
  container.innerHTML =
    section?.html ||
    `<div class="empty-state"><h2>No readable text</h2><p>This publication has no extracted text section.</p></div>`;
  applyStoredHighlights(
    container,
    annotations.filter((item) => item.sectionIndex === sectionIndex),
  );
  return { section, sectionIndex };
}

export class PdfRenderer {
  constructor(container, onStateChange) {
    this.container = container;
    this.onStateChange = onStateChange;
    this.document = null;
    this.page = 1;
    this.scale = 1.15;
    this.renderTask = null;
    this.loadingTask = null;
    this.destroyed = false;
    this.lifecycleGeneration = 0;
    this.renderGeneration = 0;
  }

  async open(blob, page = 1, scale = 1.15) {
    this.destroyed = false;
    const generation = this.lifecycleGeneration + 1;
    this.lifecycleGeneration = generation;
    this.container.className = 'reader-content pdf-reader';
    this.container.innerHTML = `<div class="pdf-loading"><span class="spinner"></span><span>Preparing document…</span></div>`;
    const pdfjs = await getPdfModule();
    if (this.destroyed || generation !== this.lifecycleGeneration) return null;
    const data = new Uint8Array(await blob.arrayBuffer());
    if (this.destroyed || generation !== this.lifecycleGeneration) return null;
    this.loadingTask = pdfjs.getDocument({
      data,
      enableScripting: false,
      isEvalSupported: false,
      enableXfa: false,
      useWasm: false,
      maxImageSize: 40_000_000,
      canvasMaxAreaInBytes: 128 * 1024 * 1024,
      disableAutoFetch: false,
      useWorkerFetch: false,
      stopEvent: true,
    });
    const document = await this.loadingTask.promise;
    if (this.destroyed || generation !== this.lifecycleGeneration) {
      void Promise.resolve(document.destroy?.()).catch(() => {});
      return null;
    }
    this.document = document;
    this.loadingTask = null;
    this.page = Math.min(this.document.numPages, Math.max(1, page));
    this.scale = Math.min(2.6, Math.max(0.65, scale));
    await this.render();
    if (this.destroyed || generation !== this.lifecycleGeneration) return null;
    return { pageCount: this.document.numPages, page: this.page, zoom: this.scale };
  }

  async render() {
    if (!this.document || this.destroyed) return false;
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch {
        /* no active render */
      }
    }
    const generation = this.renderGeneration + 1;
    this.renderGeneration = generation;
    const page = await this.document.getPage(this.page);
    if (this.destroyed || generation !== this.renderGeneration) return false;
    const viewport = page.getViewport({ scale: this.scale * Math.min(2, window.devicePixelRatio || 1) });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The PDF canvas is unavailable.');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / Math.min(2, window.devicePixelRatio || 1))}px`;
    canvas.style.height = 'auto';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `PDF page ${this.page} of ${this.document.numPages}`);

    this.container.replaceChildren(canvas);
    this.renderTask = page.render({ canvasContext: context, viewport, intent: 'display' });
    try {
      await this.renderTask.promise;
    } catch (error) {
      if (
        this.destroyed ||
        generation !== this.renderGeneration ||
        error?.name === 'RenderingCancelledException'
      )
        return false;
      throw error;
    }
    if (this.destroyed || generation !== this.renderGeneration) return false;
    this.renderTask = null;
    this.onStateChange?.({ page: this.page, pageCount: this.document.numPages, zoom: this.scale });
    return true;
  }

  async goTo(page) {
    if (!this.document || this.destroyed) return;
    this.page = Math.min(this.document.numPages, Math.max(1, page));
    await this.render();
  }

  async zoom(delta) {
    if (!this.document || this.destroyed) return;
    this.scale = Math.min(2.6, Math.max(0.65, this.scale + delta));
    await this.render();
  }

  destroy() {
    this.destroyed = true;
    this.lifecycleGeneration += 1;
    this.renderGeneration += 1;
    this.renderTask?.cancel?.();
    try {
      void Promise.resolve(this.loadingTask?.destroy?.()).catch(() => {});
      void Promise.resolve(this.document?.destroy?.()).catch(() => {});
    } catch {
      // A partially initialized PDF task is already unusable during teardown.
    }
    this.renderTask = null;
    this.loadingTask = null;
    this.document = null;
  }
}

export class AudioRenderer {
  constructor(container, onStateChange, onToast) {
    this.container = container;
    this.onStateChange = onStateChange;
    this.onToast = onToast;
    this.audio = null;
    this.objectUrl = null;
    this.speed = 1;
    this.sleepTimer = null;
    this.book = null;
    this.destroyed = true;
    this.generation = 0;
  }

  open(blob, book) {
    this.destroy();
    this.destroyed = false;
    const generation = this.generation;
    this.book = book;
    this.objectUrl = URL.createObjectURL(blob);
    this.container.className = 'reader-content';
    this.container.innerHTML = `
      <div class="audio-experience">
        <div class="audio-cover">${coverMarkup(book)}</div>
        <div class="audio-copy"><h1>${escapeHtml(book.title)}</h1><p>${escapeHtml(book.author)}</p></div>
        <div class="audio-player">
          <input class="audio-seek" type="range" min="0" max="1000" value="0" aria-label="Audiobook position">
          <div class="audio-time-row"><span class="audio-current">0:00</span><span class="audio-remaining">−0:00</span></div>
          <div class="audio-controls">
            <button class="icon-button speed-button" type="button" aria-label="Playback speed">1×</button>
            <button class="icon-button audio-rewind" type="button" aria-label="Back 30 seconds">${iconSvg('rewind')}</button>
            <button class="icon-button audio-play-button" type="button" aria-label="Play">${iconSvg('play')}</button>
            <button class="icon-button audio-forward" type="button" aria-label="Forward 30 seconds">${iconSvg('forward')}</button>
            <button class="icon-button audio-sleep" type="button" aria-label="Set sleep timer">${iconSvg('moon')}</button>
          </div>
        </div>
      </div>`;

    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    audio.preload = 'metadata';
    audio.playbackRate = this.speed;
    const seek = this.container.querySelector('.audio-seek');
    const current = this.container.querySelector('.audio-current');
    const remaining = this.container.querySelector('.audio-remaining');
    const playButton = this.container.querySelector('.audio-play-button');

    const isCurrent = () => !this.destroyed && this.generation === generation && this.audio === audio;

    audio.addEventListener('loadedmetadata', () => {
      if (!isCurrent()) return;
      const resume = Math.min(audio.duration || 0, book.progress?.audioTime || 0);
      if (Number.isFinite(resume)) audio.currentTime = resume;
      update();
    });
    audio.addEventListener('timeupdate', () => {
      if (!isCurrent()) return;
      update();
      this.onStateChange?.({ audioTime: audio.currentTime, duration: audio.duration || 0 });
    });
    audio.addEventListener('play', () => {
      if (!isCurrent()) return;
      playButton.innerHTML = iconSvg('pause');
      playButton.setAttribute('aria-label', 'Pause');
    });
    audio.addEventListener('pause', () => {
      if (!isCurrent()) return;
      playButton.innerHTML = iconSvg('play');
      playButton.setAttribute('aria-label', 'Play');
    });
    audio.addEventListener('error', () => {
      if (isCurrent())
        this.onToast?.(
          'Playback unavailable',
          'This audio codec is not supported by the current system media engine.',
          'error',
        );
    });

    const update = () => {
      if (!isCurrent()) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const position = audio.currentTime || 0;
      seek.value = duration ? String(Math.round((position / duration) * 1000)) : '0';
      current.textContent = formatTime(position);
      remaining.textContent = `−${formatTime(Math.max(0, duration - position))}`;
    };

    seek.addEventListener('input', () => {
      if (isCurrent() && Number.isFinite(audio.duration))
        audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
    });
    playButton.addEventListener('click', () => {
      if (!isCurrent()) return;
      if (audio.paused) {
        void audio.play().catch(() => {
          if (isCurrent())
            this.onToast?.(
              'Playback did not start',
              'The system media engine declined this audio file.',
              'error',
            );
        });
      } else {
        audio.pause();
      }
    });
    this.container.querySelector('.audio-rewind').addEventListener('click', () => {
      if (isCurrent()) audio.currentTime = Math.max(0, audio.currentTime - 30);
    });
    this.container.querySelector('.audio-forward').addEventListener('click', () => {
      if (isCurrent()) audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 30);
    });
    this.container.querySelector('.speed-button').addEventListener('click', (event) => {
      const speeds = [1, 1.25, 1.5, 1.75, 2, 0.75];
      if (!isCurrent()) return;
      this.speed = speeds[(speeds.indexOf(this.speed) + 1) % speeds.length];
      audio.playbackRate = this.speed;
      event.currentTarget.textContent = `${this.speed}×`;
      event.currentTarget.setAttribute('aria-label', `Playback speed ${this.speed} times`);
    });
    this.container.querySelector('.audio-sleep').addEventListener('click', () => this.setSleepTimer());
  }

  setSleepTimer() {
    if (this.destroyed || !this.audio) return;
    const generation = this.generation;
    const choices = [15, 30, 45, 60, 0];
    const current = Number(this.container.querySelector('.audio-sleep')?.dataset.minutes || 0);
    const minutes = choices[(choices.indexOf(current) + 1) % choices.length];
    clearTimeout(this.sleepTimer);
    const button = this.container.querySelector('.audio-sleep');
    button.dataset.minutes = String(minutes);
    button.innerHTML = minutes ? `<strong>${minutes}</strong>` : iconSvg('moon');
    button.setAttribute('aria-label', minutes ? `Sleep timer set for ${minutes} minutes` : 'Set sleep timer');
    if (minutes) {
      this.sleepTimer = setTimeout(
        () => {
          if (this.destroyed || this.generation !== generation) return;
          this.audio?.pause();
          button.dataset.minutes = '0';
          button.innerHTML = iconSvg('moon');
          this.onToast?.('Sleep timer finished', 'Audiobook playback was paused.', 'success');
        },
        minutes * 60 * 1000,
      );
      this.onToast?.('Sleep timer set', `Playback will pause in ${minutes} minutes.`, 'success');
    } else {
      this.onToast?.('Sleep timer cleared', 'Playback will continue until you pause it.', 'success');
    }
  }

  destroy() {
    this.destroyed = true;
    this.generation += 1;
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.audio = null;
    this.objectUrl = null;
  }
}

export function renderRestrictedAax(container, book) {
  container.className = 'reader-content';
  const duration = book.duration ? formatTime(book.duration) : 'Unknown';
  container.innerHTML = `
    <div class="restricted-experience">
      <span class="restricted-shield">${iconSvg('lock')}</span>
      <div>
        <h1>Protected audiobook</h1>
        <p><strong>${escapeHtml(book.title)}</strong> can be kept in your catalog, but its AAX audio is protected. Reader does not request activation data, decrypt the payload, or create an unprotected copy.</p>
      </div>
      <div class="restricted-details" aria-label="Publication details">
        <div><span>Format</span><strong>AAX</strong></div>
        <div><span>Duration</span><strong>${duration}</strong></div>
        <div><span>Access</span><strong>Metadata only</strong></div>
      </div>
      <p>Use the authorized provider application associated with this purchase to listen.</p>
    </div>`;
}

export function coverMarkup(book) {
  const hasImage = Boolean(book.coverDataUrl);
  const style = hasImage
    ? `--cover:${book.coverColor};background-image:url(&quot;${String(book.coverDataUrl).replaceAll('"', '&quot;')}&quot;)`
    : `--cover:${book.coverColor}`;
  return `<div class="book-cover${hasImage ? ' has-image' : ''}" style="${style}">
      ${hasImage ? '' : `<div class="cover-content"><span class="cover-kicker">${escapeHtml(book.formatLabel || book.format)}</span><strong class="cover-title">${escapeHtml(book.title)}</strong><span class="cover-author">${escapeHtml(book.author)}</span></div>`}
    </div>`;
}

export function readerProgressFor(book) {
  return progressPercent(book);
}
