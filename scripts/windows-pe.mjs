import assert from 'node:assert/strict';

const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;

export function inspectWindowsPe(buffer) {
  assert.ok(Buffer.isBuffer(buffer), 'PE input must be a Buffer');
  assert.ok(buffer.length >= 0x100, 'PE input is too small');
  assert.equal(buffer.toString('ascii', 0, 2), 'MZ', 'Missing DOS MZ signature');

  const peOffset = buffer.readUInt32LE(0x3c);
  assert.ok(peOffset >= 0x40, 'Invalid PE header offset');
  assert.ok(peOffset + 24 + 70 <= buffer.length, 'Truncated PE headers');
  assert.equal(buffer.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', 'Missing PE signature');

  const machine = buffer.readUInt16LE(peOffset + 4);
  const optionalHeader = peOffset + 24;
  const optionalMagic = buffer.readUInt16LE(optionalHeader);
  assert.ok([0x10b, 0x20b].includes(optionalMagic), 'Unsupported PE optional-header format');

  const subsystem = buffer.readUInt16LE(optionalHeader + 68);
  return {
    machine: `0x${machine.toString(16).padStart(4, '0')}`,
    optionalMagic: `0x${optionalMagic.toString(16)}`,
    subsystem,
    subsystemName: subsystem === IMAGE_SUBSYSTEM_WINDOWS_GUI ? 'Windows GUI' : 'not Windows GUI',
  };
}

export function assertWindowsGuiPe(buffer) {
  const details = inspectWindowsPe(buffer);
  assert.equal(
    details.subsystem,
    IMAGE_SUBSYSTEM_WINDOWS_GUI,
    `Expected Windows GUI subsystem (${IMAGE_SUBSYSTEM_WINDOWS_GUI}), received ${details.subsystem}`,
  );
  return details;
}
