# Recruiter demo script

Target length: 75 seconds. Use only the real `0.1.0-alpha.4` UI and synthetic demo/fixture data. Capture one Reader window with no terminal, browser chrome, notifications, personal desktop, paths, or unrelated applications.

## Shot list and narration

|   Time | Real UI action                                                      | Narration / caption                                                                                                                                                |
| -----: | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   0–7s | Open on the library overview; pause over the three synthetic covers | “Reader is a local-first Windows reading library for files you are authorized to use.”                                                                             |
|  7–16s | Search for “attention”; clear the search without losing focus       | “The library, search, progress, and annotations stay in the local WebView profile—no account or Reader cloud.”                                                     |
| 16–29s | Open _The Practice of Attention_, switch to sepia, enlarge type     | “The focused reader remembers position and appearance, with bookmarks, highlights, and private notes.”                                                             |
| 29–40s | Show the existing synthetic highlight/note and table of contents    | “Reading state is coordinated so delayed saves cannot recreate a title after deletion or reset.”                                                                   |
| 40–51s | Return to the library and open the synthetic PDF fixture            | “PDF pages use a local matching PDF.js worker with scripting and evaluation disabled.”                                                                             |
| 51–61s | Show Add books, then the generic protected-content boundary fixture | “EPUB and markup imports are bounded and sanitized. Protected AAX remains metadata-only—no activation data, decryption, conversion, playback, or payload storage.” |
| 61–70s | Open settings and pause on the export warning                       | “Exports can contain sensitive reading metadata and are clearly labeled one-way, not restorable backups.”                                                          |
| 70–75s | Return to the overview/title card                                   | “This public-source alpha is test-backed and MIT-licensed, but signing and clean-machine validation still gate a supported binary release.”                        |

## Capture checklist

- Resolution 1920×1080 or 1440×900; consistent 100% UI scale.
- Cursor movements are deliberate; no rapid scrolling or hidden cuts that imply unimplemented behavior.
- Narration and captions use `docs/PROJECT_FACTS.json`; do not say “released,” “open source,” “signed,” “production-ready,” “fully accessible,” or “vulnerability-free.”
- Use the synthetic PDF/AAX fixtures only; never browse to a private file picker location in-frame.
- Confirm the final file duration is 60–90 seconds and visually inspect its first, middle, and final frames.
- Store the finished capture as `docs/media/demo/reader-alpha4-demo.mp4`, its thumbnail as `docs/media/demo/reader-alpha4-demo-thumbnail.jpg`, and optimized screenshots under `docs/media/screenshots/`.
