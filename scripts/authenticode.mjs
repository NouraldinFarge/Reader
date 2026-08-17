import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const validStatuses = new Set([
  'Valid',
  'UnknownError',
  'NotSigned',
  'HashMismatch',
  'NotTrusted',
  'NotSupported',
]);

export function inspectAuthenticode(path) {
  assert.equal(process.platform, 'win32', 'Authenticode inspection requires Windows');
  const escaped = path.replaceAll("'", "''");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    'Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    '[pscustomobject]@{',
    'Status = [string]$signature.Status',
    'SignerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
  const failures = [];

  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
      failures.push(`${shell}: ${result.error?.message ?? result.stderr?.trim() ?? 'failed'}`);
      continue;
    }

    try {
      const parsed = JSON.parse(result.stdout.trim());
      assert.ok(validStatuses.has(parsed.Status), `${shell} returned invalid status ${parsed.Status}`);
      assert.ok(
        parsed.SignerSubject === null || typeof parsed.SignerSubject === 'string',
        `${shell} returned an invalid signer subject`,
      );
      return {
        status: parsed.Status,
        signerSubject: parsed.SignerSubject,
      };
    } catch (error) {
      failures.push(`${shell}: ${error.message}`);
    }
  }

  throw new Error(`Authenticode inspection failed:\n${failures.join('\n')}`);
}
