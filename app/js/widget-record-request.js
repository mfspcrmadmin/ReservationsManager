// Keep privileged v8 credentials on the server. Only the bounded request
// contract is serialized; URLs, headers and authentication context stay out.
export async function invokeWidgetRecordRequest(module, recordId, request) {
  const functions = globalThis.window?.ZOHO?.CRM?.FUNCTIONS;
  if (!functions?.execute) throw new Error("The authenticated record API is unavailable. Reload the widget.");
  const data = {
    module, recordId: String(recordId), method: request.method,
    // The published gateway validates the file projection for reads and writes.
    ...(request.method === "GET" ? { fields: request.parameters?.fields || "" } : {
      ...(module === "Prepayment_Requests" ? { fields: "Proforma_Attached" } :
        module === "Communications" ? { fields: "Email_Attachments" } : {}),
      payload: request.parameters?.data?.[0]
    }),
    ...(request.headers?.["If-Unmodified-Since"] ? { modifiedTime: request.headers["If-Unmodified-Since"] } : {})
  };
  let result = await functions.execute("widget_recordlease", {
    arguments: JSON.stringify({ action: "record_request", requestBody: JSON.stringify(data) })
  });
  for (let depth = 0; depth < 8; depth++) {
    if (typeof result === "string") { result = JSON.parse(result); continue; }
    if (String(result?.status || "").toLowerCase() === "error" ||
        (result?.code && String(result.code).toUpperCase() !== "SUCCESS")) return result;
    const output = result?.details?.output;
    if (output === undefined) return result;
    result = output;
  }
  throw new Error("CRM returned an unreadable record result. Check CRM before trying again.");
}
