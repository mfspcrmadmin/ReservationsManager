export const MODULES = {
  bookings: "Deals",
  bookingServices: "Booking_Services",
  bookingSteps: "Booking_Steps",
  userRelationships: "User_Relationships",
  paymentAccounts: "Payment_Accounts",
  cardPurchases: "Card_Purchases",
  prepaymentRequests: "Prepayment_Requests",
  prepaymentRequestServices: "Prepayment_Request_Services",
  prepayments: "Prepayments",
  prepaymentInvoiceAllocations: "Prepayment_Invoice_Allocations",
  pax: "PAX",
  paxBookingServices: "PAX_Booking_Services"
};

export const SERVICE_TABLE_COLUMNS_STORAGE_KEY = "bookingsManager.serviceTableColumns";

export const SERVICE_TABLE_COLUMNS = [
  {
    key: "name",
    label: "Seq"
  },
  {
    key: "date",
    label: "Service date"
  },
  {
    key: "serviceDateTime",
    label: "Service date & time"
  },
  {
    key: "status",
    label: "Status"
  },
  {
    key: "paymentStatus",
    label: "Payment Status"
  },
  {
    key: "paymentMethod",
    label: "Payment Method"
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
  }
];

export const STATUS_OPTIONS = [
  "-None-",
  "Unassigned",
  "On Request",
  "Blocked",
  "Alert",
  "Optional",
  "Confirmed",
  "Cancelled",
  "Cancelled with Charges",
  "Email Draft Created",
  "Availability Draft Created",
  "NBTM-Confirmed"
];
