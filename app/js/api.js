import { extractRecords } from "./utils.js";
import { recordEditLocks } from "./record-edit-locks.js";
import { executeNativeBlueprint } from "./blueprint-native.js";
import { executeWorkflowOperation, executeRecoverableFunction } from "./workflow-operation-api.js";

export async function crmGetRecord(entity, recordId) {
  const response = await ZOHO.CRM.API.getRecord({
    Entity: entity,
    RecordID: recordId
  });

  return extractRecords(response)[0] || null;
}

export async function crmGetAllRecords(entity, page, perPage, options) {
  const settings = options || {};
  const request = {
    Entity: entity,
    page: page || 1,
    per_page: perPage || 200
  };

  if (settings.fields) {
    request.fields = settings.fields;
  }

  if (settings.sort_by) {
    request.sort_by = settings.sort_by;
  }

  if (settings.sort_order) {
    request.sort_order = settings.sort_order;
  }

  const response = await ZOHO.CRM.API.getAllRecords(request);

  return readCrmRecords(response);
}

export async function crmGetAllUsers(type, page, perPage) {
  const response = await ZOHO.CRM.API.getAllUsers({
    Type: type || "ActiveUsers",
    page: page || 1,
    per_page: perPage || 200
  });

  if (response && Array.isArray(response.users)) {
    return response.users;
  }

  if (Array.isArray(response)) {
    return response;
  }

  return [];
}

export async function crmGetFields(entity) {
  const readers = [
    function () {
      return ZOHO.CRM && ZOHO.CRM.META && typeof ZOHO.CRM.META.getFields === "function"
        ? ZOHO.CRM.META.getFields({
            Entity: entity
          })
        : null;
    },
    function () {
      return ZOHO.CRM && ZOHO.CRM.API && typeof ZOHO.CRM.API.getFields === "function"
        ? ZOHO.CRM.API.getFields({
            Entity: entity
          })
        : null;
    }
  ];

  for (var index = 0; index < readers.length; index += 1) {
    var response = await readers[index]();

    if (Array.isArray(response)) {
      return response;
    }

    if (response && Array.isArray(response.fields)) {
      return response.fields;
    }

    if (response && Array.isArray(response.data)) {
      return response.data;
    }
  }

  return [];
}

export async function crmGetRelatedRecords(entity, recordId, relatedList, options) {
  const settings = options || {};
  const response = await ZOHO.CRM.API.getRelatedRecords({
    Entity: entity,
    RecordID: recordId,
    RelatedList: relatedList,
    page: settings.page || 1,
    per_page: settings.perPage || 200,
    user_id: settings.userId,
    type: settings.type,
    deals_mail: settings.dealsMail
  });

  return readCrmRecords(response);
}

export async function crmSearchRecord(entity, criteria, page, perPage) {
  const response = await ZOHO.CRM.API.searchRecord({
    Entity: entity,
    Type: "criteria",
    Query: criteria,
    page: page || 1,
    per_page: perPage || 200
  }, page || 1, perPage || 200);

  return readCrmRecords(response);
}

export async function crmSearchWord(entity, word) {
  const response = await ZOHO.CRM.API.searchRecord({
    Entity: entity,
    Type: "word",
    Query: word
  }, 1, 50);

  return readCrmRecords(response);
}

export async function crmUpdateRecord(entity, payload, options = {}) {
  return recordEditLocks.write(entity, payload.id, async () => {
    const expected = options.expectedRecord;
    if (expected) {
      const rejectVersion = message => { const error = new Error(message); error.code = "CRM_VERSION_CONFLICT"; error.resultUncertain = false; throw error; };
      if (!expected.Modified_Time) rejectVersion("The record version is missing. Keep your changes, refresh and review before saving.");
      const fresh = await crmGetRecord(entity, payload.id);
      if (!fresh || String(fresh.id) !== String(payload.id) || fresh.Modified_Time !== expected.Modified_Time) {
        rejectVersion("This record changed in another session. Keep your changes, refresh and review before saving.");
      }
    }
    let response;
    try {
      response = await ZOHO.CRM.API.updateRecord({ Entity: entity, APIData: payload, Trigger: ["workflow"] });
    } catch (cause) {
      throw crmWriteError(cause, entity, "update");
    }
    const confirmed = confirmCrmWrite(response, entity, "update", payload?.id);
    if (expected) expected.Modified_Time = confirmed.details?.Modified_Time || "";
    return confirmed;
  });
}

