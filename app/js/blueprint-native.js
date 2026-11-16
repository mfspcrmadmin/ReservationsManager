import { executeWorkflowOperation } from "./workflow-operation-api.js";
// Execute with the embedded CRM session: the OAuth connection owner must not
// become the author of another user's Blueprint transition.
export async function executeNativeBlueprint(args, crm = globalThis.ZOHO?.CRM) {
  const fail = message => ({ success: false, message });
  if (typeof crm?.API?.updateBluePrint !== "function" || typeof crm?.API?.getBluePrint !== "function") {
    return fail("CRM cannot execute this action with your session. Reload the widget; no shared-user fallback was used.");
  }
  const user = JSON.parse(args.actionUserJSON || "{}");
  if (!user.id || !user.email || !user.name) return fail("Could not identify the current user. Reload the widget.");
  const config = { Entity: args.moduleApiName, RecordID: String(args.recordId) };
  const read = async () => {
    const response = await crm.API.getBluePrint(config);
    if (!response?.blueprint?.process_info || !Array.isArray(response.blueprint.transitions)) throw new Error("Could not verify your current Blueprint permissions.");
    return response.blueprint;
  };
  const bp = await read();
  const transition = bp.transitions.find(item => String(item.id) === String(args.transitionId));
  if (!transition || transition.criteria_matched === false || String(transition.type || transition.trigger_type || "manual") !== "manual") return fail("This transition is no longer available for your user.");
  const currentState = String(bp.process_info.field_value || "");
  if (args.expectedCurrentState && currentState.toLowerCase() !== args.expectedCurrentState.toLowerCase()) return fail("The booking changed state. Refresh before continuing.");
  const data = JSON.parse(args.transitionDataJson || "{}");
  if (args.moduleApiName === "Deals" && String(args.transitionId) === "616617000135728037") {
    // The prefix action only links the project. Complete the idempotent
    // WorkDrive/Desk preparation before requiring its outputs or moving Stage.
    let preparation;
    try {
      preparation = await executeWorkflowOperation(crm, { action: "prepare_start", bookingId: String(args.recordId) });
    } catch (error) {
      return fail("Could not confirm project follow-up. The linked project must be checked before retrying. " + error.message);
    }
    if (preparation?.error !== false || preparation?.project_confirmed !== true || preparation?.workdrive_completed !== true || preparation?.desk_completed !== true) {
      return { ...fail(preparation?.message || "Project follow-up was not confirmed. The transition was not executed."), project_preparation: preparation };
    }
    const result = await crm.API.getRecord(config);
    const booking = result?.data?.[0];
    if (!booking?.Ezus_Project_ID || !booking?.Booking_Workdrive_Folder_ID || booking.Booking_Workdrive_Folder_ID === "-") return fail("Create and confirm the Ezus project and WorkDrive folder before executing this transition.");
  }
  data.Notes = [data.Notes, `Widget action requested by: ${user.name} <${user.email}>; CRM user ID: ${user.id}; Transition: ${transition.name} (${transition.id}).`].filter(Boolean).join("\n\n");
  // Preparations can take time. Recheck immediately before the only mutation.
  const gate = await read();
  if (String(gate.process_info.field_value || "") !== currentState || !gate.transitions.some(item => String(item.id) === String(args.transitionId) && item.criteria_matched !== false)) return fail("The workflow changed during preparation. Refresh; no transition was executed.");
  let result;
  try {
    result = await crm.API.updateBluePrint({ ...config, BlueprintData: { blueprint: [{ transition_id: String(args.transitionId), data }] } });
  } catch (_) {
    // A lost response does not establish that the write failed. Never retry.
    return { success: false, transition_outcome_unknown: true, message: "CRM did not confirm the result. Check the booking history before any further action; do not repeat the transition." };
  }
  const success = result?.status === "success" && String(result?.code || "SUCCESS").toUpperCase() === "SUCCESS";
  const payload = { success, result, message: result?.message || "CRM did not confirm the transition." };
  if (success && !/partially/i.test(result.message || "") && args.moduleApiName === "Deals" && /^Assign Reservation$/i.test(transition.name || "")) {
    payload.transition_completed = true;
    try {
      const output = await executeWorkflowOperation(crm, { action: "assignment_start", bookingId: String(args.recordId) });
      payload.reservation_assignment = output;
      if (output?.error !== false) throw new Error(output?.message || "CRM did not confirm the reservation assignment follow-up.");
    } catch (error) {
      payload.success = false;
      if (error.recovery) payload.reservation_assignment = error.recovery;
      payload.message = "The transition completed, but its assignment follow-up needs review. " + error.message;
    }
  }
  return payload;
}
