import { crmGetRecord } from "./api.js";

export async function requireSupplierPaymentReference(supplierId) {
  let supplier;
  try {
    supplier = await crmGetRecord("Vendors", supplierId);
  } catch (_) {
    throw new Error("Could not verify the supplier's Connection Reference. Please try again before recording a card purchase or requesting a prepayment.");
  }
  if (!supplier) throw new Error("Could not load the associated supplier. Please try again before recording a card purchase or requesting a prepayment.");
  const reference = String(supplier.TP_Reference ?? "").trim();
  if (!reference) {
    throw new Error("The associated supplier has no Connection Reference (TP_Reference). Complete this field on the supplier record before recording a card purchase or requesting a prepayment.");
  }
  return reference;
}
