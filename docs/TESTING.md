# Verification strategy and dated results

Reader `0.1.0-alpha.4` separates deterministic module checks, real-browser behavior, local packaged-app checks, and clean-machine release validation. A passing lower layer is never presented as evidence for a higher one.

## Automated Node suites

```powershell
pnpm test:unit
```

Result on August 17, 2026: **40 of 40 passed**.

The suites cover pure helpers, source/HTML structure, no-terminal/one-window shell policy, save-coordinator generations and tombstones, repeated pending/in-flight deletion and reset races, close flush, error reporting, path fuzz, streamed extraction limits, URL policy, encoding/signature policy, secure large-file fingerprints, AAX atom bounds, PDF/audio signature checks, and parser cancellation.

```powershell
pnpm test:coverage
```

Coverage scope and result:

| Module                        | Lines/statements | Branches | Functions |
| ----------------------------- | ---------------: | -------: | --------: |
| `app/src/import-policy.js`    |           98.70% |   88.60% |      100% |
| `app/src/save-coordinator.js` |             100% |   92.72% |      100% |
| Combined gate                 |           99.19% |   89.67% |      100% |

The enforced minimum is 85% lines/statements/functions and 80% branches. Coverage does not include or hide either high-risk module.

## Real Chromium suite

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

Result on August 17, 2026: **seven of seven scenario groups passed**.

| Group                | Verified behavior                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core reading         | First-run synthetic library, stable search focus, text reading, theme/appearance, annotations, reload persistence, sensitive export schema/warning, offline/outbound assertion, console/CSP monitoring |
| Hostile import       | Markup sanitizer corpus/fuzz, EPUB 2/3 navigation, malformed/traversal/budget archives, AAX metadata-only payload absence                                                                              |
| IndexedDB            | Import and reload, settings/annotations/collections, duplicate detection, queued deletion/reset races, schema/integrity inspection                                                                     |
| Transaction rollback | Synchronously injected `QuotaExceededError` at a real `IDBObjectStore.put`, explicit transaction abort, no partial book/blob; not a physical quota-ceiling test                                        |
| PDF                  | Matching worker, three pages, zoom, action suppression, rapid switching/cancellation, synthetic password protection, corruption and missing-blob recovery                                              |
| Worker failure       | Local PDF worker route failure contained without leaving the UI unusable                                                                                                                               |
| Responsive/keyboard  | 860×620 minimum viewport, narrow layout, keyboard route/dialog actions, 200% browser zoom, reduced motion                                                                                              |

Six axe scans covered the library, settings dialog, night reader/search, protected-content boundary, PDF view, and narrow layout. They found **zero serious or critical issues**. Some moderate landmark findings remain in nested reader layouts and are not hidden. This is not a WCAG-conformance claim.

Automated browser coverage does not yet include reliable platform audio decoding, 400% zoom, Windows high-contrast mode, or a real screen reader.

## Quality, dependency, and supply-chain gates

```powershell
pnpm format:check
pnpm lint
pnpm verify:vendor
pnpm verify:facts
pnpm verify:links
pnpm verify:private-data
pnpm audit --prod --audit-level high
pnpm audit --audit-level high
pnpm generate:sbom
```

Prettier, Cargo fmt, ESLint, Stylelint, and Markdownlint are conventional format/lint checks; no syntax-only check is called type checking. The facts checker keeps versions/status/metrics synchronized. The link checker verifies repository-local link targets. The private-data scanner reports rule IDs and fingerprints without printing private reference values.

## Rust and Windows dependency gates

```powershell
pnpm verify:windows-dependencies
pnpm scan:cargo
pnpm test:rust
```

The Rust gate runs fmt, clippy with warnings denied, locked check, and tests. The advisory gate reports cross-platform warnings; the separate Windows-tree verifier proves GTK/GLib families do not enter the release target graph.

## Native and packaged-app evidence

The alpha.4 shell was compiled as a Windows GUI-subsystem executable. Directly launching the exact release executable opened one Reader window with no direct terminal descendant; a second launch returned focus to that same window and left one Reader process. The NSIS current-user installer also built successfully. Exact artifact hashes and unsigned Authenticode status are recorded in the release-candidate manifest and report.

No terminal is expected when launching `reader.exe` or an installed shortcut. `pnpm dev` and `pnpm tauri dev` are developer commands and intentionally retain the terminal that invoked them.

## Clean Windows matrix — publication blocker

The following must run on a clean Windows 10 and/or Windows 11 environment before publication:

- current-user NSIS install and first launch;
- offline launch and import of synthetic EPUB/PDF/text/audio;
- restart persistence;
- second-launch focus with one process/window and no console;
- upgrade from the previous supported installer;
- uninstall and explicit residual IndexedDB/profile-data inspection;
- Authenticode verification after owner-approved signing;
- screen-reader, high-contrast, 400% zoom, and platform audio checks.

This matrix is currently **not run**, so the candidate remains not ready for publication regardless of local automated results.