function unwrapCrmWrite(value) {
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { return value; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    // An explicit envelope error overrides any nested success.
    if (String(value.status || "").toLowerCase() === "error" ||
        (value.code && String(value.code).toUpperCase() !== "SUCCESS")) return value;
    const nested = value.responseJSON ?? value.responseText ?? value.response ?? value.body ?? value.data ?? value.records;
    if (nested == null) return value;
    value = nested;
  }
  return null;
}

function crmWriteError(source, entity, action) {
  let result = unwrapCrmWrite(source);
  if (Array.isArray(result)) result = result.find(item => String(item?.status).toLowerCase() === "error" || (item?.code && String(item.code).toUpperCase() !== "SUCCESS")) || result[0];
  const explicit = result && typeof result === "object" && String(result.status || "").toLowerCase() === "error";
  const error = new Error(explicit ? formatCrmCreateError(result, entity, action) : entity + ": CRM did not confirm the " + action + ". Check CRM before trying again.");
  error.code = explicit ? result.code || "CRM_WRITE_REJECTED" : "CRM_WRITE_UNCONFIRMED";
  error.details = explicit ? result.details || {} : {};
  error.resultUncertain = !explicit;
  error.cause = source;
  return error;
}

function confirmCrmWrite(response, entity, action, expectedId) {
  const value = unwrapCrmWrite(response);
  const results = Array.isArray(value) ? value : [value];
  // These adapters write one record. Do not hide extra or mixed results.
  if (results.length !== 1) throw crmWriteError(response, entity, action);
  const result = results[0];
  const id = result?.details?.id || result?.id;
  if (!result || String(result.code || "").toUpperCase() !== "SUCCESS" ||
      (result.status != null && String(result.status).toLowerCase() !== "success") ||
      !id || (expectedId != null && String(id) !== String(expectedId))) {
    throw crmWriteError(response, entity, action);
  }
  return result;
}

export function formatCrmCreateError(error, entity, action = "create") {
  let source = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof source === "string") {
      try { source = JSON.parse(source); } catch (_) { break; }
    }
    if (!source || typeof source !== "object") break;
    const nested = source.responseJSON || source.responseText || source.response || source.body || source.data;
    if (Array.isArray(source)) { source = source[0]; continue; }
    if (nested) { source = nested; continue; }
    break;
  }
  const message = source?.message || (typeof source === "string" ? source : "") || error?.message || "CRM could not " + action + " the record.";
  const code = source?.code ? " [" + source.code + "]" : "";
  const details = source?.details;
  const field = details?.api_name || details?.field?.api_name;
  const expected = details?.expected_data_type;
  return entity + ": " + message + code + (field ? " Field: " + field + "." : "") + (expected ? " Expected type: " + expected + "." : "");
}

export async function crmCreateRecord(entity, payload) {
  let response;
  try {
    response = await ZOHO.CRM.API.insertRecord({ Entity: entity, APIData: payload, Trigger: ["workflow"] });
  } catch (error) {
    throw crmWriteError(error, entity, "create");
  }
  return confirmCrmWrite(response, entity, "create");
}

