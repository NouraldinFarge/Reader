# Roadmap

This roadmap separates verified `0.1.0-alpha.4` scope from ideas. It is not a delivery promise.

## Shipped in the private alpha candidate

- Local library and focused reader for bounded EPUB, PDF, TXT, Markdown, HTML, and unprotected audio imports.
- Metadata-only protected-AAX boundary.
- Offline progress, bookmarks, highlights, notes, collections, search, themes, and one-way sensitive metadata export.
- IndexedDB persistence with atomic import/delete/reset operations and stale-save invalidation.
- Least-privilege Tauri shell with one window, single-instance focus, popup denial, restricted navigation, disabled developer tools, and no Windows console.
- Locked dependencies, conventional quality gates, real Chromium scenarios, accessibility automation, vendor verification, private-data scanning, CI definitions, and SPDX inventory.

## Required before public consideration

- Owner-approved project license.
- Owner-approved repository name, remote, visibility, security-report route, and publication plan.
- Signed installer using an owner-approved Authenticode certificate.
- Clean Windows 10/11 installation, first/offline launch, persistence, upgrade, uninstall, and residual-data verification.
- Manual assistive-technology and 400% zoom review, plus final packaged PDF/audio/import checks.
- Human review of recruiter screenshots, demo, README, facts, and claims.

## Candidate product improvements

- Accessible PDF text layer, selection, document outline, and search.
- Explicit data migration/export-and-restore design before any storage-backend change.
- Better EPUB locator stability and navigation coverage.
- Background media-key behavior and richer unprotected-audio chapter metadata.
- Performance profiling with large allowed synthetic inputs.

React, TypeScript, Vite, a narrow Rust command facade, and SQLite WAL are architecture options only if product needs justify and fully verify a migration. They are not résumé-keyword commitments.

## Rejected scope

- Storefront, publication downloader, advertising, or tracking.
- DRM removal, activation-key handling, AAX decryption/conversion/playback, or protected-payload persistence.
- Silent cloud sync, account requirements, or uploading a library to Reader-operated services.
- Claims of universal format support, archival durability, full accessibility, or security guarantees.
