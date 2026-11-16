// Only an explicit, durably confirmed checkpoint permits another phase request.
// Transport failures and uncertain business results never trigger a replay.
function recoveryError(result) {
  const error = new Error(result?.message || "CRM did not confirm the operation. Check its status before retrying.");
  error.recovery = result;
  return error;
}

function unwrapWorkflowResult(value) {
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { throw recoveryError({ message: "CRM returned an unreadable result. Check its status before retrying." }); }
      continue;
    }
    if (!value || typeof value !== "object") break;
    const wrapper = value.details?.output !== undefined;
    const rejected = value.error === true || value.success === false || String(value.status).toLowerCase() === "error" ||
      value.code && String(value.code).toUpperCase() !== "SUCCESS";
    if (wrapper) {
      if (rejected) throw recoveryError(value);
      value = value.details.output;
      continue;
    }
    if (value.operation_pending === true && value.checkpoint_confirmed === true &&
        value.success !== false && String(value.status).toLowerCase() !== "error" &&
        (!value.code || String(value.code).toUpperCase() === "SUCCESS")) return value;
    if (rejected) throw recoveryError(value);
    if (value.error === false || value.success === true) return value;
    break;
  }
  throw recoveryError();
}

async function workflowRequest(crm, request) {
  if (!crm?.FUNCTIONS?.execute) throw new Error("The authenticated recovery API is unavailable. Check CRM before repeating an operation.");
  const safeRequest = Object.fromEntries(["action", "bookingId", "operationId", "phase", "decision", "reviewed"]
    .filter(key => request?.[key] !== undefined).map(key => [key, request[key]]));
  return crm.FUNCTIONS.execute("widget_recordlease", {
    arguments: JSON.stringify({ action: "widget_operation", requestBody: JSON.stringify({ operation: "widget_workflowrecovery", requestBody: JSON.stringify(safeRequest) }) })
  });
}

async function continueWorkflow(crm, initial, bookingId, operationId) {
  let response = initial;
  for (let phase = 0; phase < 24; phase++) {
    const result = unwrapWorkflowResult(response);
    if (result.operation_pending !== true) {
      if (operationId && result.operation_id != null && String(result.operation_id) !== String(operationId)) {
        throw recoveryError({ message: "CRM confirmed a different recovery. Check status before making further changes." });
      }
      return result;
    }
    const id = String(result.operation_id || "");
    if (result.checkpoint_confirmed !== true || !/^\d+$/.test(id) || String(result.booking_id) !== String(bookingId) ||
        operationId && id !== String(operationId)) throw recoveryError({ message: "CRM returned an inconsistent checkpoint. Check its status before continuing." });
    operationId = id;
    response = await workflowRequest(crm, { action: "resume", bookingId: String(bookingId), operationId: id });
  }
  throw recoveryError({ message: "The operation reached its phase limit. Check its status before continuing." });
}

export async function executeWorkflowOperation(crm, request) {
  return continueWorkflow(crm, await workflowRequest(crm, request), request.bookingId, request.operationId);
}

export async function executeRecoverableFunction(crm, functionName, args) {
  const options = typeof args?.args === "string" ? JSON.parse(args.args || "{}") : args?.args || {};
  const response = await crm.FUNCTIONS.execute(functionName, {
    arguments: JSON.stringify({ ...args, args: functionName === "sync_runprojectfromezus"
      ? { ...options, execution_mode: "step" } : JSON.stringify({ ...options, execution_mode: "step" }) })
  });
  return continueWorkflow(crm, response, args.bookingId);
}
