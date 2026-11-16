import { crmGetRecord, crmExecuteFunction } from "./api.js";

const lookupId = value => String(value?.id || "").trim();

// Always read CRM: services cached before synchronization may lack their new lookup.
export async function resolvePaymentSettlement(bookingId, supplierId, services, deps = {}) {
  const read = deps.read || crmGetRecord;
  const execute = deps.execute || crmExecuteFunction;
  const pause = deps.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const waiting = deps.waiting || (() => {});
  const deadline = Date.now() + (deps.timeoutMs || 90000);
  async function bounded(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("No se ha podido confirmar la creación del settlement a tiempo. No se ha guardado el pago. Vuelve a intentarlo en unos momentos.")), Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  async function inspect() {
    if (!services.length) throw new Error("Selecciona al menos un servicio.");
    const records = [];
    for (const service of services) {
      const record = await bounded(read("Booking_Services", service.id));
      if (!record?.id || lookupId(record.Booking) !== String(bookingId) || lookupId(record.Supplier) !== String(supplierId)) {
        throw new Error("No se pudo verificar el viaje y proveedor de los servicios. Actualiza el viaje antes de continuar.");
      }
      records.push(record);
    }
    const ids = records.map(record => lookupId(record.Supplier_Settlement));
    if (ids.some(id => !id)) return null;
    if (new Set(ids).size !== 1) throw new Error("Los servicios seleccionados tienen settlements distintos. Revisa sus asociaciones antes de continuar.");
    const settlement = await bounded(read("Supplier_Settlements", ids[0]));
    if (!settlement?.id || lookupId(settlement.Booking) !== String(bookingId) || lookupId(settlement.Supplier) !== String(supplierId) || settlement.Settlement_Type !== "Supplier Services") {
      throw new Error("El settlement asociado no corresponde a este viaje y proveedor. Contacta con Administración.");
    }
    return ids[0];
  }
  let id = await inspect();
  if (id) return id;
  waiting();
  for (;;) {
    const response = await bounded(execute("recalculatesuppliersettlementsforbooking", { bookingId: "recover:" + bookingId }));
    let output = response?.details?.output;
    if (typeof output === "string") { try { output = JSON.parse(output); } catch (_) { output = null; } }
    const busy = output?.error === true && /already running|Recovery blocked by recent modification|Recovery blocked by lock expiry/i.test(output.message || "");
    if (output?.error !== false && !busy) throw new Error(output?.message || "CRM no ha confirmado la creación del settlement.");
    // A lookup can appear before totals and queue reconciliation finish.
    // Keep the modal open until the calculation itself confirms success.
    if (busy) {
      await bounded(pause(3000));
      continue;
    }
    id = await inspect();
    if (id) return id;
    throw new Error("El cálculo terminó, pero los servicios siguen sin settlement asociado. Contacta con Administración.");
  }
}

export async function requirePaymentSettlement(bookingId, supplierId, services) {
  const dialog = document.createElement("dialog");
  dialog.className = "payment-settlement-dialog";
  dialog.innerHTML = '<h3>Recalculando settlement</h3><div class="payment-settlement-progress" role="status"><span class="booking-browser-sync-spinner" aria-hidden="true"></span><p data-message>Estamos recalculando el settlement de este viaje y actualizando la cola de Administración. El registro del pago continuará automáticamente cuando termine. Espera sin cerrar esta ventana.</p></div><button type="button" class="button tertiary compact" hidden>Cerrar</button>';
  let failed = false;
  dialog.addEventListener("cancel", event => { if (!failed) event.preventDefault(); });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("button").addEventListener("click", () => dialog.close());
  function show() {
    if (!dialog.isConnected) { document.body.appendChild(dialog); dialog.showModal(); }
  }
  try {
    const id = await resolvePaymentSettlement(bookingId, supplierId, services, { waiting: show });
    dialog.remove();
    return id;
  } catch (error) {
    failed = true;
    show();
    dialog.querySelector("h3").textContent = "No se pudo preparar el settlement";
    dialog.querySelector(".booking-browser-sync-spinner").hidden = true;
    dialog.querySelector("[role=status]").setAttribute("role", "alert");
    dialog.querySelector("[data-message]").textContent = error.message || String(error);
    const close = dialog.querySelector("button");
    close.hidden = false;
    close.focus();
    throw error;
  }
}
