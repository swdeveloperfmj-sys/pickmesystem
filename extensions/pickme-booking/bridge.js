(() => {
  if (!["http://localhost:5173", "http://127.0.0.1:5173", "https://rb0jihspcn0qybjtcojyjsbn.179.197.255.234.sslip.io"].includes(location.origin)) return;
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ctms-booking" || event.data.type !== "OPEN") return;
    let result;
    try { result = await chrome.runtime.sendMessage({ type: "OPEN", payload: event.data.payload }); }
    catch { result = { ok: false, error: "Reload the CTMS page after enabling the booking extension." }; }
    window.postMessage({ source: "ctms-booking-extension", id: event.data.id, ...result }, location.origin);
  });
})();
