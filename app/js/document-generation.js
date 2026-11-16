// Each request advances one bounded server-side batch using the same generation key.
export async function generateDocumentInBatches(request, values, {isCurrent, onProgress}) {
  let previous = '', repeats = 0;
  for (let batch = 0; batch < 1000; batch++) {
    if (!isCurrent()) return null;
    const result = await request('generate', values);
    if (!isCurrent()) return null;
    if (result.version_id && !result.pending) return result;
    if (result.pending !== true || !['cleanup','records','contacts','saving'].includes(result.phase) ||
        !Number.isFinite(result.completed) || result.completed < 0 ||
        !Number.isFinite(result.total) || result.total < 0) {
      throw new Error('Generation returned an incomplete response. Reopen the document before retrying.');
    }
    const progress = result.phase + ':' + result.completed + ':' + result.total + (':' + String(result.progress_key || ''));
    repeats = progress === previous ? repeats + 1 : 0;
    if (repeats >= 3) throw new Error('Generation stopped making progress. Reopen the document before retrying.');
    previous = progress;
    const label = result.phase === 'cleanup' ? 'Cleaning incomplete generations' : result.phase === 'records' ? 'Loading booking data' : result.phase === 'contacts' ? 'Loading supplier contacts' : 'Saving generated preview';
    // These counters describe only the current server phase, never overall generation.
    onProgress({label, phase:result.phase, completed:result.completed, total:result.total});
  }
  throw new Error('Generation needs more time. Reopen the document before retrying.');
}
