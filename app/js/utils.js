export function getLayoutValue(layoutField) {
  if (!layoutField) {
    return "";
  }

  if (typeof layoutField === "object") {
    return layoutField.name || layoutField.api_name || layoutField.id || "";
  }

  return String(layoutField);
}

export function formatDate(value) {
  return value || "-";
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const parts = formatter.formatToParts(date);
  const getPart = function (type) {
    const part = parts.find(function (item) {
      return item.type === type;
    });

    return part ? part.value : "";
  };

  return [
    getPart("month"),
    " ",
    getPart("day"),
    ", ",
    getPart("year"),
    " ",
    getPart("hour"),
    ":",
    getPart("minute"),
    getPart("dayPeriod")
  ].join("");
}

export function formatCurrency(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

export function getLookupName(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "object") {
    return (
      value.name ||
      value.full_name ||
      value.display_value ||
      value.actual_value ||
      value.label ||
      value.Deal_Name ||
      value.Account_Name ||
      value.Name ||
      value.stage_name ||
      value.Stage_Name ||
      value.user_name ||
      value.email ||
      ""
    );
  }

  return String(value);
}

export const DRAFT_FROM_ADMIN_VALUE = "crmadmin";
export const DRAFT_FROM_LOGIN_USER_VALUE = "loginuserid";
export const DRAFT_FROM_ADMIN_EMAIL = "crmadmin@madeforspainandportugal.com";

export function normalizeDraftFromSubmitValue(currentUserEmail, value) {
  var normalizedValue = String(value || "").trim();
  var comparableValue = normalizedValue.toLowerCase();
  var comparableCurrentUserEmail = String(currentUserEmail || "").trim().toLowerCase();

  if (!normalizedValue) {
    return "";
  }

  if (
    comparableValue === DRAFT_FROM_LOGIN_USER_VALUE ||
    (comparableCurrentUserEmail && comparableValue === comparableCurrentUserEmail)
  ) {
    return DRAFT_FROM_LOGIN_USER_VALUE;
  }

  if (
    comparableValue === DRAFT_FROM_ADMIN_VALUE ||
    comparableValue === DRAFT_FROM_ADMIN_EMAIL.toLowerCase()
  ) {
    return DRAFT_FROM_ADMIN_VALUE;
  }

  return normalizedValue;
}

export function resolveDraftFromDisplayValue(currentUserEmail, value) {
  var normalizedValue = String(value || "").trim();
  var comparableValue = normalizedValue.toLowerCase();
  var normalizedCurrentUserEmail = String(currentUserEmail || "").trim();

  if (!normalizedValue) {
    return "";
  }

  if (comparableValue === DRAFT_FROM_LOGIN_USER_VALUE) {
    return normalizedCurrentUserEmail || normalizedValue;
  }

  if (comparableValue === DRAFT_FROM_ADMIN_VALUE) {
    return DRAFT_FROM_ADMIN_EMAIL;
  }

  return normalizedValue;
}

export function normalizeComparableText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getBookingStageValue(record) {
  var stageValue = firstNonEmptyText(
    getLookupName(record && record.Stage),
    getLookupName(record && record.stage),
    getLookupName(record && record.Booking_Stage),
    getLookupName(record && record.BookingStage),
    getLookupName(record && record.Stage_Name),
    getLookupName(record && record.stage_name),
    getLookupName(record && record.Stage_Probability),
    getLookupName(record && record.StageProbability),
    getLookupName(record && record.Deal_Stage),
    getLookupName(record && record.Pipeline_Stage),
    getLookupName(record && record.$stage),
    getLookupName(record && record.$stage_info)
  );

  if (stageValue) {
    return stageValue;
  }

  return inferTextFromRecordKeys(record, ["stage"]);
}

