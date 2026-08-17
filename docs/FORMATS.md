# Publication format behavior and limits

Reader accepts only local files the user is authorized to access. Format detection considers extension, MIME, and byte signatures; disagreements and malformed/truncated inputs fail with non-sensitive errors.

## Shared import limits

| Limit                     |                                                Value |
| ------------------------- | ---------------------------------------------------: |
| Managed open-content file |                                              512 MiB |
| Text/Markdown/HTML file   |                                               32 MiB |
| Title / author            |                                  500 characters each |
| Description               |                                     5,000 characters |
| Sanitized markup          | 25,000 elements, depth 80, 8,000,000 text characters |

The constants in `app/src/import-policy.js` and `docs/PROJECT_FACTS.json` are machine-checked for release consistency.

## EPUB

Reader opens `META-INF/container.xml`, validates the package path, parses EPUB 2 or EPUB 3 package metadata, validates unique manifest IDs and spine references, builds navigation from EPUB 3 nav or EPUB 2 NCX, and sanitizes every readable section. Query strings/fragments are separated from package-path resolution. Safe internal links become Reader-owned navigation actions.

| EPUB budget                        |                    Value |
| ---------------------------------- | -----------------------: |
| Archive and actual extracted bytes |                  200 MiB |
| ZIP entries                        |                    5,000 |
| Readable sections                  |                    1,000 |
| One entry                          |                   16 MiB |
| Package/navigation metadata entry  |                    2 MiB |
| One embedded raster image          |                    8 MiB |
| Embedded images                    | 200 files / 48 MiB total |

Traversal, drive/UNC/absolute paths, null/control bytes, encoded traversal, missing/malformed package files, duplicate identifiers, broken spine items, unsupported encodings, empty readable content, misleading/missing ZIP size metadata, and budget overruns fail closed. Embedded images require a recognized PNG, JPEG, GIF, or WebP byte signature; SVG and active image payloads are not embedded.

Not implemented: fixed-layout EPUB, protected/encrypted EPUB, media overlays, package CSS/fonts, exhaustive accessibility metadata, EPUB CFI locations, dictionaries, or universal EPUB conformance.

## PDF

The library and worker are official matching Mozilla PDF.js `6.2.108` files, build `0365cbde0`. Reader validates a PDF header and EOF marker before storage, loads local bytes with a local worker, disables scripting/evaluation/XFA/Wasm image codecs, caps image/canvas work, renders one high-DPI page at a time, and cancels stale document/page sessions.

Test fixtures cover normal three-page rendering, a JavaScript action that must not execute, rapid switching, cancellation, a synthetic password-protected blank PDF, malformed/truncated files, missing stored blobs, and local worker failure.

Not implemented: password-entry UI, selectable text layer, document outline, full-document search, PDF annotations, form editing, or complete screen-reader access to document text.

## TXT, Markdown, and HTML

TXT becomes escaped paragraphs. Markdown is parsed by vendored Marked and then sanitized. HTML is sanitized directly. Long content is sectioned at headings.

The sanitizer removes scripts, iframes, objects, embeds, forms/controls, SVG, MathML, metadata, CSS/style, `srcdoc`, event handlers, `srcset`, `ping`, `target`, `formaction`, base behavior, unsafe/remote URLs, tracking media, foreign namespaces, arbitrary classes, duplicate/clobbering IDs, and malformed active content. Safe fragments and publication-relative anchors remain keyboard-operable inside the current Reader window.

## Unprotected audio

Authorized M4B, M4A, MP3, AAC, OGG, and WAV files are stored locally and passed to the Windows WebView2 media engine. Reader remembers time/duration, offers seeking, 30-second skips, playback speed, and a session-only sleep timer. Actual codec support varies by Windows/WebView2 installation.

Reader validates recognized container/header signatures before import. Corrupt/unsupported decode behavior can still vary at the platform media layer. Chapter atoms, embedded artwork, background media keys, and guaranteed codec coverage are not implemented.

## Protected AAX

AAX is deliberately metadata-only. Reader reads at most the first 4 MiB, validates bounded ISO base-media atom structure and the expected outer file-type atom, extracts limited title/author/duration metadata where present, creates a restricted catalogue entry, and stores `null` for the payload.

Reader never asks for activation data, decrypts, converts, plays, or persists protected audio. Tests use a tiny original header-only structure and never a user-owned audiobook.
