import { escapeHtml } from "./utils.js";

const labels = {
  project_creation: "Ezus project creation", project_preparation: "Project preparation",
  reservation_assignment: "Reservation assignment", auto_assignment: "Automatic assignment",
  booking_won_followup: "Booking confirmation follow-up", reservation_notice: "Assignment emails",
  sync_full: "Full Ezus synchronization", sync_project: "Project synchronization",
  sync_travelers: "Traveler synchronization", sync_services: "Service synchronization",
  sync_project_travelers: "Project and traveler synchronization", sync_project_services: "Project and service synchronization",
  sync_travelers_services: "Traveler and service synchronization",
  ezus_create: "Create Ezus project", project: "Confirm project", workdrive: "WorkDrive folder", desk: "Desk ticket",
  travelers: "Travelers", services: "Services", alternative: "Alternative link", audit: "Sync audit",
  representative: "Reservation Rep", priority: "Priority", owners: "CRM and Desk owners", ezus_stage: "Ezus stage",
  sync: "Synchronization", notifications: "Notifications", reservation: "Reservation email", sales: "Sales email"
};
const phasePlans = {
  project_creation: ["ezus_create"], project_preparation: ["project", "workdrive", "desk"],
  reservation_assignment: ["owners", "ezus_stage", "notifications"],
  auto_assignment: ["representative", "priority", "owners", "ezus_stage", "sync", "notifications"],
  booking_won_followup: ["priority", "ezus_stage", "sync", "notifications"], reservation_notice: ["reservation", "sales"]
};

const spinner = '<span class="workflow-recovery-spinner" aria-hidden="true"></span>';
const actionLabels = { stop: "Closing recovery...", review: "Recording review...", resume: "Resuming remaining steps..." };

export function parseWorkflowRecoveryResult(value) {
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") { try { value = JSON.parse(value); } catch (_) { throw new Error("CRM returned an unreadable recovery result. Check its status before trying again."); } continue; }
    if (!value || typeof value !== "object" || Array.isArray(value)) break;
    if (value.error === true || value.success === false || String(value.status).toLowerCase() === "error" ||
        value.code && String(value.code).toUpperCase() !== "SUCCESS") {
      throw new Error(value.message || "CRM could not confirm this recovery request. Check its status before trying again.");
    }
    if (value.details?.output !== undefined) { value = value.details.output; continue; }
    if (value.success === true || value.error === false) return value;
    break;
  }
  throw new Error("CRM returned an unreadable recovery result. Check its status before trying again.");
}

