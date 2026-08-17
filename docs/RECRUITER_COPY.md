# Verified recruiter copy — do not publish yet

Canonical facts date: August 17, 2026  
Exact candidate: `0.1.0-alpha.4`  
Status: private GitHub staging candidate; not publicly released  
Repository URL: <https://github.com/NouraldinFarge/Reader> (private staging)  
Release URL: not available—no release approved  
Demo URL: not available—no public demo approved  
License: MIT  
Installer: local unsigned candidate only; public download prohibited

Every draft below is synchronized with `docs/PROJECT_FACTS.json`. The source is staged only in a private GitHub repository; none of this recruiter copy has been placed on a résumé, portfolio, LinkedIn, Indeed, or another public surface.

## Canonical positioning

Local-first Windows reading library with bounded publication imports, offline progress and annotations, and a least-privilege Tauri shell.

## Evidence snapshot

- Frontend: HTML, CSS, plain JavaScript ES modules
- Persistence: IndexedDB in the WebView profile
- Native shell: Rust and Tauri v2; one window/process, no launch terminal, no generic shell/process/network/broad filesystem authority
- Runtime parsing/rendering: JSZip `3.10.1`, Marked `18.0.9`, PDF.js `6.2.108`
- Formats: EPUB 2/3, PDF, TXT, Markdown, HTML, unprotected M4B/M4A/MP3/AAC/OGG/WAV, protected AAX metadata only
- Automated evidence: 40/40 Node tests; 7/7 Chromium scenario groups; six axe scans with zero serious/critical findings; 99.19% lines and 89.67% branches across import policy/save coordination
- Candidate date: August 17, 2026
- Current blockers: Authenticode signing, clean Windows install/upgrade/uninstall matrix, manual assistive-technology/high-contrast/400% zoom checks, security-route verification, and final publication approval

## GitHub About draft

Local-first Windows reading library for EPUB, PDF, text, and authorized audio, with bounded imports, offline progress and annotations, and a least-privilege Tauri shell.

Proposed topics: `tauri`, `rust`, `javascript`, `indexeddb`, `pdfjs`, `epub`, `local-first`, `desktop-app`, `windows`, `accessibility`.

Do not add `react`, `typescript`, `vite`, `sqlite`, `cloud-sync`, `drm`, or `aax-player`.

## Résumé and Indeed

### Short version

Built Reader `0.1.0-alpha.4`, a private local-first Windows reading-library candidate for EPUB, PDF, text, Markdown/HTML, and authorized audio, with offline progress, bookmarks, annotations, collections, and privacy-aware export.

### Full version

- Built and verified Reader `0.1.0-alpha.4`, a local-first Windows reading-library candidate for authorized EPUB, PDF, text, Markdown/HTML, and unprotected audio, with IndexedDB-backed offline progress, bookmarks, highlights, private notes, collections, themes, and one-way sensitive metadata export.
- Hardened untrusted publication handling with traversal and actual-extraction budgets, allowlist markup sanitization, disabled PDF scripting/evaluation, metadata-only protected-AAX handling, atomic persistence, and a least-privilege one-window Tauri shell; validated by 40 Node tests, seven real Chromium scenario groups, and six axe scans with zero serious/critical findings.

Indeed should use these exact bullets, shortened only for layout. Do not create an Indeed-only version that changes technologies, status, metrics, or release claims.

## Portfolio project card

### Short version

Reader is a private local-first Windows reading-library candidate with bounded EPUB/PDF/text imports, offline progress and annotations, and a least-privilege Tauri shell.

### Full version

Reader brings authorized EPUB, PDF, text, and unprotected audio files into a focused local library. It combines bounded import parsing, allowlist-sanitized content, disabled PDF scripting/evaluation, reliable offline progress and annotations, metadata-only protected-AAX handling, and a native shell that exposes no generic network, shell, process, or broad filesystem authority. The MIT-licensed `0.1.0-alpha.4` candidate is backed by unit, parser, persistence, browser, accessibility-automation, dependency, and artifact checks; it remains private while signing and clean-Windows validation are incomplete.

## GitHub profile draft

### Short version

**Reader `0.1.0-alpha.4`** — Private local-first Windows reading-library candidate with bounded imports, offline progress and annotations, and a least-privilege Tauri shell. JavaScript · IndexedDB · Rust/Tauri.

