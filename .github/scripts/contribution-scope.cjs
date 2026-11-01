// Supporting files owned by the Data API schema regression suite.
// This does not skip any contribution, credential, SQL, or dependency checks.
const supportingFiles = new Set([
  '.github/workflows/data-api-permissions.yml',
  'docs/data-api-permissions-audit.md',
  'scripts/audit-data-api-permissions.sql',
  'scripts/test-data-api-permissions.mjs',
]);
const schemaDirectories = new Set([
  'extensions/family-calendar',
  'extensions/home-maintenance',
  'extensions/household-knowledge',
  'extensions/job-hunt',
  'extensions/meal-planning',
  'extensions/professional-crm',
  'schemas/readwise-books',
  'recipes/adaptive-capture-classification',
]);

function isSchemaSupportingFile(file, contributionDirectories) {
  return supportingFiles.has(file) && contributionDirectories.some(dir => schemaDirectories.has(dir));
}

module.exports = { isSchemaSupportingFile };

if (require.main === module) {
  process.exit(isSchemaSupportingFile(process.argv[2], (process.argv[3] || '').split('\n')) ? 0 : 1);
}
