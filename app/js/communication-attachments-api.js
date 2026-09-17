const ATTACHMENTS_CONNECTION = "crm_oauth_connection";
export const ATTACHMENTS_TRANSPORT = "crm-v8-connection-20260910";
let attachmentTraceSequence = 0;

export function createAttachmentTrace() {
  const started = Date.now();
  const traceId = started.toString(36) + "-" + (++attachmentTraceSequence);
  return function (event, details = {}) {
    // Serialize immediately so copied console output includes the actual values.
    // Call sites supply metadata only, never raw records, files or credentials.
    console.info("[Communication attachments] " + JSON.stringify({
      revision: "attachments-readback-20260910-2", transport: ATTACHMENTS_TRANSPORT,
      traceId, elapsedMs: Date.now() - started, event, ...details
    }));
  };
}

export function attachmentResponseSummary(value) {
  const details = value && value.details;
  return {
    type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    keys: value && typeof value === "object" ? Object.keys(value) : [],
    code: value && value.code, status: value && value.status,
    detailKeys: details && typeof details === "object" ? Object.keys(details) : [],
    field: details && details.api_name,
    expectedType: details && details.expected_data_type,
    jsonPath: details && details.json_path,
    hasId: Boolean(value && value.id || details && details.id),
    rows: value && Array.isArray(value.data) ? value.data.length : null
  };
}

function parseConnectionJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); }
  catch (_) { throw new Error("CRM v8 returned an unreadable attachment response."); }
}

function connectionError(result) {
  const code = result && result.code || "UNKNOWN_RESPONSE";
  const field = result && result.details && result.details.api_name;
  const error = new Error("Attachment request failed through " + ATTACHMENTS_CONNECTION + " (CRM v8): " +
    code + (field ? " [" + field + "]" : "") + ". " +
    (result && result.message || "Check that the connection is available to this widget and has read/update access to Communications."));
  error.code = code;
  return error;
}

export async function requestCommunicationAttachmentsV8(communicationId, changes, trace = createAttachmentTrace()) {
  const method = changes === undefined ? "GET" : "PUT";
  trace("request-start", { method, endpoint: "/crm/v8/Communications/{id}", connection: ATTACHMENTS_CONNECTION,
    hasRecordId: Boolean(communicationId), field: "Email_Attachments",
    changeKeys: changes && changes.map(change => Object.keys(change)),
    additions: changes && changes.filter(change => change.File_Id__s).length,
    removals: changes && changes.filter(change => Object.prototype.hasOwnProperty.call(change, "_delete")).length });
  try {
    const connection = window.ZOHO && window.ZOHO.CRM && window.ZOHO.CRM.CONNECTION;
    if (!connection || typeof connection.invoke !== "function") {
      throw new Error("The CRM connection API is unavailable. Reload the widget before editing attachments.");
    }
    const request = {
      url: "https://www.zohoapis.eu/crm/v8/Communications/" + encodeURIComponent(communicationId),
      method: changes === undefined ? "GET" : "PUT",
      headers: { "Content-Type": "application/json" },
      // The embedded SDK serializes parameters itself. Do not stringify twice.
      param_type: changes === undefined ? 1 : 2,
      parameters: changes === undefined ? { fields: "Email_Attachments,Communication_Status" } : {
        data: [{ id: String(communicationId), Email_Attachments: changes }],
        trigger: ["workflow"]
      }
    };
    trace("request-config", { method, paramType: request.param_type, parameterKeys: Object.keys(request.parameters),
      trigger: request.parameters.trigger, contentType: request.headers["Content-Type"] });
    const envelope = parseConnectionJson(await connection.invoke(ATTACHMENTS_CONNECTION, request));
    trace("connection-response", { method, ...attachmentResponseSummary(envelope) });
    if (!envelope || String(envelope.status || "").toLowerCase() === "error" ||
        (envelope.code && String(envelope.code).toUpperCase() !== "SUCCESS")) throw connectionError(envelope);
    const details = envelope.details;
    const body = parseConnectionJson(details && (details.statusMessage ?? details.response) || envelope);
    const httpStatus = Number(details && (details.statusCode ?? details.CODE));
    trace("crm-response", { method, httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
      bodySource: details && details.statusMessage != null ? "details.statusMessage" : details && details.response != null ? "details.response" : "envelope",
      ...attachmentResponseSummary(body) });
    if (httpStatus >= 400) throw connectionError(body);
    if (!body || !Array.isArray(body.data) || !body.data.length) throw connectionError(body);
    const result = body.data[0];
    trace("crm-result", { method, ...attachmentResponseSummary(result),
      fieldPresent: Object.prototype.hasOwnProperty.call(result, "Email_Attachments"),
      fieldType: result.Email_Attachments === null ? "null" : Array.isArray(result.Email_Attachments) ? "array" : typeof result.Email_Attachments,
      fileCount: Array.isArray(result.Email_Attachments) ? result.Email_Attachments.length : null });
    if (String(result.status || "").toLowerCase() === "error" ||
        (changes !== undefined && String(result.code || "").toUpperCase() !== "SUCCESS")) throw connectionError(result);
    return result;
  } catch (error) {
    trace("request-failed", { method, errorType: error && error.name, code: error && error.code });
    throw error;
  }
}
