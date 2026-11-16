// Leases are server records with a unique resource key. No browser storage
// value is treated as proof that this session owns a record.
export function createRecordEditLocks({ execute, token, holder = () => "Widget user" }) {
  const leases = new Map(), writes = new Set(), pendingReleases = new Set();
  const key = (module, id) => module + ":" + String(id);
  const call = async (action, lease) => {
    try {
    const response = await execute({ action, moduleApiName: lease.module, recordId: lease.id, leaseToken: lease.token, holderLabel: holder(), leaseId: lease.leaseId || "" });
    let result = response?.details?.output ?? response?.output ?? response;
    if (typeof result === "string") result = JSON.parse(result);
    if (!result || result.success !== true || (action !== "release" && !result.lease_id)) {
      const error = new Error(result?.message || "The record editing lock could not be confirmed. Keep your changes and reopen the editor.");
      error.locked = result?.locked === true;
      throw error;
    }
    return result;
    } catch (error) {
      // The technical lease request may be uncertain, but no business write
      // has started when acquire/check fails.
      error.resultUncertain = false;
      error.code ||= "RECORD_EDIT_LOCK_UNCONFIRMED";
      throw error;
    }
  };
  return {
    async begin(module, id) {
      const resource = key(module, id);
      const previous = leases.get(resource);
      if (previous?.ready || previous?.pending) throw new Error("This record is already open for editing in this widget.");
      const lease = previous || { module, id: String(id), token: token(), ready: false };
      lease.pending = true;
      leases.set(resource, lease);
      try {
        const result = await call("acquire", lease);
        lease.leaseId = String(result.lease_id);
        if (leases.get(resource) !== lease) { await call("release", lease); throw new Error("The editor closed before its editing lock was ready."); }
        lease.ready = true;
        lease.pending = false;
        return lease;
      } catch (error) {
        lease.pending = false;
        if (error.locked) leases.delete(resource);
        throw error;
      }
    },
    async check(module, id) {
      const lease = leases.get(key(module, id));
      if (!lease?.ready) throw new Error("Wait for the record editing lock before saving, or reopen the editor.");
      await call("check", lease);
    },
    async release(module, id) {
      const resource = key(module, id), lease = leases.get(resource);
      if (writes.has(resource)) { pendingReleases.add(resource); throw new Error("Wait for this record's save to finish before closing its editor."); }
      if (!lease) return;
      leases.delete(resource);
      if (lease.ready) await call("release", lease);
    },
    async beginMany(resources) {
      const acquired = [];
      try {
        for (const [module, id] of [...resources].sort((a, b) => key(...a).localeCompare(key(...b)))) {
          await this.begin(module, id); acquired.push([module, id]);
        }
      } catch (error) { await Promise.allSettled(acquired.map(([module, id]) => this.release(module, id))); throw error; }
    },
    async releaseMany(resources) { await Promise.allSettled(resources.map(([module, id]) => this.release(module, id))); },
    async releaseAll() {
      await Promise.allSettled([...leases.values()].map(lease => this.release(lease.module, lease.id)));
    },
    async write(module, id, save) {
      const resource = key(module, id);
      if (writes.has(resource)) throw new Error("This record is already being saved. Wait for the current result.");
      writes.add(resource);
      const temporary = !leases.get(resource)?.ready;
      try {
        if (temporary) await this.begin(module, id);
        await this.check(module, id);
        return await save();
      } finally {
        writes.delete(resource);
        const shouldRelease = temporary || pendingReleases.has(resource);
        pendingReleases.delete(resource);
        if (shouldRelease && leases.get(resource)?.ready) { try { await this.release(module, id); } catch (_) { /* Fixed expiry recovers an unconfirmed release. */ } }
      }
    }
  };
}

export const recordEditLocks = createRecordEditLocks({
  execute: args => window.ZOHO.CRM.FUNCTIONS.execute("widget_recordlease", { arguments: JSON.stringify(args) }),
  token: () => {
    if (!globalThis.crypto?.randomUUID) throw new Error("Secure editing locks are unavailable. Reload the widget in a supported browser.");
    return globalThis.crypto.randomUUID();
  }
});