export async function crmExecuteFunction(functionName, args) {
  // Zoho supplies this reserved identity context. Never serialize a caller's
  // replacement into the request, including case variants of the reserved key.
  if (Object.keys(args || {}).some(key => key.toLowerCase() === "crmapirequest")) {
    throw new Error("The authenticated CRM context must be supplied by Zoho. Reload the widget.");
  }
  const privateOperations = ["comm_reconcilecommunicationdelivery", "servicepax_manage", "widget_workflowrecovery"];
  const execute = () => functionName === "widget_workflowrecovery"
    ? executeWorkflowOperation(ZOHO.CRM, JSON.parse(args?.requestBody || "{}"))
    : ["syncprojectfromezus", "sync_runprojectfromezus"].includes(functionName)
      ? executeRecoverableFunction(ZOHO.CRM, functionName, args)
      : ZOHO.CRM.FUNCTIONS.execute(privateOperations.includes(functionName) ? "widget_recordlease" : functionName, {
    arguments: JSON.stringify(privateOperations.includes(functionName)
      ? { action: "widget_operation", requestBody: JSON.stringify({ ...(args || {}), operation: functionName }) }
      : args || {})
  });
  const guarded = ["comm_updatecommunicationdraft", "comm_updatecommunicationservices", "comm_regeneratedraftforcommunication", "comm_deletecommunication", "comm_sendcommunicationdraft", "comm_reconcilecommunicationdelivery"];
  if (guarded.includes(functionName) && args?.communicationId) return recordEditLocks.write("Communications", String(args.communicationId), execute);
  if (functionName === "widget_workflowrecovery") {
    const request = JSON.parse(args?.requestBody || "{}");
    if (["resume", "prepare_start", "assignment_start", "review", "stop"].includes(request.action) && request.bookingId) return recordEditLocks.write("Deals", String(request.bookingId), execute);
  }
  if (functionName === "blueprint_executetransition") {
    if (!args?.moduleApiName || !args?.recordId) throw new Error("The workflow target is missing. Reload the booking before continuing.");
    return recordEditLocks.write(args.moduleApiName, String(args.recordId), () => executeNativeBlueprint(args));
  }
  const bookingFunctions = ["createprojectinezuswithprefix", "createprojectinezus_1", "syncprojectfromezus", "sync_runprojectfromezus", "sendfullbookingtoaxus"];
  if (bookingFunctions.includes(functionName) && args?.bookingId) return recordEditLocks.write("Deals", String(args.bookingId), execute);
  return execute();
}

function readCrmRecords(response) {
  let value = response;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { break; }
    }
    if (!value || typeof value !== "object") break;
    if (String(value.status || "").toLowerCase() === "error" ||
        (value.code && !["SUCCESS", "NO_CONTENT"].includes(String(value.code).toUpperCase()))) {
      const error = new Error(value.message || String(value.code) || "CRM could not complete the search.");
      error.code = value.code || "CRM_READ_FAILED";
      error.details = value.details || {};
      throw error;
    }
    const httpStatus = Number(value.statusCode ?? value.responseCode ?? value.status);
    if (httpStatus >= 400) {
      const error = new Error(value.message || "CRM search failed (HTTP " + httpStatus + ").");
      error.code = "HTTP_" + httpStatus;
      throw error;
    }
    const records = Array.isArray(value) ? value : Array.isArray(value.data) ? value.data : Array.isArray(value.records) ? value.records : null;
    if (records) {
      const failure = records.find(row => row && String(row.status).toLowerCase() === "error" && row.code);
      if (failure) { const error = new Error(failure.message || failure.code); error.code = failure.code; error.details = failure.details || {}; throw error; }
      return records;
    }
    if (httpStatus === 204 || String(value.code).toUpperCase() === "NO_CONTENT") return [];
    const nested = value.responseJSON ?? value.responseText ?? value.response ?? value.body;
    if (nested == null) break;
    value = nested;
  }
  const error = new Error("CRM did not return a valid search result. Try again; no empty result was confirmed.");
  error.code = "CRM_READ_UNCONFIRMED";
  throw error;
}
