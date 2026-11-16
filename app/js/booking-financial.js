import { escapeHtml, formatCurrency } from "./utils.js";

function amount(value) {
  if (value == null || typeof value === "boolean" || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function isFinancialOverdue(booking, now = new Date()) {
  if (!(amount(booking.Balance_Amount) > 0) || !calendarDate(booking.Balance_due_date)) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return booking.Balance_due_date < `${part("year")}-${part("month")}-${part("day")}`;
}

export function renderBookingFinancial(booking, grossMargin, netMargin, now = new Date()) {
  const money = value => amount(value) === null ? "—" : formatCurrency(amount(value), booking.Currency || "EUR", { useGrouping: true });
  const metric = (label, value, margin = false, primary = false, badge = "") => {
    const negative = margin && amount(value) < 0;
    return '<div class="financial-metric' + (primary ? ' financial-metric--primary' : '') + (negative ? ' financial-metric--negative' : '') + '"><dt>' + label + '</dt><dd><strong>' + escapeHtml(money(value)) + '</strong>' + (negative ? '<span class="financial-status">Negative margin</span>' : '') + badge + '</dd></div>';
  };
  const date = calendarDate(booking.Balance_due_date);
  const dueDate = date ? '<time datetime="' + booking.Balance_due_date + '">' + escapeHtml(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)) + '</time>' : '—';
  const overdue = isFinancialOverdue(booking, now) ? '<span class="financial-status">Overdue</span>' : '';
  return '<section class="booking-financial summary-section" aria-labelledby="financial-snapshot-title"><div class="summary-section-header"><h2 id="financial-snapshot-title">Financial snapshot</h2></div><div class="financial-cards">' +
    '<section class="financial-card"><h3>Revenue</h3><dl class="financial-headline financial-pair">' + metric("Net Margin", netMargin, true, true) + metric("Gross Margin", grossMargin, true) + '</dl><dl class="financial-details financial-pair">' +
    metric("Sales Price", booking.Sales_Price_inc_Taxes) + metric("Purchase Price", booking.Purchase_Price_inc_Taxes) + '</dl></section>' +
    '<section class="financial-card"><h3>Payments</h3><dl class="financial-headline">' + metric("Balance Amount", booking.Balance_Amount, false, true, overdue) +
    '<div class="financial-due-date"><dt>Balance Due Date</dt><dd>' + dueDate + '</dd></div></dl><dl class="financial-details">' +
    metric("Total Requested Amount", booking.Total_Requested_Amount) + metric("Total Paid Amount", booking.Paid_Amount) + metric("Total Refund Amount", booking.Total_Refund_Amount) + '</dl></section></div></section>';
}
