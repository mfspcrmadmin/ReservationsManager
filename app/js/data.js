import { crmGetAllRecords, crmSearchRecord, crmSearchWord } from "./api.js";
import { MODULES } from "./constants.js";
import {
  buildBookingLabel,
  dedupeBookings,
  escapeCriteriaValue,
  normalizeBookingCandidate
} from "./utils.js";

export function indexBookings(state, bookings) {
  const index = {};

  bookings.forEach(function (booking) {
    index[booking.id] = booking;
    index[buildBookingLabel(booking)] = booking;
    index[(booking.MFSP_Reference || "").toLowerCase()] = booking;
    index[(booking.Deal_Name || "").toLowerCase()] = booking;
  });

  state.bookingIndex = index;
}

export function cacheBookingLookup(state, booking) {
  state.bookingIndex[booking.id] = booking;
  state.bookingIndex[buildBookingLabel(booking)] = booking;
  state.bookingIndex[String(booking.MFSP_Reference || "").toLowerCase()] = booking;
  state.bookingIndex[String(booking.Deal_Name || "").toLowerCase()] = booking;
}

export function indexSteps(state, steps) {
  const index = {};

  steps.forEach(function (step) {
    index[step.id] = step;
  });

  state.stepIndex = index;
}

export async function searchBookingByInput(rawValue) {
  const queryValue = String(rawValue || "").trim();

  if (!queryValue) {
    return [];
  }

  const escapedValue = escapeCriteriaValue(queryValue);
  let combinedResults = [];

  try {
    const mfspResults = await crmSearchRecord(
      MODULES.bookings,
      "(MFSP_Reference:equals:" + escapedValue + ")"
    );

    combinedResults = combinedResults.concat(mfspResults.map(normalizeBookingCandidate));
  } catch (error) {}

  if (queryValue.length >= 2) {
    try {
      const nameResults = await crmSearchRecord(
        MODULES.bookings,
        "(Deal_Name:starts_with:" + escapedValue + ")"
      );

      combinedResults = combinedResults.concat(nameResults.map(normalizeBookingCandidate));
    } catch (error) {}
  }

  if (queryValue.length >= 2) {
    try {
      const wordResults = await crmSearchWord(MODULES.bookings, queryValue);
      combinedResults = combinedResults.concat(wordResults.map(normalizeBookingCandidate));
    } catch (error) {}
  }

  return dedupeBookings(combinedResults);
}

export async function loadBookingServicesForBooking(bookingId) {
  try {
    const searchResults = await crmSearchRecord(
      MODULES.bookingServices,
      "(Booking:equals:" + bookingId + ")"
    );

    if (searchResults.length) {
      return searchResults;
    }
  } catch (error) {}

  const aggregated = [];

  for (let page = 1; page <= 10; page += 1) {
    const pageRecords = await crmGetAllRecords(MODULES.bookingServices, page, 200);

    if (!pageRecords.length) {
      break;
    }

    aggregated.push.apply(aggregated, pageRecords);

    if (pageRecords.length < 200) {
      break;
    }
  }

  return aggregated.filter(function (service) {
    return service.Booking && service.Booking.id === bookingId;
  });
}

export async function loadBookingStepsForBooking(bookingId) {
  try {
    const searchResults = await crmSearchRecord(
      MODULES.bookingSteps,
      "(Booking:equals:" + bookingId + ")"
    );

    if (searchResults.length) {
      return searchResults;
    }
  } catch (error) {}

  const aggregated = [];

  for (let page = 1; page <= 10; page += 1) {
    const pageRecords = await crmGetAllRecords(MODULES.bookingSteps, page, 200);

    if (!pageRecords.length) {
      break;
    }

    aggregated.push.apply(aggregated, pageRecords);

    if (pageRecords.length < 200) {
      break;
    }
  }

  return aggregated.filter(function (step) {
    return step.Booking && step.Booking.id === bookingId;
  });
}

function extractDateKey(value) {
  if (!value) {
    return "";
  }

  var match = String(value).match(/\d{4}-\d{2}-\d{2}/);

  if (match) {
    return match[0];
  }

  var date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function getGroupedRowDateValue(step, services) {
  if (step && step.Start_Date_Time) {
    return step.Start_Date_Time;
  }

  for (var index = 0; index < services.length; index += 1) {
    if (services[index].Service_Date_Time) {
      return services[index].Service_Date_Time;
    }
  }

  for (var serviceIndex = 0; serviceIndex < services.length; serviceIndex += 1) {
    if (services[serviceIndex].Service_Date) {
      return services[serviceIndex].Service_Date;
    }
  }

  return "";
}

export function buildGroupedRows(state) {
  const servicesByStepId = {};

  state.filteredServices.forEach(function (service) {
    const stepId = service.Step && service.Step.id ? service.Step.id : "__no_step__";

    if (!servicesByStepId[stepId]) {
      servicesByStepId[stepId] = [];
    }

    servicesByStepId[stepId].push(service);
  });

  const groupedEntries = Object.keys(servicesByStepId).map(function (stepId) {
    const step = stepId === "__no_step__" ? null : state.stepIndex[stepId];
    const services = servicesByStepId[stepId];
    const dayValue = getGroupedRowDateValue(step, services);

    return {
      stepId: stepId,
      step: step,
      services: services,
      dayValue: dayValue,
      dayKey: extractDateKey(dayValue)
    };
  }).sort(function (left, right) {
    if (!left.dayKey && right.dayKey) {
      return 1;
    }

    if (left.dayKey && !right.dayKey) {
      return -1;
    }

    if (left.dayKey !== right.dayKey) {
      return left.dayKey.localeCompare(right.dayKey);
    }

    if (left.stepId === "__no_step__" && right.stepId !== "__no_step__") {
      return 1;
    }

    if (left.stepId !== "__no_step__" && right.stepId === "__no_step__") {
      return -1;
    }

    const leftDate = left.step && left.step.Start_Date_Time ? left.step.Start_Date_Time : left.dayValue;
    const rightDate = right.step && right.step.Start_Date_Time ? right.step.Start_Date_Time : right.dayValue;

    if (leftDate === rightDate) {
      return String(left.step && left.step.Name || "").localeCompare(String(right.step && right.step.Name || ""));
    }

    return String(leftDate || "").localeCompare(String(rightDate || ""));
  });

  state.groupedRows = groupedEntries.map(function (entry) {
    const services = entry.services;
    return {
      stepId: entry.stepId,
      step: entry.step,
      services: services,
      dayKey: entry.dayKey,
      dayValue: entry.dayValue,
      totalSales: services.reduce(function (sum, service) {
        return sum + (Number(service.Total_Sales_Price) || 0);
      }, 0),
      totalPurchase: services.reduce(function (sum, service) {
        return sum + (Number(service.Total_Purchase_Price) || 0);
      }, 0)
    };
  });
}
