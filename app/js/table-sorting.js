import { bookingTagSortText } from "./booking-tags.js";
import { escapeHtml, getServiceSupplierName, getLookupName, getStepDisplayName } from "./utils.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const empty = value => value === null || value === undefined || value === "" || value === "-" || value === "-None-";
const number = value => empty(value) || !Number.isFinite(Number(value)) ? null : Number(value);
const date = value => empty(value) || !Number.isFinite(Date.parse(value)) ? null : Date.parse(value);

export function sortTableRows(rows, sort, valueFor) {
  if (!sort?.key) return rows;
  return rows.slice().sort((left, right) => {
    const a = valueFor(left, sort.key), b = valueFor(right, sort.key);
    if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
    const comparison = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
    return sort.direction === "desc" ? -comparison : comparison;
  });
}

export function nextTableSort(sort, key) {
  return { key, direction: sort?.key === key && sort.direction === "asc" ? "desc" : "asc" };
}

export function sortableHeader(column, sort, className = "") {
  const active = sort?.key === column.key;
  const direction = active ? (sort.direction === "desc" ? "descending" : "ascending") : "none";
  return '<th scope="col" class="' + escapeHtml(className) + '" data-service-column-key="' + escapeHtml(column.key) + '" aria-sort="' + direction + '"><button type="button" class="table-sort-button" data-table-sort="' + escapeHtml(column.key) + '" title="Sort ' + escapeHtml(column.label) + (active && sort.direction === "asc" ? ' descending' : ' ascending') + '"><span>' + escapeHtml(column.label) + '</span><span class="table-sort-indicator" aria-hidden="true">' + (active ? sort.direction === "desc" ? '&#9662;' : '&#9652;' : '&#8597;') + '</span></button></th>';
}

export function bindTableSort(head, onSort) {
  head.querySelectorAll("[data-table-sort]").forEach(button => {
    button.onclick = () => onSort(button.dataset.tableSort);
  });
}

export function serviceSortValue(service, key, state) {
  const fields = { name: "Name", serviceName: "Product_Description", destination: "Destination", subdestination: "Subdestination", category: "Category", subcategory: "Subcategory", status: "Status_EZUS", paymentStatus: "Payment_Status", paymentMethod: "Payment_Method" };
  if (key === "supplier") return getServiceSupplierName(service);
  if (key === "date") return date(service.Service_Date);
  if (key === "serviceDateTime") return date(service.Service_Date_Time);
  if (key === "sales") return number(service.Total_Sales_Price);
  if (key === "purchase") return number(service.Total_Purchase_Price);
  if (key === "paxNumber") return number(service.Number_of_Pax !== undefined ? service.Number_of_Pax : service.PAX_Number);
  if (key === "step") return getStepDisplayName(state.stepIndex?.[service.Step?.id] || service.Step);
  return service[fields[key]];
}

export function queueSortValue(booking, key, state) {
  if (key === "tasks") return number(state.queueTaskCounts?.[booking.id]);
  if (key === "salesTags" || key === "reservationsTags") return bookingTagSortText(booking, key === "salesTags" ? "Sales_Tags_JSON" : "Reservations_Tags_JSON");
  const fields = { booking: "Deal_Name", mfsp: "MFSP_Reference", stage: "Stage" };
  if (key === "arrival") return date(booking.Arrival_Date);
  if (key === "departure") return date(booking.Departure_Date);
  if (key === "travelers") return number(booking.Travelers_Number);
  if (key === "sales") return number(booking.Sales_Price);
  if (key === "agency") return getLookupName(booking.Account_Name);
  if (key === "contact") return getLookupName(booking.Primary_Contact);
  if (key === "sync") return date(booking.Last_Ezus_Sync_At || booking.Last_EZUS_Sync_At || booking["Last EZUS Sync At"]);
  if (key === "desk") return date(state.queueDeskSortValues?.[booking.id]);
  return booking[fields[key]];
}