export function workflowRecoveryMarkup({ operations = [], error = "", loading = false, busy = false, pendingAction = "" } = {}) {
  const disabled = busy || loading ? " disabled" : "";
  const cards = operations.map(op => {
    const id = escapeHtml(String(op.operation_id));
    const plan = phasePlans[op.kind] || (String(op.kind).startsWith("sync_")
      ? ["project", "travelers", "services"].filter(phase => op.kind === "sync_full" || String(op.kind).includes(phase)).concat(String(op.kind).includes("services") || op.kind === "sync_full" ? ["alternative", "audit"] : ["audit"]) : []);
    const known = op.phases || [];
    const ordered = plan.map(phase => known.find(step => step.phase === phase) || { phase, state: "Not started", can_review: false })
      .concat(known.filter(step => !plan.includes(step.phase)));
    const confirmedCount = ordered.filter(step => step.state === "Completed").length;
    const waitingCount = ordered.filter(step => step.state === "Not started").length;
    const focus = ordered.find(step => step.state === "Started" || step.state === "Uncertain")
      || ordered.find(step => step.state !== "Completed" && step.state !== "Not started")
      || ordered.find(step => step.state !== "Completed");
    const phaseName = step => labels[step.phase] || step.phase;
    const stateName = step => step.state === "Completed" ? "Confirmed" : step.state === "Not started" ? "Not started"
      : step.state === "Started" ? "Unconfirmed / may be running" : step.state === "Uncertain" ? "Check result" : "Needs recovery";
    const reviewButton = step => step?.can_review && step.state !== "Completed"
      ? '<button class="button secondary compact" type="button" data-recovery-action="review" data-operation-id="' + id + '" data-phase="' + escapeHtml(step.phase) + '"' + disabled + '>Review ' + escapeHtml(phaseName(step).toLowerCase()) + '</button>' : '';
    const phases = ordered.map(step => '<li><span>' + escapeHtml(phaseName(step)) + '</span><span class="workflow-recovery-state' +
      (step.state === "Completed" ? ' is-confirmed' : '') + '">' + stateName(step) + '</span>' +
      (step === focus ? '' : reviewButton(step)) + '</li>').join("");
    const running = op.may_be_running;
    const needsReview = op.needs_review || ordered.some(step => step.state === "Uncertain" || step.state === "Failed" && !op.can_resume);
    const status = running ? "May still be running" : needsReview ? "Review needed" : op.can_resume ? "Ready to resume" : "Check status";
    let instruction = "";
    if (focus && needsReview && !running) {
      const phase = focus.phase;
      const system = ["reservation", "sales", "notifications"].includes(phase) ? "the recipients' mailboxes"
        : phase === "workdrive" ? "CRM and WorkDrive" : phase === "desk" || phase === "owners" ? "CRM and Desk"
        : ["project", "ezus_create", "travelers", "services", "alternative", "ezus_stage", "sync"].includes(phase) ? "CRM and Ezus" : "CRM";
      instruction = "Check " + phaseName(focus).toLowerCase() + " in " + system + " before confirming the result or allowing a retry.";
    }
    const summary = running ? "Wait for the current step to finish, then check its status."
      : focus && needsReview ? phaseName(focus) + ": check the result before continuing."
      : op.can_resume ? "Continue the remaining steps. Confirmed steps will be skipped."
      : "Check the operation status before continuing.";
    return '<article class="workflow-recovery-card" data-operation-id="' + id + '">' +
      '<div class="workflow-recovery-card-heading"><h3>' + escapeHtml(labels[op.kind] || op.kind) + '</h3><span class="workflow-recovery-badge' +
      (needsReview && !running ? ' is-review' : '') + '">' + status + '</span></div>' +
      '<p class="workflow-recovery-meta">' + (op.initiator ? 'Started by ' + escapeHtml(op.initiator) + ' &middot; ' : '') +
      '<span class="workflow-recovery-id">#' + id + '</span></p>' +
      '<p class="workflow-recovery-summary">' + escapeHtml(summary) + '</p>' +
      (focus && (needsReview || running) ? '<div class="workflow-recovery-focus"><div><strong>' + escapeHtml(phaseName(focus)) +
        '</strong><span class="workflow-recovery-state">' + stateName(focus) + '</span></div>' + reviewButton(focus) + '</div>' : '') +
      (instruction ? '<p class="workflow-recovery-help">' + escapeHtml(instruction) + ' Unconfirmed steps are never retried automatically.</p>' : '') +
      (!op.can_review && needsReview ? '<p class="workflow-recovery-help">Only the person who started this operation or an Administrator can record the review.</p>' : '') +
      (op.can_resume ? '<div class="workflow-recovery-primary"><button type="button" class="button secondary compact" data-recovery-action="resume" data-operation-id="' + id + '"' + disabled + '>Resume remaining steps</button></div>' : '') +
      '<details class="workflow-recovery-steps" data-operation-id="' + id + '"><summary>View all steps <span>' + confirmedCount + ' confirmed &middot; ' +
      waitingCount + ' not started</span></summary><ul>' + phases + '</ul></details>' +
      (op.can_close ? '<footer class="workflow-recovery-footer"><button type="button" class="button tertiary compact" data-recovery-action="stop" data-operation-id="' + id + '"' +
        disabled + '>Close recovery...</button><span>Stops recovery tracking. Existing changes are kept.</span></footer>' : '') + '</article>';

  }).join("");
  return '<div class="workflow-recovery-heading"><strong>Operation recovery' + (operations.length ? ' (' + operations.length + ')' : '') + '</strong>' +
    '<button class="button tertiary compact" type="button" data-recovery-action="refresh"' + disabled + '>' + (loading ? spinner + 'Checking status...' : 'Check status') + '</button></div>' +
    (busy ? '<p role="status">' + spinner + escapeHtml(actionLabels[pendingAction] || "Working...") + '</p>' : '') +
    (error ? '<p role="alert">' + escapeHtml(error) + '</p>' : '') +
    (cards || (loading ? '<p role="status">Checking pending operations...</p>' : !error ? '<p>No pending recovery steps were reported.</p>' : ''));
}

