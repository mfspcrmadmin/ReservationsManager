export const MODULES = {
  bookings: "Deals",
  bookingServices: "Booking_Services",
  bookingSteps: "Booking_Steps",
  userRelationships: "User_Relationships",
  paymentAccounts: "Payment_Accounts",
  pax: "PAX",
  paxBookingServices: "PAX_Booking_Services"
};

export const SERVICE_TABLE_COLUMNS_STORAGE_KEY = "reservationsManager.serviceTableColumns";

export const SERVICE_TABLE_COLUMNS = [
  {
    key: "name",
    label: "Sequence"
  },
  {
    key: "date",
    label: "Date"
  },
  {
    key: "serviceDateTime",
    label: "Service Date Time"
  },
  {
    key: "status",
    label: "Status"
  },
  {
    key: "serviceName",
    label: "Service Name"
  },
  {
    key: "supplier",
    label: "Supplier"
  },
  {
    key: "paxNumber",
    label: "PAX Number"
  },
  {
    key: "step",
    label: "Step"
  },
  {
    key: "destination",
    label: "Destination"
  },
  {
    key: "subdestination",
    label: "Subdestination"
  },
  {
    key: "category",
    label: "Category"
  },
  {
    key: "subcategory",
    label: "Subcategory"
  },
  {
    key: "purchase",
    label: "Purchase"
  },
  {
    key: "sales",
    label: "Sales"
  },
  {
    key: "serviceNotes",
    label: "Service Notes"
  }
];

export const STATUS_OPTIONS = [
  "-None-",
  "Unassigned",
  "On Request",
  "Blocked",
  "Alert",
  "Optional",
  "Pre-Paid",
  "Confirmed",
  "Cancelled",
  "Cancelled with Charges",
  "Email Draft Created",
  "Pre-Payment Requested",
  "Partially Pre-Paid",
  "Availability Draft Created",
  "NBTM-Confirmed"
];
