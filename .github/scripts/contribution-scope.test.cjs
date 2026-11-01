const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { isSchemaSupportingFile } = require('./contribution-scope.cjs');

test('allows the registered schema audit and regression suite beside affected contributions', () => {
  for (const path of ['.github/workflows/data-api-permissions.yml', 'docs/data-api-permissions-audit.md',
    'scripts/audit-data-api-permissions.sql', 'scripts/test-data-api-permissions.mjs']) {
    assert.equal(isSchemaSupportingFile(path, ['extensions/job-hunt']), true);
    assert.equal(isSchemaSupportingFile(path, ['schemas/readwise-books']), true);
  }
});

test('rejects unrelated contributions, empty scopes, arbitrary scripts and workflows', () => {
  assert.equal(isSchemaSupportingFile('scripts/test-data-api-permissions.mjs', ['recipes/other']), false);
  assert.equal(isSchemaSupportingFile('scripts/test-data-api-permissions.mjs', []), false);
  for (const path of ['scripts/deploy.mjs', '.github/workflows/ob1-gate-v2.yml',
    'docs/unrelated.md', 'scripts/../scripts/test-data-api-permissions.mjs',
    'scripts/test-data-api-permissions.mjs/extra']) {
    assert.equal(isSchemaSupportingFile(path, ['extensions/job-hunt']), false);
  }
});

test('CLI returns a nonzero exit for rejected paths and handles multiline directory input', () => {
  const helper = require.resolve('./contribution-scope.cjs');
  const run = (file, dirs) => spawnSync(process.execPath, [helper, file, dirs]).status;
  assert.equal(run('scripts/test-data-api-permissions.mjs', 'recipes/other\nextensions/job-hunt'), 0);
  assert.equal(run('scripts/arbitrary.mjs', 'extensions/job-hunt'), 1);
  assert.equal(run('scripts/test-data-api-permissions.mjs', ''), 1);
});