export function getBookingOwnerInfo(record) {
  var ownerCandidate = firstNonEmptyValue(
    record && record.Owner,
    record && record.owner,
    record && record.SMOWNERID,
    record && record.smownerid,
    record && record.Booking_Owner,
    record && record.BookingOwner,
    record && record.Record_Owner,
    record && record.record_owner,
    record && record.Owner_Id,
    record && record.owner_id,
    record && record.Assigned_To,
    record && record.Owner_Name,
    record && record.Booking_Owner_Name,
    record && record.$owner
  );

  if (!ownerCandidate) {
    ownerCandidate = inferValueFromRecordKeys(record, ["owner"]);
  }

  if (!ownerCandidate) {
    return null;
  }

  if (typeof ownerCandidate === "object") {
    var ownerId = firstNonEmptyText(
      ownerCandidate.id,
      ownerCandidate.user_id,
      ownerCandidate.zuid,
      ownerCandidate.owner_id,
      ownerCandidate.Owner_Id,
      ownerCandidate.SMOWNERID
    );
    var ownerLabel = firstNonEmptyText(
      ownerCandidate.name,
      ownerCandidate.full_name,
      ownerCandidate.display_value,
      ownerCandidate.actual_value,
      ownerCandidate.label,
      ownerCandidate.user_name,
      ownerCandidate.Owner_Name,
      ownerCandidate.assigned_to,
      ownerCandidate.Assigned_To,
      ownerCandidate.email
    );
    var ownerEmail = firstNonEmptyText(ownerCandidate.email, ownerCandidate.user_email);

    return {
      value: ownerId || ownerLabel || ownerEmail,
      label: ownerLabel || ownerEmail || ownerId || "",
      id: ownerId || "",
      name: ownerLabel || ownerEmail || "",
      email: ownerEmail || ""
    };
  }

  return {
    value: String(ownerCandidate),
    label: String(ownerCandidate),
    id: "",
    name: String(ownerCandidate),
    email: ""
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function extractRecords(response) {
  if (!response) {
    return [];
  }

  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (Array.isArray(response.records)) {
    return response.records;
  }

  if (Array.isArray(response)) {
    return response;
  }

  return [];
}

export function getApiErrorDetails(error) {
  const sources = [
    error,
    error && error.api_response,
    error && error.apiResp,
    error && error.details,
    error && error.response,
    error && error.responseJSON,
    error && error.data,
    error && error.body,
    tryParseJson(error && error.message),
    tryParseJson(error && error.responseText)
  ];

  for (var index = 0; index < sources.length; index += 1) {
    var source = normalizeErrorSource(sources[index]);

    if (!source) {
      continue;
    }

    var code = firstText(source.code, source.errorCode, source.error_code, source.status_code);
    var message = firstText(
      source.message,
      source.error,
      source.description,
      source.details && source.details.output,
      source.details && source.details.message
    );

    if (code || message) {
      return {
        code: code || "",
        message: message || ""
      };
    }
  }

  return {
    code: "",
    message: error && error.message ? String(error.message) : ""
  };
}

export function buildBookingLabel(booking) {
  const reference = booking.MFSP_Reference || "No ref";
  const name = booking.Deal_Name || "Untitled booking";
  return reference + " | " + name;
}

export function getStepShortDescription(step) {
  if (!step) {
    return "";
  }

  return (
    step.Short_Description ||
    step.Short_description ||
    step.ShortDescription ||
    step.Step_Short_Description ||
    ""
  );
}

export function getStepDisplayName(step) {
  if (!step) {
    return "";
  }

  return getStepShortDescription(step) || step.Name || "";
}

export function getStepInternalName(step) {
  if (!step) {
    return "";
  }

  return step.Name || "";
}

export function escapeCriteriaValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function normalizeBookingCandidate(record) {
  var owner = getBookingOwnerInfo(record);

  return {
    id: record.id,
    MFSP_Reference: firstNonEmptyText(record.MFSP_Reference, record.Reference, record.Booking_Reference),
    Deal_Name: firstNonEmptyText(record.Deal_Name, record.Name, record.Booking_Name),
    Account_Name: record.Account_Name || null,
    Owner: owner
      ? {
          id: owner.id || owner.value,
          name: owner.name || owner.label,
          email: owner.email || ""
        }
      : null,
    Stage: getBookingStageValue(record),
    Arrival_Date: firstNonEmptyText(record.Arrival_Date, record.Start_Date),
    Departure_Date: firstNonEmptyText(record.Departure_Date, record.End_Date),
    Travelers_Number: firstNonEmptyText(record.Travelers_Number, record.Travellers_Number, record.Number_of_Travelers),
    Account_Name: record.Account_Name || record.Agency || null,
    Primary_Contact: record.Primary_Contact || record.Contact_Name || null,
    Sales_Price: firstNonEmptyText(record.Sales_Price_inc_Taxes, record.Sales_Price, record.Sales_Amount, record.Total_Sales, record.Total_Sales_Amount, record.Amount)
  };
}

export function dedupeBookings(records) {
  const seen = {};

  return records.filter(function (record) {
    if (!record || !record.id || seen[record.id]) {
      return false;
    }

    seen[record.id] = true;
    return true;
  });
}

function normalizeErrorSource(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return tryParseJson(value) || {
      message: value
    };
  }

  if (typeof value === "object") {
    return value;
  }

  return {
    message: String(value)
  };
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
}

function firstText() {
  for (var index = 0; index < arguments.length; index += 1) {
    var value = arguments[index];

    if (value !== null && value !== undefined && value !== "") {
      return String(value);
    }
  }

  return "";
}

function firstNonEmptyValue() {
  for (var index = 0; index < arguments.length; index += 1) {
    var value = arguments[index];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

function firstNonEmptyText() {
  for (var index = 0; index < arguments.length; index += 1) {
    var value = arguments[index];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    return String(value);
  }

  return "";
}

function inferValueFromRecordKeys(record, tokens) {
  if (!record || typeof record !== "object") {
    return null;
  }

  var keys = Object.keys(record);

  for (var index = 0; index < keys.length; index += 1) {
    var key = keys[index];
    var comparableKey = normalizeComparableText(key);
    var matchesAllTokens = tokens.every(function (token) {
      return comparableKey.indexOf(token) !== -1;
    });

    if (!matchesAllTokens) {
      continue;
    }

    if (comparableKey.indexOf("created") !== -1 || comparableKey.indexOf("modified") !== -1) {
      continue;
    }

    var value = record[key];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

function inferTextFromRecordKeys(record, tokens) {
  var inferredValue = inferValueFromRecordKeys(record, tokens);

  if (!inferredValue) {
    return "";
  }

  return getLookupName(inferredValue);
}
