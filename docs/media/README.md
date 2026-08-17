# Recruiter media

All assets were captured or composed locally on August 17, 2026 from the real Reader `0.1.0-alpha.4` UI using only the original synthetic demo library and repository-generated fixtures. No user-owned publication, protected payload, private note, personal path, username, account data, notification, browser history, or unrelated window appears.

## Screenshots

Four JPEGs are 1440×900 viewport captures:

- `screenshots/library-overview.jpg` — three original demo titles, library navigation, search, progress, and privacy message.
- `screenshots/focused-reading.jpg` — synthetic essay reader and existing synthetic highlight.
- `screenshots/notes-and-search.jpg` — accessible in-book search with synthetic result and highlight.
- `screenshots/appearance-controls.jpg` — paper/sepia/night, text size, spacing, type, and focus controls.

Two compact fixture views are 1280×720 JPEG captures:

- `screenshots/pdf-view.jpg` — repository-generated three-page PDF rendered by local PDF.js.
- `screenshots/protected-content-boundary.jpg` — repository-generated 24-byte AAX-like header presented as metadata-only.

Alt text is centralized in `docs/RECRUITER_COPY.md` and used by the README where applicable.

## Demo

`demo/reader-alpha4-demo.mp4` is a 75-second, 1440×900, 30 fps H.264 visual walkthrough built from the real captures. It has no audio; use `docs/DEMO_SCRIPT.md` for timed narration/captions. The source sequence/filter files make the composition reproducible. First, middle, and final frames were extracted and visually inspected after encoding.

`demo/reader-alpha4-demo-thumbnail.jpg` is a 1280×720 composition using the real library capture.

## Social previews

- `social/github-social-preview.png` — 1280×720.
- `social/portfolio-og-preview.png` — 1200×630.
- `social/preview-source.html` — reproducible composition source using the real library capture.

Both rendered previews identify Reader as a public-source alpha. They are repository assets ready for an owner-approved upload, but this document does not claim either image is configured on an external profile.

Regenerate the previews with `pnpm generate:social-previews`, then run `pnpm verify:media` to check the tracked dimensions and public-source label.
