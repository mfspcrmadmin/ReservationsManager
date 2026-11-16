import { getWidgetPermissions } from "./widget-permissions.js";
// Activate only after the authenticated Creator endpoint and connection are installed.
export const DOCUMENTS_CONFIG = Object.freeze({
  functionName: "traveldocumentseditor",
  preview: "https://creatorapp.zoho.eu/madeforspainandportugal/travel-documents-generator/#Page:Travel_Document_Preview?documentId="
});

const text = value => String(value ?? "").trim();
let documentRequestSequence = 0;
const diagnosticFields = ["status", "source", "stage", "error_line", "request_age_ms", "relationship_matches", "administrator_profile", "email_matches", "has_user_id", "has_user_email", "has_body"];

function documentDiagnostics(value) {
  const safe = {};
  for (const key of diagnosticFields) {
    if (["string", "number", "boolean"].includes(typeof value?.[key])) safe[key] = String(value[key]).slice(0,120);
  }
  return safe;
}

export function canManageDocuments(state) {
  return getWidgetPermissions(state).manageDocuments;
}

export function unwrapDocumentResponse(raw) {
  let value = raw;
  for (let i = 0; i < 8; i++) {
    if (typeof value === "string") { try { value = JSON.parse(value); } catch (_) { break; } }
    if (value?.status === "OK" || value?.status === "ERROR") return value;
    const next = value?.details?.output ?? value?.details?.statusMessage ?? value?.response ?? value?.result ?? value?.data;
    if (next == null || next === value) break;
    value = next;
  }
  throw new Error("Creator did not return a valid editor response. Check the API configuration.");
}

export async function requestDocuments(state, action, values = {}, dependencies = {}) {
  const requestId = "documents-" + (++documentRequestSequence);
  const started = Date.now();
  const logger = dependencies.logger || ((event, details) => console.info("[Documents] " + event + " " + JSON.stringify(details)));
  const log = (event, details = {}) => {
    try { logger(event, { request_id: requestId, elapsed_ms: Date.now() - started, ...details }); } catch (_) { /* Diagnostics must never break the request. */ }
  };
  let phase = "CLIENT_VALIDATION";
  try {
  if (!canManageDocuments(state)) throw new Error("Documents is available to Administrators only.");
  const config = dependencies.config || DOCUMENTS_CONFIG;
  if (!config.functionName) throw new Error("The document editor function has not been configured yet.");
  if (!/^\d+$/.test(text(values.booking_id))) throw new Error("Select a booking first.");
  if (!["list", "get", "save_block", "create", "lookup_booking", "shared_library", "add_booking", "add_shared", "delete", "save_crm", "generate", "publish", "unpublish", "save_settings"].includes(action)) throw new Error("Unsupported document action.");
  if (action === "delete" && (!/^\d+$/.test(text(values.document_id)) || values.confirm_delete !== true || !Number.isInteger(values.revision) || values.revision < 1)) throw new Error("Refresh the list and confirm which document to delete.");
  if (action === "create" && !["FID", "Proposal", "Quote"].includes(values.document_type)) throw new Error("Choose FID, Proposal or Quote.");
  if (action === "create") {
    const name = text(values.document_name);
    if (!name || name.length > 255) throw new Error("Enter a document name between 1 and 255 characters.");
    values = { ...values, document_name: name };
  }
  const invoke = dependencies.invoke || ((name, request) => ZOHO.CRM.FUNCTIONS.execute(name, request));
  const requestBody = JSON.stringify({ ...values, action });
  log("request", {
    function_name: config.functionName, action, booking_id: text(values.booking_id), document_id: text(values.document_id),
    argument_names: ["requestBody"], request_body_type: "string", request_body_characters: requestBody.length,
    user_id: text(state.currentUserId), administrator: true,
    ...(action === "save_block" ? { revision: values.revision, edited_text_characters: String(values.edit?.body || "").length } : {})
  });
  phase = "CRM_SDK";
  const raw = await invoke(config.functionName, { arguments: JSON.stringify({ requestBody }) });
  log("sdk-response", {
    response_type: typeof raw, code: typeof raw?.code === "string" ? raw.code.slice(0,100) : null,
    has_function_output: raw?.details?.output != null
  });
  if (!canManageDocuments(state)) throw new Error("Document access is no longer available.");
  phase = "PARSE_RESPONSE";
  const response = unwrapDocumentResponse(raw);
  log("response", {
    ...documentDiagnostics(response),
    document_count: Array.isArray(response.documents) ? response.documents.length : null,
    block_count: Array.isArray(response.blocks) ? response.blocks.length : null
  });
  phase = "SERVER_RESULT";
  if (response.status !== "OK") {
    const diagnostics = ["source", "stage", "error_line", "error_kind", "creator_code", "request_age_ms", "relationship_matches", "administrator_profile", "email_matches", "has_user_id", "has_user_email"]
      .filter(key => response[key] !== undefined && response[key] !== null)
      .map(key => key + ": " + String(response[key]).slice(0,100)).join(" · ");
    throw new Error((response.message || "Creator could not complete this operation.") + (diagnostics ? " [" + diagnostics + "]" : ""));
  }
  return response;
  } catch (error) {
    log("error", { phase, code: typeof error?.code === "string" ? error.code.slice(0,100) : null });
    throw error;
  }
}

export function validateDocumentWorkspaceResponse(action, values, response) {
  if (action === "list" && !Array.isArray(response?.documents)) {
    throw new Error("The document list could not be verified. Refresh and try again.");
  }
  if (["get", "save_block", "save_settings"].includes(action)) {
    const doc = response?.document;
    if (!doc || String(doc.id) !== String(values.document_id) || !Array.isArray(response.blocks) ||
        !Number.isInteger(Number(doc.revision)) || Number(doc.revision) < 1) {
      throw new Error("The response does not match this document. Reopen Studio to check its current state.");
    }
    if (action !== "get" && Number(doc.revision) <= Number(values.revision)) {
      throw new Error("Saving was not confirmed. Your changes are still here; reopen Studio to check the saved revision.");
    }
    if (!groupDocumentBlocks(response.blocks).length) {
      throw new Error("This document has no editable sections. Reopen Studio to check its content.");
    }
  }
  return response;
}

export function groupDocumentBlocks(blocks) {
  const groups = new Map();
  const seen = new Set();
  for (const block of [...blocks].sort((a, b) => Number(a.order) - Number(b.order))) {
    const match = /^(.+):part:(\d+)$/.exec(block.key || "");
    if (!match || seen.has(block.key)) throw new Error("This document has invalid or duplicated text fragments.");
    seen.add(block.key);
    const key = match[1];
    const group = groups.get(key) || { ...block, key, body: "", parts: [], visible: true };
    if (Number(match[2]) !== group.parts.length) throw new Error("This document has missing or unordered text fragments.");
    group.parts.push(block);
    group.body += block.body || "";
    group.visible = group.visible && block.visibility === "Included";
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function buildBlockEdit(group, values) {
  const title = String(values.title ?? "");
  const body = String(values.body ?? "");
  const image = text(values.image);
  if (title.length > 255) throw new Error("The title must be 255 characters or fewer.");
  if (body.length > group.parts.length * 6000) throw new Error("This text exceeds the space available in this block. Split it into sections in Creator.");
  if (image.length > 255 || (image && !/^https:\/\//i.test(image))) throw new Error("Use a direct HTTPS image URL of 255 characters or fewer.");
  return { key: group.key, title, body, image, visibility: values.visible ? "Included" : "Hidden" };
}
