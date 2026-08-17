# Reader 0.1.0-alpha.4 release-candidate notes

Date: August 17, 2026  
Status: private local candidate; not published  
Repository URL: not available; no remote approved  
Release URL: not available; no release approved

## Release scope

Reader `0.1.0-alpha.4` is a Windows-first, local-first reading-library prerelease. It reads authorized EPUB, PDF, TXT, Markdown, HTML, and unprotected audio files; remembers progress and annotations offline; and wraps the plain-JavaScript UI in a least-privilege Tauri v2 shell.

## Fixed

- Replaced delayed ad-hoc progress saves with an immutable save coordinator using per-book generations, tombstones, a library epoch, in-flight serialization, explicit flush/invalidation, and safe error handling.
- Prevented stale callbacks across deletion, library reset, reader close, renderer destruction, and rapid PDF/audio transitions from recreating records or overwriting a newer reader.
- Added a database existence guard plus explicit IndexedDB transaction abort handling for synchronous quota-style failures.
- Fixed browser-discovered contrast, accessible-name, sanitizer-root, and asynchronous reader-transition defects.

## Security and parser changes

- Upgraded official vendored PDF.js library and worker from `5.6.205` to matching `6.2.108` build `0365cbde0`; retained disabled scripting/evaluation and also disabled XFA/Wasm image decoding with canvas limits and local-worker enforcement.
- Upgraded Marked to `18.0.9`; retained JSZip `3.10.1`; recorded official origins, integrity values, licenses, and hashes.
- Added repeated-decode archive-path rejection, streamed actual-byte accounting, metadata/section/image/markup budgets, EPUB 2/3 navigation validation, byte-signature image checks, abort support, and secure chunked fingerprints.
- Replaced broad markup preservation with element/attribute allowlisting, URL classification, namespace/foreign-content removal, and DOM-clobbering protection.
- Added bounded AAX atom/header validation that never stores a protected payload.

## Verification and release engineering

- Added a frozen pnpm lock, exact tool versions, formatting/lint/coverage gates, real Playwright/axe scenarios, dependency audits, vendor verification, facts/link/private-data checks, SPDX generation, pinned-action CI definitions, Dependabot policy, and privacy-safe issue templates.
- Automated result: 40/40 Node tests and seven/seven Chromium scenario groups passed; six axe scans had zero serious/critical findings; high-risk modules reached 99.19% line coverage and 89.67% branch coverage.
- JavaScript audits reported no known advisories at the tested threshold. RustSec reported no vulnerability entries and 17 cross-platform warnings; GTK/GLib families were confirmed absent from the Windows graph.
- Preserved Windows GUI-subsystem, one-window, native popup-denial, restricted-navigation, disabled-devtools, and single-instance behavior.

## Breaking or changed expectations

- JSON export wording now states that exports are sensitive, one-way metadata and are not restorable library backups.
- Windows bundle scope is explicitly NSIS; no portable distribution is claimed or tested.
- This is another alpha candidate because clean-machine, signing, licensing, and human accessibility gates remain incomplete.

## Publication blockers

- No owner-approved project-source license.
- Unsigned installer; no signing certificate use approved.
- No clean Windows 10/11 install, offline launch, persistence, upgrade, uninstall, and residual-data matrix.
- No public repository/remote, security advisory route, tag, release, or download has been approved.
- Manual screen-reader, Windows high-contrast, 400% zoom, and packaged audio/PDF verification remain incomplete.

No public release should be created from these notes until every blocker is closed and the facts ledger is regenerated.
