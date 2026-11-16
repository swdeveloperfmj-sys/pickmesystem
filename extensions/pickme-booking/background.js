const origins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const bookingUrl = "https://business.pickme.lk/booknow/rides";
const ttl = 30 * 60 * 1000;
function validate(payload) {
  if (!payload || payload.service !== "RIDE" || payload.status !== "APPROVED") throw new Error("Select an approved Ride request.");
  const result = {};
  for (const key of ["id", "name", "phone", "pickup", "destination", "stopover", "department", "vehicle", "pickupAt"]) {
    if (typeof payload[key] !== "string" || payload[key].length > 500) throw new Error("Invalid booking details.");
    result[key] = payload[key].trim();
  }
  if (!["id", "name", "phone", "pickup", "destination"].every(key => result[key])) throw new Error("Passenger and route details are required.");
  result.passengerCount = payload.passengerCount;
  if (!Number.isInteger(result.passengerCount) || result.passengerCount < 1 || result.passengerCount > 10) throw new Error("Invalid passenger count.");
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (!sender.tab || sender.frameId !== 0) throw new Error("Unsupported sender.");
    const url = new URL(sender.url);
    if (message.type === "OPEN") {
      if (!origins.has(url.origin)) throw new Error("CTMS origin is not allowed.");
      const data = validate(message.payload);
      const tab = await chrome.tabs.create({ url: "about:blank" });
      try {
        await chrome.storage.session.set({ [String(tab.id)]: { data, expires: Date.now() + ttl } });
        await chrome.tabs.update(tab.id, { url: bookingUrl });
      } catch (error) {
        await chrome.storage.session.remove(String(tab.id));
        await chrome.tabs.remove(tab.id);
        throw error;
      }
      return { ok: true };
    }
    if (url.origin !== "https://business.pickme.lk") throw new Error("PickMe origin is required.");
    const key = String(sender.tab.id);
    if (message.type === "CLEAR") { await chrome.storage.session.remove(key); return { ok: true }; }
    if (message.type !== "GET") throw new Error("Unsupported message.");
    const entry = (await chrome.storage.session.get(key))[key];
    if (!entry || entry.expires < Date.now()) {
      await chrome.storage.session.remove(key);
      return { ok: true, data: null };
    }
    return { ok: true, data: entry.data };
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => { chrome.storage.session.remove(String(id)); });
