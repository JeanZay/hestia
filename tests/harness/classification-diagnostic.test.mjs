import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { diagnoseClassification } from '../../scripts/lib/classification-diagnostic.mjs';

// Execute the real TypeScript normalizer and validator; no provider or network.
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map();
const permitted = ['src/server/classification/reference-tree.ts', 'src/server/classification/validation.ts', 'src/shared/capture-path.ts', 'src/server/access.ts'];
function load(file) {
  assert.ok(permitted.includes(file));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const resolve = name => {
    if (['node:crypto', 'node:async_hooks'].includes(name)) return require(name);
    assert.ok(name.startsWith('.'));
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), `${name}.ts`)));
  };
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
const normalize = load(permitted[0]).normalizeClassificationSuggestions;
const validate = load(permitted[1]).parseClassificationResult;
const parent = '11111111-1111-4111-8111-111111111111';
const unknown = '22222222-2222-4222-8222-222222222222';
const folders = [{ id: parent, name: 'PRIVATE_FOLDER_SENTINEL', path: [], canCreate: true }];
const row = (changes = {}) => ({ parentId: parent, levels: ['PRIVATE_NAME_SENTINEL'], reason: 'PRIVATE_REASON_SENTINEL', relevance: 'relevant', ...changes });
const encode = created => JSON.stringify({ existingFolderSuggestions: [{ folderId: parent, reason: 'PRIVATE_EXISTING_SENTINEL', relevance: 'relevant' }], newFolderPathSuggestions: created });
function run(created, changes = {}) {
  const rawText = encode(created);
  return diagnoseClassification({ rawText, providerValue: normalize(rawText, 'existingFolderSuggestions', 'newFolderPathSuggestions'), folders, canCreateRoot: true, normalize, validate, ...changes });
}
test('distinguishes provider abstention from successful creation candidates', () => {
  assert.equal(run([]).conclusion, 'provider-returned-no-created');
  const report = run([row()]);
  assert.equal(report.conclusion, 'created-suggestions-survived');
  assert.deepEqual(report.validation.counts, { existing: 1, created: 1 });
});
test('observes relevance removal using production normalization', () => {
  const report = run([row({ relevance: 'irrelevant' }), row({ relevance: 'uncertain' })]);
  assert.equal(report.conclusion, 'all-created-removed-by-relevance');
  assert.equal(report.normalization.createdRemoved, 2);
  assert.deepEqual(report.provider.createdRelevance, { relevant: 0, irrelevant: 1, uncertain: 1, invalid: 0 });
});
test('distinguishes unknown parent, forbidden parent and forbidden root', () => {
  const report = run([row({ parentId: unknown }), row(), row({ parentId: null })], { folders: [{ ...folders[0], canCreate: false }], canCreateRoot: false });
  assert.equal(report.conclusion, 'all-created-removed-by-parent-rights');
  assert.deepEqual(report.validation.excludedParents, { unknownParent: 1, parentCannotCreate: 1, rootCannotCreate: 1 });
  assert.equal(report.validation.counts.existing, 1);
});
test('reports mixed filters without attributing everything to the model', () => {
  const report = run([row({ relevance: 'uncertain' }), row({ parentId: unknown })]);
  assert.equal(report.conclusion, 'all-created-removed-by-multiple-filters');
  assert.equal(report.normalization.createdRemoved, 1);
  assert.equal(report.validation.createdRemoved, 1);
});
test('valid private root survives with permission and valid name', () => {
  assert.equal(run([row({ parentId: null })]).conclusion, 'created-suggestions-survived');
});
test('malformed relevance is a rejected response, not an empty proposal list', () => {
  const report = run([row({ relevance: 'PRIVATE_INVALID_SENTINEL' })]);
  assert.equal(report.conclusion, 'provider-output-rejected');
  assert.equal(report.provider.createdRelevance.invalid, 1);
});
test('invalid path is validation failure, not rights filtering', () => {
  const report = run([row({ levels: ['[équipement]'] })]);
  assert.equal(report.conclusion, 'validation-rejected');
  assert.equal(report.validation.excludedParents, null);
});
test('does not infer filtering from a mismatched adapter observation', () => {
  assert.equal(run([row()], { providerValue: '{"existing":[],"created":[]}' }).conclusion, 'observation-mismatch');
});
test('sensitive values and callback exception messages never enter the report', () => {
  const reports = [run([row()]), run([row({ parentId: unknown })]), run([row({ relevance: 'PRIVATE_SENTINEL' })]), run([row()], { validate: () => { throw new Error('SECRET_CALLBACK_SENTINEL'); } })];
  for (const report of reports) {
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /SENTINEL|11111111|22222222/);
  }
});
test('rejects oversized and malformed completion without copying its contents', () => {
  for (const rawText of ['PRIVATE_SENTINEL', 'x'.repeat(16_385)]) {
    const report = run([], { rawText, providerValue: null });
    assert.equal(report.conclusion, 'provider-output-rejected');
    assert.equal(report.provider.counts, null);
  }
});
test('observing does not mutate the provider value or allowed folders', () => {
  const before = JSON.stringify(folders), rawText = encode([row()]);
  const providerValue = normalize(rawText, 'existingFolderSuggestions', 'newFolderPathSuggestions');
  const expected = validate(providerValue, folders, 16_384, 8, true);
  diagnoseClassification({ rawText, providerValue, folders, canCreateRoot: true, normalize, validate });
  assert.equal(JSON.stringify(folders), before);
  assert.deepEqual(validate(providerValue, folders, 16_384, 8, true), expected);
});
