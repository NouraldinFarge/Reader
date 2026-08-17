# Changelog

All notable changes are recorded here. Reader uses Semantic Versioning while pre-1.0 APIs and storage schemas remain subject to change.

## 0.1.0-alpha.4 — 2026-08-17

### Fixed

- Replaced ad-hoc delayed progress writes with immutable snapshots, per-book generations, tombstones, a library epoch, in-flight serialization, and explicit flush/invalidation so closing, deletion, reset, and renderer destruction cannot resurrect stale records.
- Added storage-level missing-book guards and explicit IndexedDB abort/drain behavior for synchronous quota-style write failures.
- Fixed contrast, narrow-layout accessible naming, sanitizer-root handling, and stale asynchronous reader transitions found by the real-browser suite.

### Security

- Upgraded matching vendored PDF.js library/worker files to `6.2.108` build `0365cbde0`, with scripting, evaluation, XFA, Wasm image decoding, remote workers, and excessive canvases disabled or bounded.
- Added streamed actual-byte ZIP enforcement, repeated-decoding path policy, EPUB 2/3 validation, markup/image budgets, byte-signature checks, secure chunked fingerprints, cancellation, and a stricter allowlist sanitizer.
- Added bounded structural AAX metadata parsing with explicit proof that protected payloads are never persisted.

### Verification and documentation

- Added frozen pnpm dependency resolution, exact quality-tool versions, conventional lint/format gates, high-risk coverage thresholds, seven real Chromium scenario groups, six axe scans, advisory checks, vendor hashing, private-data scanning, SPDX generation, pinned CI actions, Dependabot configuration, and privacy-safe issue templates.
- Added canonical facts/recruiter copy, release/testing/security/architecture evidence, AI-assistance accountability, support guidance, naming review, demo script, and shipped/planned/rejected roadmap separation.
- Kept the candidate private and unsigned. Project licensing, Authenticode use, clean-machine validation, and every public-surface action remain owner-controlled blockers.

## 0.1.0-alpha.3 — 2026-08-16

### Changed

- Windows now uses the GUI subsystem in every build profile, so directly launching either a local or packaged Reader executable does not create a console window.
- The sole `main` WebView is created through the native builder with popup requests denied before application JavaScript runs and top-level navigation restricted to Reader's packaged or local-development origin.
- Separate developer tools and frontend window/webview creation are explicitly disabled at the configuration and capability boundaries.
- Imported publication links no longer retain browser `href` popup affordances; safe internal navigation remains keyboard accessible inside the existing Reader surface.
- Expanded desktop-shell regression coverage for unconditional console suppression, manual one-window creation, native popup denial, capability denials, and absence of child-process launch code.
- Windows source-archive dates now follow the project's local calendar date, consistent with the documented release convention.

## 0.1.0-alpha.2 — 2026-08-16

### Changed

- Windows release binaries now use the GUI subsystem so normal installed-app launches do not create a console window.
- Added Tauri's desktop single-instance guard as the first native plugin. Re-launching Reader exits the second process, restores the existing main window if minimized, shows it, and focuses it.
- Replaced the clickable brand link with an in-app route button and removed imported `target`/`ping` attributes, closing remaining auxiliary-window paths.
- Added desktop-shell regression tests for the Windows subsystem, exactly-one-window configuration, single-instance focus behavior, and new-window prevention.

## 0.1.0-alpha.1 — 2026-08-16

### Added

- Local-first library with responsive grid/list views, search, filters, collections, and first-run sample titles.
- Focused reading surface with contents, appearance themes, typography controls, focus mode, bookmarks, highlights, notes, and progress persistence.
- Bounded EPUB import, sanitized text/Markdown/HTML import, PDF.js page renderer, and unprotected audio player.
- Explicit metadata-only AAX cataloguing validated against the supplied protected audiobook; no audio blob persistence.
- Offline vendored JSZip, Marked, and PDF.js distributions with license texts.
- IndexedDB v1 repository, JSON library/annotation exports, destructive-action confirmation, and reset flow.
- Tauri v2 shell source with a least-privilege capability and Windows NSIS configuration.
- Node unit/structure tests, Playwright user-journey smoke test, zero-dependency local server, release archive tooling, and project documentation.

### Known limitations

- IndexedDB is the alpha persistence layer; Rust/SQLite WAL is planned before stable release.
- PDF text selection/search/annotations and EPUB CFI-grade locations are not yet available.
- React/TypeScript/Vite migration and signed Windows packaging require the target development toolchain.