### Full version

**Reader `0.1.0-alpha.4`** is a local-first Windows reading-library candidate for authorized EPUB, PDF, text, and unprotected audio. It pairs bounded/sanitized imports with offline progress, annotations, collections, metadata-only protected-AAX handling, and a one-window Rust/Tauri shell. The source is MIT-licensed; public release remains pending signing and clean-machine evidence.

## LinkedIn project draft

### Short version

Built and locally verified Reader `0.1.0-alpha.4`, a private local-first Windows reading-library candidate for EPUB, PDF, text, Markdown/HTML, and authorized audio.

### Full version

Built Reader `0.1.0-alpha.4`, an MIT-licensed local-first Windows reading-library candidate for authorized EPUB, PDF, text, Markdown/HTML, and unprotected audio. Implemented bounded EPUB imports, allowlist-sanitized markup, a hardened local PDF.js renderer, offline IndexedDB progress, bookmarks, highlights, notes, collections, and a least-privilege one-window Tauri shell. Protected AAX files are metadata only—Reader does not request activation data, store protected payloads, decrypt, convert, or play them. Verified locally with 40 Node tests, seven real Chromium scenario groups, dependency scans, vendor hashes, and six axe scans with zero serious/critical findings. The project remains in private staging pending a signed installer and clean Windows release matrix.

## Current limitations for every surface

- Private staging alpha; repository URL exists, but there is no public release or demo URL.
- IndexedDB durability depends on the local WebView2 profile; JSON export cannot restore a library.
- Canvas-only PDF without text selection, document search, PDF annotations, password-entry UI, or complete screen-reader access.
- No fixed-layout/protected EPUB, CFI locations, background media controls, cloud sync, or cross-device support.
- Platform audio codecs vary.
- Automated axe evidence is not WCAG conformance.
- Installer unsigned; clean Windows install/upgrade/uninstall and residual-data matrix not run.
- Source is MIT-licensed; third-party components retain their own terms.

## AI-assistance disclosure

AI coding agents assisted with research, implementation, testing, and iteration. Nouraldin Farge defined the requirements and architecture, reviewed and validated changes, set the safety, licensing, and data-source boundaries, and retains responsibility for published claims and releases.

## Screenshot and demo references

| Asset                      | Path                                                    | Alt text / status                                                                                                  |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Library overview           | `docs/media/screenshots/library-overview.png`           | “Reader library overview showing three original synthetic titles, search, progress, and local-library navigation.” |
| Focused reading            | `docs/media/screenshots/focused-reading.png`            | “Reader focused reading view in sepia with contents, typography controls, and synthetic essay text.”               |
| PDF view                   | `docs/media/screenshots/pdf-view.png`                   | “Reader canvas PDF view showing a synthetic verification document and page controls.”                              |
| Notes/search               | `docs/media/screenshots/notes-and-search.png`           | “Reader highlights view showing one original synthetic quote and private-note workflow.”                           |
| Protected-content boundary | `docs/media/screenshots/protected-content-boundary.png` | “Reader metadata-only protected-content screen explaining that playback and decryption are unavailable.”           |
| Appearance controls        | `docs/media/screenshots/appearance-controls.png`        | “Reader appearance panel with paper, sepia, and night themes and typography controls.”                             |
| Recruiter demo             | `docs/media/demo/reader-alpha4-demo.mp4`                | 75-second real-UI walkthrough; private/local file only until human approval.                                       |
| Demo thumbnail             | `docs/media/demo/reader-alpha4-demo-thumbnail.png`      | Real library UI thumbnail; local file only until human approval.                                                   |
| GitHub social preview      | `docs/media/social/github-social-preview.png`           | 1280×640 composition using the real library capture and verified positioning.                                      |
| Portfolio preview          | `docs/media/social/portfolio-og-preview.png`            | 1200×630 composition using the real Reader UI and verified stack.                                                  |

## Publication checklist for copy owners

Before copying any draft to a public surface, add only approved live URLs, rerun the facts checker, update evidence from the signed clean-machine candidate, remove “private candidate” only if genuinely published, and obtain separate approval for each live edit. Never change “built” to “released” merely because a local installer exists.
