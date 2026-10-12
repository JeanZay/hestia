// Pure, opt-in diagnostic for a reviewed synthetic operator. No I/O or model call.
// Production callbacks remain the authority; only closed codes and counts escape.
const MAX_BYTES = 16_384;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const counts = value => ({ existing: value.existing.length, created: value.created.length });
const parse = text => {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) return null;
  try { const value = JSON.parse(text); return object(value) ? value : null; } catch { return null; }
};
const lists = (value, existing, created) => object(value) && Array.isArray(value[existing])
  && Array.isArray(value[created]) && value[existing].length + value[created].length <= 8;
const relevance = rows => {
  const result = { relevant: 0, irrelevant: 0, uncertain: 0, invalid: 0 };
  for (const row of rows) {
    const key = object(row) && ['relevant', 'irrelevant', 'uncertain'].includes(row.relevance) ? row.relevance : 'invalid';
    result[key]++;
  }
  return result;
};

/**
 * rawText is the single assistant completion observed in memory by the operator.
 * providerValue is the actual adapter output, not a reconstructed substitute.
 * normalize and validate MUST be the exact reviewed production functions.
 * The caller owns transport bounds, one-shot dispatch, consent and cost settlement.
 * Neither callback errors nor source values are returned or logged.
 */
export function diagnoseClassification({ rawText, providerValue, folders, canCreateRoot, normalize, validate }) {
  if (!Array.isArray(folders) || folders.length > 10_000 || typeof canCreateRoot !== 'boolean'
    || typeof normalize !== 'function' || typeof validate !== 'function') throw new Error('DIAGNOSTIC_INPUT_INVALID');
  const report = {
    schemaVersion: 1,
    provider: { status: 'unavailable', counts: null, createdRelevance: null },
    normalization: { status: 'not-run', counts: null, createdRemoved: null, matchesAdapter: null },
    validation: { status: 'not-run', counts: null, createdRemoved: null, excludedParents: null },
    conclusion: 'unresolved',
  };
  const raw = parse(rawText);
  if (lists(raw, 'existingFolderSuggestions', 'newFolderPathSuggestions')) {
    report.provider = {
      status: 'observed',
      counts: { existing: raw.existingFolderSuggestions.length, created: raw.newFolderPathSuggestions.length },
      createdRelevance: relevance(raw.newFolderPathSuggestions),
    };
  }
  let normalized;
  try { normalized = normalize(rawText, 'existingFolderSuggestions', 'newFolderPathSuggestions'); }
  catch { report.normalization.status = 'callback-failed'; return report; }
  report.normalization.matchesAdapter = normalized === providerValue;
  if (!report.normalization.matchesAdapter) {
    report.normalization.status = 'adapter-mismatch';
    report.conclusion = 'observation-mismatch';
    return report;
  }
  const value = parse(normalized);
  if (!lists(value, 'existing', 'created')) {
    report.normalization.status = 'rejected';
    report.conclusion = 'provider-output-rejected';
    return report;
  }
  report.normalization.status = 'accepted';
  report.normalization.counts = counts(value);
  if (report.provider.counts) report.normalization.createdRemoved = report.provider.counts.created - value.created.length;
  let validated;
  try { validated = validate(providerValue, folders, MAX_BYTES, 8, canCreateRoot); }
  catch {
    report.validation.status = 'rejected';
    report.conclusion = 'validation-rejected';
    return report;
  }
  if (!lists(validated, 'existing', 'created')) {
    report.validation.status = 'unexpected-result';
    report.conclusion = 'observation-mismatch';
    return report;
  }
  report.validation.status = 'accepted';
  report.validation.counts = counts(validated);
  report.validation.createdRemoved = value.created.length - validated.created.length;
  const allowed = new Map(folders.map(folder => [folder.id, folder]));
  const excludedParents = { unknownParent: 0, parentCannotCreate: 0, rootCannotCreate: 0 };
  for (const item of value.created) {
    if (item.parentId === null) {
      if (!canCreateRoot) excludedParents.rootCannotCreate++;
    } else if (!allowed.has(item.parentId)) excludedParents.unknownParent++;
    else if (!allowed.get(item.parentId).canCreate) excludedParents.parentCannotCreate++;
  }
  report.validation.excludedParents = excludedParents;
  const removed = Object.values(excludedParents).reduce((sum, count) => sum + count, 0);
  if (!report.provider.counts || removed !== report.validation.createdRemoved
    || report.normalization.createdRemoved < 0 || report.validation.createdRemoved < 0
    || report.normalization.counts.created !== report.provider.createdRelevance.relevant) {
    report.conclusion = 'observation-mismatch';
  } else if (validated.created.length > 0) report.conclusion = 'created-suggestions-survived';
  else if (report.provider.counts.created === 0) report.conclusion = 'provider-returned-no-created';
  else if (value.created.length === 0) report.conclusion = 'all-created-removed-by-relevance';
  else if (report.normalization.createdRemoved > 0) report.conclusion = 'all-created-removed-by-multiple-filters';
  else report.conclusion = 'all-created-removed-by-parent-rights';
  return report;
}
