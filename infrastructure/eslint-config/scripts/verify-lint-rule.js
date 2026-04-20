#!/usr/bin/env node
/**
 * Verifies the Konva boundary lint rule fires correctly.
 * Called by CI. Exits 0 if rule works as expected, non-zero if broken.
 *
 * Checks two things:
 * 1. The violation file triggers an error (rule is enforced).
 * 2. The allowlisted file does NOT trigger an error (allowlist works).
 */

const { execSync } = require('child_process');

let failed = false;

// Check 1: violation file must fail lint
try {
  execSync('npx eslint src/__tests__/konva-boundary-violation.ts --no-eslintrc -c ../../index.js', {
    stdio: 'pipe',
  });
  console.error('FAIL: violation file passed lint — Konva boundary rule is not enforced.');
  failed = true;
} catch {
  console.log('PASS: violation file correctly fails lint.');
}

// Check 2: allowlisted file must pass lint
try {
  execSync(
    'npx eslint src/canvas/projection/example-allowed.ts --no-eslintrc -c ../../index.js',
    { stdio: 'pipe' }
  );
  console.log('PASS: allowlisted projection file passes lint.');
} catch (err) {
  console.error('FAIL: allowlisted projection file failed lint — allowlist broken.');
  console.error(err.stdout?.toString());
  failed = true;
}

process.exit(failed ? 1 : 0);
