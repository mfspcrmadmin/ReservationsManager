// Transport for the agency widget. This module does not mount UI or write CRM directly.
const CHANGE_KEYS = ["action", "consortiaId", "historyId", "validFrom", "validTo", "observedOn", "reason", "startUnknownConfirmed"];
const WRITES = new Set(["apply", "sync", "reconcile"]);
const rejectedConsortiaResult = value => value.error === true || String(value.status).toLowerCase() === "error" ||
  value.code != null && String(value.code).toUpperCase() !== "SUCCESS";

function consortiaError(message, operation, uncertain = false, result) {
  return Object.assign(new Error(message), { operation, uncertain, result });
}

function unwrapConsortiaResult(value) {
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { throw new Error("CRM returned an unreadable consortia result."); }
      continue;
    }
    if (!value || typeof value !== "object") break;
    if (value.details?.output !== undefined) {
      if (value.error === true || value.success === false || String(value.status).toLowerCase() === "error" ||
          value.code && String(value.code).toUpperCase() !== "SUCCESS") {
        throw new Error(value.message || "CRM rejected the consortia request.");
      }
      value = value.details.output;
      continue;
    }
    return value;
  }
  throw new Error("CRM did not return a consortia result.");
}

export function createClientConsortiaApi({ execute, requestId = () => globalThis.crypto.randomUUID() } = {}) {
  const reviews = new WeakMap(), unresolved = new Map(), busy = new Set();
  const clientId = value => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("A CRM client ID string is required.");
    return value;
  };
  const changeInput = input => {
    if (!input || !["add", "end", "correct"].includes(input.action)) throw new Error("Choose add, end or correct.");
    if (Object.keys(input).some(key => key.toLowerCase() === "crmapirequest")) throw new Error("Zoho supplies the authenticated identity.");
    return Object.fromEntries(CHANGE_KEYS.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  };
  const send = async request => {
    if (typeof execute !== "function") throw new Error("The authenticated CRM function API is unavailable.");
    return unwrapConsortiaResult(await execute("widget_recordlease", {
      arguments: JSON.stringify({ action: "widget_operation", requestBody: JSON.stringify({
        operation: "client_consortia_manage", requestBody: JSON.stringify(request)
      }) })
    }));
  };
  const mutation = async request => {
    const id = clientId(request.clientId);
    if (!WRITES.has(request.action)) throw new Error("Invalid consortia mutation.");
    if (busy.has(id)) throw new Error("A consortia operation is already in progress for this client.");
    if (unresolved.has(id) && request.action !== "reconcile") {
      throw consortiaError("Check the unresolved operation before another change.", unresolved.get(id), true);
    }
    const operation = Object.freeze({ clientId: id, requestId: request.requestId });
    if (!/^[a-f0-9-]{36}$/i.test(operation.requestId || "")) throw new Error("A UUID request ID is required.");
    busy.add(id);
    unresolved.set(id, operation);
    let result;
    try {
      try { result = await send(request); }
      catch (_) { throw consortiaError("The result is unknown. Check operation status before repeating the change.", operation, true); }
      if (result.client_id !== undefined && String(result.client_id) !== id ||
          result.request_id !== undefined && result.request_id !== operation.requestId) {
        throw consortiaError("CRM returned a different consortia operation. Check its status.", operation, true, result);
      }
      if (result.success === true && !rejectedConsortiaResult(result) && result.saved === true && result.phase === "complete" &&
          String(result.client_id) === id && result.request_id === operation.requestId && /^\d+$/.test(String(result.operation_id || ""))) {
        unresolved.delete(id);
        return result;
      }
      const knownRejection = result.success === false && result.saved === false && result.uncertain === false;
      if (knownRejection) unresolved.delete(id);
      throw consortiaError(result.message || "CRM did not confirm the consortia operation.", operation, !knownRejection, result);
    } finally { busy.delete(id); }
  };
  return {
    async read(id) {
      const result = await send({ action: "preview", clientId: clientId(id) });
      if (result.success !== true || rejectedConsortiaResult(result) || String(result.client_id) !== id || !result.revision) {
        throw new Error(result.message || "The consortia state could not be read.");
      }
      return result;
    },
    async preview(id, input) {
      const change = changeInput(input);
      const result = await send({ action: "preview", clientId: clientId(id), change });
      if (result.success !== true || rejectedConsortiaResult(result) || String(result.client_id) !== id || !result.review_token || !result.candidate) {
        throw new Error(result.message || "The consortia change could not be previewed.");
      }
      // Retain an independent copy so editing the returned preview cannot alter the confirmed request.
      reviews.set(result, { clientId: id, change: JSON.parse(JSON.stringify(change)), reviewToken: result.review_token });
      return result;
    },
    async apply(review, { confirmed = false } = {}) {
      const request = reviews.get(review);
      if (!request || confirmed !== true) throw new Error("Preview the change and explicitly confirm it before saving.");
      // A reviewed change gets exactly one mutation attempt, including transport failures.
      reviews.delete(review);
      return mutation({ action: "apply", ...request, requestId: requestId(), confirmed: true });
    },
    async synchronize(id) {
      return mutation({ action: "sync", clientId: clientId(id), requestId: requestId() });
    },
    async status(operation) {
      const id = clientId(operation?.clientId);
      if (!/^[a-f0-9-]{36}$/i.test(operation?.requestId || "")) throw new Error("A recorded request ID is required.");
      const result = await send({ action: "status", clientId: id, requestId: operation.requestId });
      if (String(result.client_id) !== id || result.request_id !== operation.requestId) {
        throw consortiaError(result.message || "CRM did not identify this operation.", operation, true, result);
      }
      const identified = /^\d+$/.test(String(result.operation_id || "")) && Boolean(result.operation_version);
      if (identified && (result.phase === "complete" && result.success === true && result.saved === true && !rejectedConsortiaResult(result) ||
          result.phase === "rejected" && result.success === false && result.saved === false && result.uncertain === false)) {
        unresolved.delete(id);
      } else unresolved.set(id, Object.freeze({ clientId: id, requestId: operation.requestId }));
      return result;
    },
    async reconcile(operation, status) {
      const id = clientId(operation?.clientId);
      if (String(status?.client_id) !== id || status?.request_id !== operation.requestId || !status.operation_version) {
        throw new Error("Read this operation's current status before reconciling.");
      }
      return mutation({ action: "reconcile", clientId: id, requestId: operation.requestId, expectedOperationVersion: status.operation_version });
    },
    pending(id) { return unresolved.get(clientId(id)) || null; }
  };
}

export function clientConsortiaApi(crm = globalThis.ZOHO?.CRM) {
  return createClientConsortiaApi({ execute: crm?.FUNCTIONS?.execute?.bind(crm.FUNCTIONS) });
}
