import { extractRecords } from "./utils.js";

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

  throwIfApiError(response);
  return extractRecords(response);
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

  throwIfApiError(response);

  return extractRecords(response);
}

export async function crmSearchRecord(entity, criteria, page, perPage) {
  const response = await ZOHO.CRM.API.searchRecord({
    Entity: entity,
    Type: "criteria",
    Query: criteria,
    page: page || 1,
    per_page: perPage || 200
  }, page || 1, perPage || 200);

  throwIfApiError(response);
  return extractRecords(response);
}

export async function crmSearchWord(entity, word) {
  const response = await ZOHO.CRM.API.searchRecord({
    Entity: entity,
    Type: "word",
    Query: word
  }, 1, 50);

  return extractRecords(response);
}

export async function crmUpdateRecord(entity, payload) {
  const response = await ZOHO.CRM.API.updateRecord({
    Entity: entity,
    APIData: payload,
    Trigger: ["workflow"]
  });

  return extractRecords(response)[0] || {};
}

export function formatCrmCreateError(error, entity) {
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
  const message = source?.message || (typeof source === "string" ? source : "") || error?.message || "CRM could not create the record.";
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
    throw new Error(formatCrmCreateError(error, entity));
  }
  const result = extractRecords(response)[0] || response || {};
  if (String(result.status || "").toLowerCase() === "error" || String(result.code || "").toUpperCase() !== "SUCCESS") {
    throw new Error(formatCrmCreateError(result, entity));
  }
  return result;
}

export async function crmExecuteFunction(functionName, args) {
  return ZOHO.CRM.FUNCTIONS.execute(functionName, {
    arguments: JSON.stringify(args || {})
  });
}

function throwIfApiError(response) {
  if (!response || Array.isArray(response.data)) {
    return;
  }

  const status = response.status ? String(response.status).toLowerCase() : "";
  const hasErrorCode = Boolean(response.code) && status === "error";

  if (hasErrorCode) {
    const error = new Error(response.message || response.code);
    error.code = response.code;
    error.details = response.details || {};
    throw error;
  }
}
