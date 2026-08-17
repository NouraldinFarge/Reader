# Security policy

Reader `0.1.0-alpha.4` is a public-source prerelease. It has no supported public binary release line or public download channel yet.

## Reporting privately

Do not open a public issue containing suspected-vulnerability details. Use **Report a vulnerability** in this repository's Security tab; GitHub private vulnerability reporting is enabled. Do not publish exploit details or sensitive files in an issue, discussion, or pull request.

Never attach or paste:

- copyrighted or licensed publications;
- protected audio or its filename/metadata;
- account or activation data;
- exported library JSON, private notes, highlights, or reading history;
- personal filesystem paths, usernames, logs containing filenames, certificates, keys, tokens, or cookies.

Use a tiny synthetic fixture whenever a file is needed. The privacy-safe bug template asks reporters to confirm redaction before submission.

## Security boundary

- Every imported file is untrusted and must pass format, path, count, size, extraction, markup, and image budgets.
- Imported markup is reduced to an allowlist. Active elements, foreign namespaces, event handlers, remote media, unsafe schemes, form behavior, tracking attributes, and DOM-clobbering identifiers are removed.
- PDF.js uses the packaged worker only, with scripting, JavaScript evaluation, XFA, and WebAssembly image decoders disabled. Canvas dimensions are capped.
- Protected AAX handling reads at most a bounded header and stores metadata only. Reader never requests activation bytes and never stores, decrypts, converts, or plays the protected payload.
- Reader makes no application network request and includes no telemetry, account, remote font, storefront, generic shell/process capability, or broad filesystem capability.
- The native shell creates one WebView window, denies popup requests and non-Reader navigation, disables developer tools, and focuses the existing window on a second launch.
- Per-book generations, tombstones, a library epoch, renderer-session cancellation, and a storage existence guard prevent delayed progress callbacks from recreating deleted or reset records.

The complete design and concurrency model are in [Architecture](docs/ARCHITECTURE.md).

## Dated dependency review

On August 17, 2026, production and full pnpm advisory scans reported no known advisories at the selected high threshold. `cargo audit` reported no RustSec vulnerability entries and 17 allowed cross-platform warnings, including GTK/GLib-family warnings that do not resolve into Reader's Windows target graph. This is dated evidence, not a promise that dependencies remain vulnerability-free.

GitHub dependency review separately surfaced `GHSA-wrw7-89jp-8q8g` against `glib 0.18.5` in the cross-platform Cargo lockfile. `cargo tree --target all -i glib` reaches it through GTK/WebKit/Tauri, while both the Windows host graph and `cargo tree --target x86_64-pc-windows-msvc -i glib` contain no `glib` package. The alert is therefore classified as not used by Reader's supported Windows prerelease target—not as nonexistent or fixed. Reassess and update the GTK/GLib/Tauri graph before any Linux support or distribution.

The prior private audit named `CVE-2026-16633` for the old PDF.js build. Searches of Mozilla's releases, npm package data, and the NVD did not produce an authoritative record for that identifier on the verification date, so Reader does not repeat the CVE claim as established fact. The old vendored `5.6.205` build was nevertheless replaced with official matching `6.2.108` library/worker files and tested with scripting/evaluation disabled. See [Dependency review](docs/DEPENDENCY_REVIEW.md).

## Known security and durability limits

- IndexedDB storage belongs to the local WebView2 profile and can be affected by profile loss, quota policy, operating-system cleanup, or eviction.
- The one-way JSON metadata export can contain sensitive reading information and cannot restore a library.
- The canvas-only PDF view lacks an accessible text layer.
- Browser and synthetic-input testing cannot establish safety for every malformed publication or platform codec.
- The local NSIS candidate is unsigned; no stable public release should be offered before Authenticode and clean Windows install/upgrade/uninstall verification.
- Source availability does not make the unsigned installer a supported release; binary distribution remains gated by signing and clean-Windows validation.
