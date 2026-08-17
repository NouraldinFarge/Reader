# Contributing

Reader is currently a private, unpublished prerelease without an owner-approved project license. This document describes the review standard for authorized local collaborators; it is not an invitation to reuse or redistribute the source.

## Development setup

Use Node.js 20 or newer, the pnpm version pinned in `package.json`, Rust's stable MSVC toolchain, Microsoft C++ Build Tools, and WebView2 on Windows.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm test:unit
pnpm test:coverage
pnpm test:e2e
pnpm test:rust
```

Do not update a lockfile casually. Explain why a dependency changes, preserve official license material, update `THIRD_PARTY_COMPONENTS.json` for vendored assets, regenerate the SPDX SBOM, and rerun both advisory scans.

## Privacy and fixture rules

- Never add a user-owned book, audiobook, export, annotation, WebView profile, or local database.
- Never add protected-media payloads, filenames, metadata, activation data, or account details.
- Never add personal paths, usernames, logs, browser profiles, credentials, signing material, or private provenance notes.
- Tests must use tiny original synthetic fixtures created by the repository's fixture builder. A metadata-only AAX fixture may contain structural atoms but never protected audio.
- Screenshots and demos may show only Reader's synthetic demo library and synthetic fixture names.

Run the public-tree scanner both generically and, for an authorized release review, with private reference sources supplied from outside the repository. The scanner reports rule IDs and one-way fingerprints, not the private values.

## Engineering expectations

- Keep imported content untrusted through every layer.
- Preserve the one-window/no-terminal native boundary and the WebView's least privilege.
- Keep storage changes atomic and invalidate stale asynchronous work before deletion/reset.
- Add deterministic regression coverage for each parser, persistence, privacy, or security fix.
- Use semantic accessible controls, visible focus, safe status announcements, reflow at zoom, and reduced-motion support.
- Update the canonical facts ledger and recruiter drafts only after evidence changes.
- Use focused, reviewable commits with truthful messages. Do not backdate or fabricate history.

## AI-assisted work

AI coding agents may assist with research, implementation, testing, and iteration, but their output must be reviewed as untrusted proposed work. The human owner defines requirements and boundaries, validates behavior and evidence, makes licensing/security/release decisions, and remains accountable for published claims. Record material AI assistance; never invent an independent human team or treat generated tests as a substitute for human review.

## Change checklist

- Frozen pnpm and Cargo locks install/resolve.
- Formatting, conventional linting, unit/security tests, coverage thresholds, browser tests, Rust checks, facts, links, vendor hashes, and scans pass.
- No serious/critical axe finding is introduced.
- No outbound request, popup, auxiliary WebView, console window, or native authority is introduced.
- Documentation names current limitations and does not claim React, TypeScript, Vite, SQLite, cloud sync, DRM support, WCAG conformance, signing, stability, or public release unless independently true.
