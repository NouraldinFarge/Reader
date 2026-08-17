# Security design notes

The canonical reporting policy and current dated review are in [the root security policy](../SECURITY.md). This document maps controls to evidence for `0.1.0-alpha.4`.

| Risk                                      | Control                                                                                 | Evidence                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Delayed save recreates deleted/reset data | Generations, tombstones, library epoch, in-flight drain, storage existence guard        | Repeated coordinator tests plus real IndexedDB delete/reset scenarios       |
| ZIP traversal or expansion                | Repeated decode/normalization, streamed actual-byte budgets, entry/section/image limits | Deterministic path fuzz, malformed archives, missing/misleading size tests  |
| Markup script or remote tracking          | Inert parse, element/attribute allowlist, URL classifier, no remote resources           | Hostile sanitizer corpus/fuzz and outbound-request assertion                |
| PDF active behavior                       | Matching local PDF.js, scripting/eval/XFA/Wasm disabled, worker and canvas limits       | Action fixture, worker-failure, rapid-switch, password/corruption scenarios |
| Protected-media misuse                    | Bounded metadata only and `null` payload                                                | Header/atom tests and IndexedDB assertion                                   |
| Native privilege expansion                | No shell/process/network/broad filesystem plugin; explicit window/WebView denials       | Desktop-shell structure tests and capability inspection                     |
| Extra terminal/window                     | Windows GUI subsystem, manual one-window creation, popup denial, single-instance focus  | Native source checks, process/window smoke record, browser popup monitoring |
| Sensitive release content                 | Ignore policy, public-tree/private-reference scanner, archive/artifact validator        | Dated scan reports and fingerprints without values                          |

Remaining risks are explicitly tracked in [Testing](TESTING.md), [Roadmap](../ROADMAP.md), and [Release notes](RELEASE_NOTES.md). No document claims vulnerability-free, fully accessible, production-ready, or stable status.
