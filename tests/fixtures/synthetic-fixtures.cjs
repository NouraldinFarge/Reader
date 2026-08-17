const JSZip = require('jszip');

function escapePdfString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function assemblePdf(objects) {
  const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let byteLength = chunks[0].length;

  objects.forEach((object, index) => {
    offsets[index + 1] = byteLength;
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'binary');
    chunks.push(chunk);
    byteLength += chunk.length;
  });

  const xrefOffset = byteLength;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  chunks.push(Buffer.from(xref, 'binary'));
  return Buffer.concat(chunks);
}

function createSyntheticPdf({
  pages = 2,
  withJavaScriptAction = false,
  label = 'Reader safety fixture',
} = {}) {
  const pageObjectNumbers = [];
  const contentObjectNumbers = [];
  for (let index = 0; index < pages; index += 1) {
    pageObjectNumbers.push(3 + index * 2);
    contentObjectNumbers.push(4 + index * 2);
  }
  const fontObjectNumber = 3 + pages * 2;
  const actionObjectNumber = withJavaScriptAction ? fontObjectNumber + 1 : null;
  const catalogAction = actionObjectNumber ? ` /OpenAction ${actionObjectNumber} 0 R` : '';
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${catalogAction} >>`,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages} >>`,
  ];

  for (let index = 0; index < pages; index += 1) {
    const content = [
      'q 0.93 0.95 0.98 rg 54 620 504 96 re f Q',
      `BT /F1 22 Tf 72 680 Td (${escapePdfString(label)}) Tj ET`,
      `BT /F1 14 Tf 72 640 Td (Synthetic page ${index + 1} of ${pages}) Tj ET`,
      '0.18 0.34 0.47 RG 2 w 72 610 m 540 610 l S',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumbers[index]} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if (withJavaScriptAction) {
    objects.push("<< /S /JavaScript /JS (app.alert('This action must never run')) >>");
  }
  return assemblePdf(objects);
}

function addEpubEnvelope(zip, packagePath = 'OEBPS/package.opf') {
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
        <rootfiles><rootfile full-path="${packagePath}" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`,
  );
}

async function createEpub3({ maliciousChapter = false } = {}) {
  const zip = new JSZip();
  addEpubEnvelope(zip);
  zip.file(
    'OEBPS/package.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="book-id">urn:reader:synthetic:epub3</dc:identifier>
          <dc:title>Harbor Light Field Notes</dc:title><dc:creator>Rin Vale</dc:creator>
          <dc:description>An original synthetic EPUB 3 fixture.</dc:description>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="one"/><itemref idref="two"/></spine>
      </package>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml#start">Arrival</a></li><li><a href="text/two.xhtml?view=1">Return</a></li></ol></nav></body></html>',
  );
  const unsafe = maliciousChapter
    ? '<script>window.__fixtureExecuted=true</script><img src="https://example.invalid/track.png"><svg onload="window.__fixtureExecuted=true"><script>window.__fixtureExecuted=true</script></svg><a href="javascript:alert(1)" target="_blank" ping="https://example.invalid">unsafe</a>'
    : '';
  zip.file(
    'OEBPS/text/one.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">Arrival</h1><p>The harbor lamp drew one calm line across the water.</p>${unsafe}<a href="two.xhtml#return">Continue safely</a></body></html>`,
  );
  zip.file(
    'OEBPS/text/two.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="return">Return</h1><p>The same line was waiting at dawn.</p><a href="#return">This section</a></body></html>',
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function createEpub2() {
  const zip = new JSZip();
  addEpubEnvelope(zip, 'OPS/content.opf');
  zip.file(
    'OPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:reader:synthetic:epub2</dc:identifier><dc:title>Lantern Index</dc:title><dc:creator>Oren Moss</dc:creator></metadata>
        <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine toc="ncx"><itemref idref="chapter"/></spine>
      </package>`,
  );
  zip.file(
    'OPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="n1"><navLabel><text>Indexed light</text></navLabel><content src="chapter.xhtml#light"/></navPoint></navMap></ncx>`,
  );
  zip.file(
    'OPS/chapter.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="light">Indexed light</h1><p>An original EPUB 2 navigation fixture.</p></body></html>',
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function createTraversalEpub() {
  const zip = new JSZip();
  addEpubEnvelope(zip);
  zip.file(
    'OEBPS/package.opf',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Traversal Fixture</dc:title></metadata><manifest><item id="bad" href="../escape.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="bad"/></spine></package>',
  );
  zip.file('../escape.xhtml', '<html><body><p>must not escape</p></body></html>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function createInvalidEpub(kind) {
  const zip = new JSZip();
  if (kind === 'malformed-container') {
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile');
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  addEpubEnvelope(zip);
  if (kind === 'missing-package') {
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  const manifest =
    kind === 'duplicate-manifest'
      ? '<item id="chapter" href="one.xhtml" media-type="application/xhtml+xml"/><item id="chapter" href="two.xhtml" media-type="application/xhtml+xml"/>'
      : kind === 'cover-spoof'
        ? '<item id="chapter" href="one.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>'
        : '<item id="chapter" href="one.xhtml" media-type="application/xhtml+xml"/>';
  const spine = kind === 'broken-spine' ? '<itemref idref="missing"/>' : '<itemref idref="chapter"/>';
  zip.file(
    'OEBPS/package.opf',
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Invalid ${kind}</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  const chapter =
    kind === 'empty-content'
      ? '<html><body><script>window.__emptyFixture=true</script></body></html>'
      : kind === 'oversized-entry'
        ? `<html><body><h1>Oversized</h1><p>${'x'.repeat(16 * 1024 * 1024 + 1)}</p></body></html>`
        : '<html><body><h1>Safe chapter</h1><p>Original fixture text.</p></body></html>';
  zip.file('OEBPS/one.xhtml', chapter);
  if (kind === 'duplicate-manifest') zip.file('OEBPS/two.xhtml', chapter);
  if (kind === 'cover-spoof') {
    zip.file('OEBPS/cover.png', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function createSyntheticAaxHeader() {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('aax ', 8, 'ascii');
  bytes.write('aax ', 16, 'ascii');
  return bytes;
}

function createPasswordProtectedPdf() {
  // One blank page encrypted with the synthetic password
  // "reader-test-password". Generated locally with pypdf; no external content.
  return Buffer.from(
    'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDkwMzQ0NjVlNmI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA2MTIgNzkyIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MTc5Njc1YTlhNjk3NzIzYmVkYjJiYThmNjMxZWQ5ODVkYzk2MDNkZmY1MzRhODhhY2JkNjMxMjZhYWJkYWVkYj4KL1UgPGQwZDNjMTJlNDMxZDViMzNhNDFmODI2MzIxOTRlYjdiMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1NjEzMTMyNjIzNzY0MzczODM1NjEzNjY0MzUzNTM3MzUzNjM5NjI2MjM3MzA2NDMyMzQzMjMyNjEzNzMwMzk+IDwzNTYxMzEzMjYyMzc2NDM3MzgzNTYxMzY2NDM1MzUzNzM1MzYzOTYyNjIzNzMwNjQzMjM0MzIzMjYxMzczMDM5PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK',
    'base64',
  );
}

module.exports = {
  createEpub2,
  createEpub3,
  createInvalidEpub,
  createPasswordProtectedPdf,
  createSyntheticAaxHeader,
  createSyntheticPdf,
  createTraversalEpub,
};
