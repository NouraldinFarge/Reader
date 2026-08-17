# Dependency and advisory review

Verified August 17, 2026 for the private `0.1.0-alpha.4` candidate.

## Vendored runtime files

- JSZip `3.10.1`, official npm tarball; vendored and license hashes match `THIRD_PARTY_COMPONENTS.json`.
- Marked upgraded from `17.0.5` to `18.0.9`, official npm tarball; vendored and license hashes match.
- Mozilla PDF.js upgraded from `5.6.205` to `6.2.108`; library and worker both report build `0365cbde0` and match the manifest hashes.

Official provenance references: [Mozilla PDF.js releases](https://github.com/mozilla/pdf.js/releases), [pdfjs-dist on npm](https://www.npmjs.com/package/pdfjs-dist), [JSZip](https://www.npmjs.com/package/jszip), and [Marked](https://www.npmjs.com/package/marked).

The private starting audit attributed `CVE-2026-16633` to the old PDF.js build. Authoritative searches of Mozilla release/advisory material, npm package data, and the NVD returned no record for that identifier on the verification date. That identifier is therefore recorded as **unverified**, not repeated as an established vulnerability or used to invent fixed-version guidance. The dependency was still upgraded to the current official stable package available during the review, with matching library/worker artifacts and defensive options preserved.

## JavaScript advisory results

- `pnpm audit --prod --audit-level high`: passed; no known advisories reported.
- `pnpm audit --audit-level high`: passed; no known advisories reported across the installed development graph.
- Frozen reinstall from `pnpm-lock.yaml`: passed.

These are dated registry results and can change.

## Rust advisory results

- `cargo audit --file src-tauri/Cargo.lock`: exited successfully with no RustSec vulnerability entries.
- The same scan reported 17 allowed warnings in the cross-platform lock, including unmaintained GTK-related families and `glib 0.18.5` advisory `RUSTSEC-2024-0429`.
- `cargo tree --target x86_64-pc-windows-msvc --locked` plus the repository verifier confirmed GTK/GLib/ATK/GDK/Pango/Cairo families are absent from the Windows-resolved graph.

The warnings remain visible rather than being relabeled as a clean all-platform result. Reader's release scope is Windows; a future Linux target would need its own dependency remediation and review.

## Machine-readable evidence

- `pnpm-lock.yaml`
- `src-tauri/Cargo.lock`
- `THIRD_PARTY_COMPONENTS.json`
- `sbom/reader-v0.1.0-alpha.4.spdx.json`
- `scripts/verify-vendors.mjs`
- `scripts/verify-windows-dependencies.mjs`