export function createWorkflowRecovery({ host, getContext, execute, beforeResume = () => {}, refresh = async () => {}, report = () => {} }) {
  let sequence = 0, operations = [], busy = false, loading = false, error = "", dialog, focusAnchor, pendingAction = "";
  const same = snapshot => { const current = getContext(); return current.bookingId === snapshot.bookingId && current.workspaceId === snapshot.workspaceId; };
  const render = () => {
    if (!host) return;
    const opened = new Set([...(host.querySelectorAll?.('details[open][data-operation-id]') || [])].map(item => item.dataset.operationId));
    const active = globalThis.document?.activeElement;
    if (active && host.contains?.(active) && active.dataset?.recoveryAction) focusAnchor = { ...active.dataset };
    else if (active && active !== globalThis.document?.body && !host.contains?.(active)) focusAnchor = null;
    host.hidden = !getContext().bookingId;
    host.setAttribute?.("aria-busy", String(busy || loading));
    host.innerHTML = workflowRecoveryMarkup({ operations, busy, loading, error, pendingAction });
    for (const card of host.querySelectorAll?.('details[data-operation-id]') || []) if (opened.has(card.dataset.operationId)) card.open = true;
    if (focusAnchor && (!globalThis.document?.activeElement || globalThis.document.activeElement === globalThis.document.body)) {
      const target = [...(host.querySelectorAll?.('[data-recovery-action]') || [])].find(item => !item.disabled &&
        ['recoveryAction', 'operationId', 'phase'].every(key => item.dataset[key] === focusAnchor[key]));
      if (target) { target.focus({ preventScroll: true }); focusAnchor = null; }
      else if (!busy && !loading) focusAnchor = null;
    }
  };
  async function request(action, snapshot, data = {}) {
    return parseWorkflowRecoveryResult(await execute({ requestBody: JSON.stringify({ ...data, action, bookingId: snapshot.bookingId }) }));
  }
  async function load() {
    const snapshot = { ...getContext() }, ticket = ++sequence;
    if (!snapshot.bookingId) { reset(); return; }
    loading = true; error = ""; render();
    try {
      const result = await request("status", snapshot);
      if (!same(snapshot) || ticket !== sequence) return;
      if (!Array.isArray(result.operations)) throw new Error("CRM did not return a complete recovery list. Try checking its status again.");
      const ids = result.operations.map(op => String(op.operation_id || ""));
      if (ids.some(id => !/^\d+$/.test(id)) || new Set(ids).size !== ids.length) throw new Error("CRM returned ambiguous recovery identities. Reload before changing a recovery.");
      operations = [...result.operations].sort((a, b) => String(b.operation_id).localeCompare(String(a.operation_id)));
    } catch (cause) {
      if (same(snapshot) && ticket === sequence) { error = cause.message; operations = []; }
    } finally {
      if (same(snapshot) && ticket === sequence) { loading = false; render(); }
    }
  }
  function reset() { sequence++; operations = []; error = ""; loading = false; if (dialog && !busy) dialog.close(); render(); }
  async function perform(action, operationId, data = {}) {
    if (busy) return;
    const snapshot = { ...getContext() };
    if (!snapshot.bookingId) throw new Error("Load the booking before reviewing an operation.");
    pendingAction = action; busy = true; render();
    try {
      if (action === "resume") await beforeResume(snapshot.bookingId);
      if (!same(snapshot)) throw new Error("The booking changed. Reopen recovery on the correct booking.");
      const result = await request(action, snapshot, { ...data, operationId });
      if (!same(snapshot)) return result;
      report(result.message || (action === "resume" ? "The remaining operation steps completed." : "Recovery review recorded."));
      if (action === "resume") {
        try {
          if (await refresh(snapshot.bookingId) === false && same(snapshot)) report("The operation completed. Save or cancel your new edits, then refresh the booking.", true);
        } catch (cause) {
          throw new Error("The operation completed, but the booking could not be refreshed. Refresh it before further changes. " + cause.message);
        }
      }
      return result;
    } finally {
      busy = false; pendingAction = "";
      if (same(snapshot)) await load();
    }
  }
  function review(operationId, phase, stop = false) {
    const snapshot = { ...getContext() }, previous = document.activeElement;
    if (dialog || busy || loading) return;
    const selected = operations.find(op => String(op.operation_id) === String(operationId));
    if (!selected || !(stop ? selected.can_close : selected.phases?.some(step => step.phase === phase && step.can_review))) {
      report("This recovery changed. Check its status before reviewing it.", true); return;
    }
    const targetId = String(selected.operation_id);
    dialog = document.createElement("dialog");
    dialog.className = "workflow-recovery-dialog";
    dialog.setAttribute("aria-labelledby", "workflow-recovery-title");
    dialog.innerHTML = '<form><h3 id="workflow-recovery-title">' + (stop ? 'Close this recovery' : 'Review ' + escapeHtml(labels[phase] || phase)) + '</h3>' +
      '<p class="workflow-recovery-target">' + escapeHtml(labels[selected.kind] || selected.kind) + '<br>Recovery #' + escapeHtml(targetId) + '<br>Booking #' + escapeHtml(snapshot.bookingId) + '</p>' +
      '<p>' + (stop ? 'Only this recovery record will be closed. It does not undo or delete changes already made in CRM, Ezus or Desk.' : 'Check the actual result in the relevant system first. Confirmed steps will be skipped; allowing a retry does not run it now.') + '</p>' +
      (stop ? '' : '<label>Result after checking<select name="decision" required><option value="" disabled selected>Choose the checked result</option><option value="confirm">The step completed</option><option value="retry">Allow a retry after checking</option></select></label>') +
      '<label class="workflow-recovery-check"><input name="reviewed" type="checkbox" required> I checked the result and any changes already made. If I allow a retry, I checked that it will not duplicate completed work.</label>' +
      '<p data-feedback role="status"></p><div class="workflow-recovery-actions"><button class="button secondary compact" type="submit">Record review</button><button class="button tertiary compact" type="button" data-cancel>Cancel</button></div></form>';
    const form = dialog.querySelector("form"), feedback = dialog.querySelector("[data-feedback]"), submit = form.querySelector('[type="submit"]');
    dialog.querySelector("[data-cancel]").onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      dialog.remove(); dialog = null;
      if (previous?.isConnected) previous.focus();
      else {
        const card = [...(host?.querySelectorAll("details[data-operation-id]") || [])].find(item => item.dataset.operationId === operationId);
        (card?.querySelector("summary") || host?.querySelector('[data-recovery-action="refresh"]'))?.focus({ preventScroll: true });
      }
    }, { once: true });
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      if (!same(snapshot)) { feedback.textContent = "The booking changed. Close this dialog and reopen recovery."; return; }
      submit.disabled = true;
      submit.innerHTML = spinner + (stop ? "Closing recovery..." : "Recording review...");
      form.setAttribute("aria-busy", "true");
      for (const control of form.querySelectorAll("input, select, [data-cancel]")) control.disabled = true;
      try {
        await perform(stop ? "stop" : "review", targetId, { phase, reviewed: form.elements.reviewed.checked, decision: stop ? "stop" : form.elements.decision.value });
        dialog?.close();
      } catch (cause) { feedback.textContent = cause.message; }
      finally {
        submit.disabled = false; submit.textContent = "Record review"; form.setAttribute("aria-busy", "false");
        for (const control of form.querySelectorAll("input, select, [data-cancel]")) control.disabled = false;
      }
    };
    document.body.appendChild(dialog); dialog.showModal(); (dialog.querySelector("select") || dialog.querySelector('input[type="checkbox"]')).focus();
  }
  host?.addEventListener("booking-recovery-refresh", () => { void load(); });
  host?.addEventListener("booking-recovery-reset", reset);
  host?.addEventListener("click", event => {
    const button = event.target.closest?.("[data-recovery-action]");
    if (!button || button.disabled || busy) return;
    const { recoveryAction: action, operationId, phase } = button.dataset;
    if (action === "refresh") { void load(); return; }
    if (action === "review" || action === "stop") { review(operationId, phase, action === "stop"); return; }
    if (action === "resume") {
      const snapshot = { ...getContext() };
      void perform(action, operationId).catch(cause => { if (same(snapshot)) report(cause.message, true); });
    }
  });
  return { load, reset, perform };
}
