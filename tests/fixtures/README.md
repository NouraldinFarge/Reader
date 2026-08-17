# Synthetic test fixtures

Reader's browser tests create their publication fixtures in memory from
[`synthetic-fixtures.cjs`](./synthetic-fixtures.cjs). The text, metadata, EPUB
packages, PDF objects, and protected-audio headers are original test material;
they contain no copied book, account, activation, or user data.

The repository intentionally does not contain real publications. Generated
files stay in ignored test-output directories and are discarded with the test
browser context.

These fixtures exercise parser and renderer behavior only. They are not claims
of complete conformance with every EPUB, PDF, or audio producer.
