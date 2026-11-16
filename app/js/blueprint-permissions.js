// Use the embedded user's session. Never fall back to the shared OAuth function:
// its transition list describes the connection owner, not the person using the widget.
export async function loadUserBlueprint(entity, recordId, api = globalThis.ZOHO?.CRM?.API, timeoutMs = 10000) {
  if (!entity || !recordId || typeof api?.getBluePrint !== "function") {
    throw new Error("Could not check your workflow permissions. Reload the widget and try again.");
  }
  let timer;
  try {
    const response = await Promise.race([
      api.getBluePrint({ Entity: entity, RecordID: String(recordId) }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workflow permission check timed out. Reload the booking and try again.")), timeoutMs);
      })
    ]);
    const blueprint = response?.blueprint;
    if (!blueprint || !blueprint.process_info || typeof blueprint.process_info !== "object" ||
        Array.isArray(blueprint.process_info) || !Array.isArray(blueprint.transitions) ||
        String(response.status || "").toLowerCase() === "error" ||
        (response.code && String(response.code).toUpperCase() !== "SUCCESS")) {
      throw new Error("Could not check your workflow permissions. " + (response?.message || "CRM returned no valid Blueprint details."));
    }
    if (blueprint.transitions.some(item => !item || !item.id)) {
      throw new Error("Could not check your workflow permissions. CRM returned invalid workflow actions.");
    }
    return { blueprint: {
      ...blueprint,
      transitions: blueprint.transitions.filter(item => String(item.type || item.trigger_type || "manual") === "manual")
        .map(item => ({ ...item, color_code: item.color_code || item.colour_code,
          text_color_code: item.text_color_code || item.text_colour_code }))
    } };
  } finally {
    clearTimeout(timer);
  }
}

// Metadata can supply appearance only. The native list remains authoritative for
// visibility, criteria, fields and data; never add a connection owner's actions.
export function applyBlueprintTransitionColors(transitions, metadata) {
  const colors = new Map((Array.isArray(metadata) ? metadata : []).filter(Boolean)
    .map(item => [String(item.id), item]));
  return transitions.map(item => {
    const appearance = colors.get(String(item.id)) || {};
    return { ...item,
      color_code: item.color_code || item.colour_code || appearance.color_code || appearance.colour_code,
      text_color_code: item.text_color_code || item.text_colour_code || appearance.text_color_code || appearance.text_colour_code
    };
  });
}

export function applyBlueprintStageColor(process, metadata) {
  // A second read can belong to a newer stage. Never import its label/state.
  if (!process?.field_value || String(process.field_value) !== String(metadata?.field_value) ||
      (process.id && metadata.id && String(process.id) !== String(metadata.id))) return process;
  const current = process.current_picklist || {};
  const source = metadata.current_picklist || {};
  const color = current.colour_code || current.color_code || source.colour_code || source.color_code;
  if (!color) return process;
  return { ...process, current_picklist: { ...current, colour_code: color } };
}

export async function assertUserBlueprintTransition({ transition, expectedState, readBlueprint, isCurrent }) {
  const blueprint = await readBlueprint();
  if (!isCurrent()) {
    throw new Error("The selected booking changed. Reopen the workflow action on the correct booking.");
  }
  const available = blueprint.transitions.find(item => String(item.id) === String(transition.id));
  if (!available || available.criteria_matched === false) {
    throw new Error("This workflow action is no longer available for your user or its requirements are not met. Reload the booking.");
  }
  const currentState = String(blueprint.processInfo?.field_value || "");
  if (expectedState && currentState !== expectedState) {
    throw new Error("The booking's workflow stage changed. Reload the booking before continuing.");
  }
  return blueprint;
}
