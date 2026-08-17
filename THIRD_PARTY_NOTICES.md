# Third-party notices

Reader includes or uses software owned by its respective upstream authors. Nothing in this project implies ownership of DOMPurify, Mozilla PDF.js, JSZip, Marked, Tauri, Playwright, axe, or their trademarks.

## Vendored runtime distributions

| Component      | Version                    | Use                      | Upstream                                                | License                 | Preserved license                           |
| -------------- | -------------------------- | ------------------------ | ------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| DOMPurify      | 3.4.13                     | Imported HTML sanitizing | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) | MPL-2.0 OR Apache-2.0   | `app/vendor/licenses/DOMPurify-LICENSE.txt` |
| JSZip          | 3.10.1                     | EPUB ZIP parsing         | [Stuk/jszip](https://github.com/Stuk/jszip)             | MIT OR GPL-3.0-or-later | `app/vendor/licenses/JSZip-LICENSE.md`      |
| Marked         | 18.0.9                     | Markdown parsing         | [markedjs/marked](https://github.com/markedjs/marked)   | MIT                     | `app/vendor/licenses/Marked-LICENSE.md`     |
| Mozilla PDF.js | 6.2.108, build `0365cbde0` | Local PDF rendering      | [mozilla/pdf.js](https://github.com/mozilla/pdf.js)     | Apache-2.0              | `app/vendor/licenses/PDFjs-LICENSE.txt`     |

The exact upstream tarball URLs, registry integrity values, SHA-256 hashes, vendored filenames, and license-file hashes are recorded in `THIRD_PARTY_COMPONENTS.json`. `pnpm verify:vendor` checks every vendored runtime byte against that manifest, confirms the DOMPurify, JSZip, and Marked version markers, and confirms that the PDF.js library and worker have matching version/build identifiers.

## Build and verification dependencies

Tauri, Tauri's single-instance plugin, the Tauri CLI, Playwright, axe, and all transitive Cargo and pnpm dependencies remain governed by their upstream licenses. Exact resolved versions are locked in `src-tauri/Cargo.lock` and `pnpm-lock.yaml`. The generated SPDX document at `sbom/reader-v0.1.0-alpha.4.spdx.json` inventories the locked dependency set and the vendored runtime distributions.

## Project-source status

Reader's own source is licensed under the [MIT License](LICENSE). These notices preserve the separate terms that continue to govern third-party components.
