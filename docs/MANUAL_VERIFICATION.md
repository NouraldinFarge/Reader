# Manual and packaged-application verification

Candidate: Reader `0.1.0-alpha.4`  
Verification date: August 17, 2026  
Scope: local development machine unless a clean-machine row says otherwise

| Check                                 | Environment                              | Result                     | Evidence / limitation                                                                          |
| ------------------------------------- | ---------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Browser overview and reading loop     | Local Chromium                           | Passed                     | Real synthetic library and reader captures under `docs/media/screenshots`                      |
| No unintended outbound request        | Local Chromium automation                | Passed                     | Requests outside the local origin fail the suite                                               |
| Popup/auxiliary page monitoring       | Local Chromium automation                | Passed                     | No page/popup created in tested workflows                                                      |
| Axe serious/critical                  | Six local Chromium scans                 | Passed: 0                  | Moderate nested-landmark findings remain; no conformance claim                                 |
| Keyboard focus and dialogs            | Local Chromium automation                | Passed for covered flows   | Full screen-reader review remains                                                              |
| 200% zoom/reflow                      | Local Chromium automation                | Passed                     | 400% and Windows display scaling remain manual                                                 |
| Reduced motion                        | Local Chromium automation                | Passed                     | Windows high-contrast remains manual                                                           |
| Tauri GUI subsystem                   | Rust source/PE verification              | Passed                     | Release executable uses the Windows GUI subsystem; direct launch opened no terminal            |
| Single instance / one window          | Native source regression and local smoke | Passed                     | Two launches produced one Reader process/window and focused the existing `main` window         |
| Local NSIS build                      | Local Windows toolchain                  | Passed, unsigned           | NSIS current-user installer built; final manifest records its hash and signature status        |
| Installed first/offline launch        | Clean Windows 10/11                      | Not run                    | Publication blocker                                                                            |
| Import/restart persistence            | Clean Windows 10/11                      | Not run                    | Publication blocker                                                                            |
| Upgrade                               | Clean Windows 10/11                      | Not run                    | Publication blocker                                                                            |
| Uninstall and residual profile data   | Clean Windows 10/11                      | Not run                    | Publication blocker; IndexedDB may intentionally remain unless installer removes profile data  |
| Authenticode                          | Local installer and executable           | Not signed                 | `Get-AuthenticodeSignature` returned `NotSigned`; no certificate or authorization was provided |
| NVDA/Narrator and accessible PDF text | Clean Windows                            | Not run / known limitation | PDF is canvas-only                                                                             |

The local development machine cannot be relabeled a clean environment. An installed-app check does not establish upgrade/uninstall behavior unless both installer versions and residual profile locations are explicitly observed.
