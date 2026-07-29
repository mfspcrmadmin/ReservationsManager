import { crmExecuteFunction } from "./api.js";
import { elements } from "./dom.js";
import { renderActiveTab, renderTravelersPanel } from "./render.js";
import { state } from "./state.js";
import { normalizeComparableText } from "./utils.js";

export function renderTravelersWorkspace() {
  renderTravelersPanel({
    elements: elements,
    state: state,
    onTravelerSelected: selectTraveler
  });
  renderActiveTab(elements, state);
}

export function resetTravelersState() {
  state.travelers = [];
  state.selectedTravelerId = "";
  state.selectedTraveler = null;
  state.travelersLoading = false;
  state.travelersLoadedBookingId = "";
  state.travelersError = "";
}

export function selectTraveler(travelerId) {
  state.selectedTravelerId = String(travelerId || "").trim();
  state.selectedTraveler = state.travelers.find(function (traveler) {
    return traveler && traveler.id === state.selectedTravelerId;
  }) || null;
  renderTravelersWorkspace();
}

export async function ensureBookingTravelersLoaded(forceReload) {
  var bookingId = String(state.selectedBookingId || "").trim();

  if (!bookingId) {
    resetTravelersState();
    renderTravelersWorkspace();
    return;
  }

  if (!forceReload && state.travelersLoadedBookingId === bookingId && !state.travelersError) {
    if (!state.selectedTraveler && state.travelers.length) {
      state.selectedTraveler = state.travelers[0];
      state.selectedTravelerId = state.selectedTraveler.id || "";
    }
    renderTravelersWorkspace();
    return;
  }

  if (state.travelersLoading) {
    renderTravelersWorkspace();
    return;
  }

  state.travelersLoading = true;
  state.travelersError = "";
  renderTravelersWorkspace();

  try {
    var travelers = (await loadTravelersForBooking(bookingId)).sort(compareTravelers);
    console.debug("[ReservationsManager:travelers] travelers parsed", {
      bookingId: bookingId,
      count: travelers.length,
      travelers: travelers
    });

    state.travelers = travelers;
    state.travelersLoadedBookingId = bookingId;
    state.travelersError = "";

    if (travelers.length) {
      var preferredTraveler = travelers.find(isLeadPaxRecord) || travelers[0];
      var selectedTravelerId = state.selectedTravelerId && travelers.some(function (traveler) {
        return traveler.id === state.selectedTravelerId;
      })
        ? state.selectedTravelerId
        : preferredTraveler.id;

      state.selectedTravelerId = selectedTravelerId;
      state.selectedTraveler = travelers.find(function (traveler) {
        return traveler.id === selectedTravelerId;
      }) || preferredTraveler;
    } else {
      state.selectedTravelerId = "";
      state.selectedTraveler = null;
    }
  } catch (error) {
    console.debug("[ReservationsManager:travelers] travelers load failed", {
      bookingId: bookingId,
      error: error
    });
    state.travelers = [];
    state.selectedTravelerId = "";
    state.selectedTraveler = null;
    state.travelersLoadedBookingId = "";
    state.travelersError = error && error.message ? error.message : "Could not load travelers for this booking.";
  } finally {
    state.travelersLoading = false;
    renderTravelersWorkspace();
  }
}

async function loadTravelersForBooking(bookingId) {
  var response = await crmExecuteFunction("gettravellersforbooking", {
    bookingId: bookingId
  });
  console.debug("[ReservationsManager:travelers] function response", {
    bookingId: bookingId,
    response: response
  });
  var payload = extractFunctionPayload(response);
  console.debug("[ReservationsManager:travelers] function payload", {
    bookingId: bookingId,
    payload: payload
  });

  if (payload && payload.error) {
    throw new Error(payload.message || "Could not load travelers for this booking.");
  }

  return extractTravelerRecords(payload);
}

function extractFunctionPayload(response) {
  var candidates = [
    response && response.details && response.details.output,
    response && response.details && response.details.response,
    response && response.details,
    response && response.data,
    response
  ];

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = candidates[index];
    if (typeof candidate === "string") {
      candidate = parseTravelerFunctionOutput(candidate);
      if (candidate === null) {
        continue;
      }
    }
    if (candidate !== null && candidate !== undefined && candidate !== "") {
      return candidate;
    }
  }

  return [];
}

function parseTravelerFunctionOutput(value) {
  var text = String(value || "").trim();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    // The Deluge function returns each traveler as a JSON object, one after
    // another, rather than a JSON array. Parse those complete root objects.
    var records = [];
    var startIndex = -1;
    var depth = 0;
    var inString = false;
    var escaped = false;

    for (var index = 0; index < text.length; index += 1) {
      var character = text.charAt(index);

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        if (depth === 0) {
          startIndex = index;
        }
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0 && startIndex !== -1) {
          try {
            records.push(JSON.parse(text.slice(startIndex, index + 1)));
          } catch (parseError) {
            return null;
          }
          startIndex = -1;
        }
      }
    }

    return records.length ? records : null;
  }
}

function extractTravelerRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  var collections = [payload.travelers, payload.travellers, payload.Travelers, payload.Travellers, payload.data, payload.records, payload.items, payload.result];
  for (var index = 0; index < collections.length; index += 1) {
    if (Array.isArray(collections[index])) {
      return collections[index];
    }
  }

  return [];
}

function isLeadPaxRecord(traveler) {
  var value = traveler && (traveler.Lead_Pax !== undefined ? traveler.Lead_Pax : traveler.Lead !== undefined ? traveler.Lead : traveler.lead);

  if (typeof value === "boolean") {
    return value;
  }

  var normalizedValue = normalizeComparableText(value);
  return normalizedValue === "true" || normalizedValue === "yes" || normalizedValue === "lead pax";
}

function compareTravelers(left, right) {
  if (isLeadPaxRecord(left) !== isLeadPaxRecord(right)) {
    return isLeadPaxRecord(left) ? -1 : 1;
  }

  var leftSurname = String(left && (left.Name || left.Surname || left.surname) || "").trim();
  var rightSurname = String(right && (right.Name || right.Surname || right.surname) || "").trim();

  if (leftSurname !== rightSurname) {
    return leftSurname.localeCompare(rightSurname);
  }

  return String(left && (left.Forename || left.forename) || "").trim().localeCompare(String(right && (right.Forename || right.forename) || "").trim());
}
