# Release process

Reader separates source publication, private binary staging, and a supported public binary release. A source repository does not make an unsigned installer supported.

## 1. Verify the exact source commit

Use a clean worktree and the pinned dependency versions.

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm test:unit
pnpm test:coverage
pnpm test:e2e
pnpm verify:vendor
pnpm verify:facts
pnpm verify:links
pnpm verify:private-data
pnpm audit --prod --audit-level high
pnpm audit --audit-level high
pnpm verify:windows-dependencies
pnpm scan:cargo
pnpm test:rust
pnpm generate:sbom
```

For an authorized release review, also pass each private reference input to the privacy scanner with a separate `--private-source` argument. The scanner prints rule IDs and one-way fingerprints, never private values.

## 2. Build and inspect the Windows candidate

```powershell
pnpm build:windows:release
pnpm verify:windows-binary -- --file <path-to-reader.exe>
```

The release builder remaps the workspace, Cargo home, and Windows user-profile roots before compilation, uses the project-local Tauri tool cache, and rejects an executable that still contains the build user's profile path. The PE verifier requires subsystem `2` (`Windows GUI`). This is the binary property that prevents a console from appearing during normal executable or shortcut launch. The desktop-shell tests verify the one-window policy statically; the final candidate must also pass the separate two-launch smoke in an interactive Windows user session.

## 3. Create immutable source and candidate artifacts

The source archive is generated from the committed Git tree, always has a stable top-level `reader/` directory, excludes untracked build/test/private material, and refuses to overwrite an existing path.

```powershell
pnpm archive:source -- --output <reader-version-date-source.zip>

pnpm prepare:release -- `
  --directory <new-private-candidate-directory> `
  --source-archive <reader-version-date-source.zip> `
  --installer <path-to-nsis-installer> `
  --executable <path-to-reader.exe>

pnpm verify:release -- --directory <new-private-candidate-directory>
pnpm scan:release -- --directory <new-private-candidate-directory>
```

The candidate generator refuses an existing directory and records hashes, source commit, build-tool versions, PE subsystem, Authenticode status, and unresolved release gates. `CHECKSUMS.sha256` covers the distributable source, installer, executable, SBOM, notices, and notes.

## 4. Enforce publication gates

Before a supported public binary release:

- sign the executable and installer with an authorized Authenticode certificate;
- run the clean Windows 10/11 install, offline launch, persistence, upgrade, uninstall, and residual-data matrix;
- complete the scoped screen-reader, high-contrast, 400% zoom, packaged PDF, and packaged audio checks;
- confirm the enabled GitHub private-vulnerability-reporting/security-advisory route remains available;
- rerun artifact verification and privacy scanning against the signed candidate;
- obtain explicit approval for visibility, tag, release, binary upload, and any recruiter/profile edits.

If any mandatory gate fails, keep the candidate private and report **NOT READY**. Never replace or mutate an older versioned archive.
