// Each send must finish before the next starts. Never retry a send automatically.
export async function sendDraftBatch(drafts, { send, onSent, onProgress, isCurrent }) {
  const sentIds = [];
  for (const draft of drafts) {
    if (!isCurrent()) return { sentIds, error: new Error("Booking changed. Remaining drafts were not sent.") };
    try {
      onProgress(sentIds.length + 1, drafts.length);
      await send(draft);
      sentIds.push(draft.draftId);
      onSent(draft);
    } catch (error) {
      return { sentIds, error };
    }
  }
  return { sentIds, error: null };
}
