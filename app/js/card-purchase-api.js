import { recordEditLocks } from "./record-edit-locks.js";
import { MODULES } from "./constants.js";
import { invokeWidgetRecordRequest } from "./widget-record-request.js";

// File upload fields require the v8 record API, not the SDK's legacy updateRecord.
export async function requestCardPurchaseV8(recordId, payload, modifiedTime) {
  const request = () => requestCardPurchaseV8Raw(recordId, payload, modifiedTime);
  return payload ? recordEditLocks.write(MODULES.cardPurchases, recordId, request) : request();
}

async function requestCardPurchaseV8Raw(recordId, payload, modifiedTime) {
  const parse = value => typeof value === "string" ? JSON.parse(value) : value;
  const fail = result => {
    const error = new Error(result?.message || result?.code || "CRM could not confirm the card transaction request.");
    error.code = result?.code;
    error.definitiveRejection = ["INVALID_DATA", "NO_PERMISSION", "OAUTH_SCOPE_MISMATCH", "RECORD_LOCKED", "MANDATORY_NOT_FOUND", "INVALID_TOKEN", "AUTHORIZATION_FAILED"].includes(result?.code);
    throw error;
  };
  const headers = { "Content-Type": "application/json" };
  if (payload && modifiedTime) headers["If-Unmodified-Since"] = modifiedTime;
  const envelope = parse(await invokeWidgetRecordRequest(MODULES.cardPurchases, recordId, {
    url: "https://www.zohoapis.eu/crm/v8/" + MODULES.cardPurchases + "/" + encodeURIComponent(recordId),
    method: payload ? "PUT" : "GET", headers, param_type: payload ? 2 : 1,
    parameters: payload ? { data: [payload], trigger: ["workflow"] } : {}
  }));
  if (!envelope || envelope.status === "error" || (envelope.code && envelope.code !== "SUCCESS")) fail(envelope);
  const details = envelope.details;
  const body = parse(details?.statusMessage ?? details?.response ?? envelope);
  if (Number(details?.statusCode ?? details?.CODE) >= 400) fail(body);
  const result = body?.data?.[0];
  if (!result || result.status === "error" || (payload ? result.code !== "SUCCESS" : String(result.id) !== String(recordId))) fail(result || body);
  return result;
}
