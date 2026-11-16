(async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET" });
  if (!response?.data) return;
  const data = response.data;
  const host = document.createElement("div");
  host.id = "ctms-pickme-helper";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host{font:13px/1.5 Arial,sans-serif;color:#17202a}section{background:white;border:2px solid #e3b500;border-radius:12px;padding:16px;width:320px;max-width:85vw;max-height:65vh;overflow:auto;box-shadow:0 8px 32px #0004}h3{margin:0 0 8px}p{margin:8px 0}button{cursor:pointer;padding:6px 9px;margin:4px 4px 4px 0;background:#fff6cc;border:1px solid #aa8700;border-radius:5px;color:#17202a}strong{display:block}span{overflow-wrap:anywhere}.row{border-top:1px solid #ddd;padding:6px 0}.status{background:#fff6cc;padding:8px}.close{float:right}
  </style><section><button class="close" type="button">Close & clear</button><h3>CTMS booking details</h3><p class="status" role="status"></p><div class="details"></div><p>Select the correct pickup/drop suggestions on the map. Check the vehicle, department and scheduled pickup time before BOOK NOW. CTMS has not booked this ride.</p><button class="retry" type="button">Fill available fields again</button></section>`;
  document.documentElement.append(host);
  const status = root.querySelector(".status");
  const completed = new Set();
  const touched = new WeakSet();
  document.addEventListener("input", event => { if (event.isTrusted) touched.add(event.target); }, true);
  const rules = {
    phone: /phone\s*(number)?|mobile/i,
    name: /passenger.?s?\s*name|^name\s*\*?$/i,
    pickup: /pick\s*up\s*(location|address)|pickup/i,
    destination: /drop\s*(location|off|address)|enter stop|destination/i,
    department: /department/i,
  };
  function findField(key) {
    return [...document.querySelectorAll("input,textarea,select")].find(el => {
      if (!el.getClientRects().length || el.disabled || el.readOnly || ["hidden", "password", "submit", "button", "checkbox", "radio"].includes(el.type)) return false;
      const labels = [...(el.labels || [])].map(label => label.textContent).join(" ");
      return [el.placeholder, el.getAttribute("aria-label"), labels, el.name, el.id].some(value => value && rules[key].test(value.trim()));
    });
  }
  function fill(key, force = false) {
    if (!data[key] || (!force && completed.has(key))) return false;
    const field = findField(key);
    if (!field || (!force && touched.has(field))) return false;
    let value = data[key];
    if (field instanceof HTMLSelectElement) {
      const option = [...field.options].find(option => option.textContent.trim().toLowerCase() === value.toLowerCase());
      if (!option) return false;
      value = option.value;
    }
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    completed.add(key);
    return true;
  }
  function fillAll(force = false) {
    if (!location.pathname.startsWith("/booknow/rides")) { status.textContent = "Sign in to PickMe, then open Book a Ride. Your details stay in this tab for up to 30 minutes."; return; }
    for (const key of Object.keys(rules)) fill(key, force);
    status.textContent = completed.size ? `Entered ${[...completed].join(", ")}. Review every value in PickMe; locations still need confirmation.` : "Waiting for the booking form. Use Fill or Copy below if a field cannot be detected.";
  }
  for (const [key, title] of [["name", "Passenger"], ["phone", "Phone"], ["pickup", "Pickup"], ["stopover", "Stopover"], ["destination", "Destination"], ["department", "Department"], ["vehicle", "Vehicle"], ["passengerCount", "Passengers"], ["pickupAt", "Pickup time"]]) {
    if (!data[key]) continue;
    const row = document.createElement("div"); row.className = "row";
    const label = document.createElement("strong"); label.textContent = title;
    const value = document.createElement("span");
    value.textContent = key === "pickupAt" ? new Date(data[key]).toLocaleString("en-GB", { timeZone: "Asia/Colombo" }) + " (Sri Lanka)" : String(data[key]);
    row.append(label, value, document.createElement("br"));
    if (rules[key]) {
      const button = document.createElement("button"); button.textContent = "Fill";
      button.onclick = () => { status.textContent = fill(key, true) ? `${title} entered. Check it in PickMe.` : `${title} is unavailable or locked. Complete the phone lookup first, or copy the value.`; };
      row.append(button);
    }
    const copy = document.createElement("button"); copy.textContent = "Copy";
    copy.onclick = async () => { try { await navigator.clipboard.writeText(value.textContent); status.textContent = `${title} copied.`; } catch { status.textContent = "Copy was blocked. Select and copy the displayed value manually."; } };
    row.append(copy); root.querySelector(".details").append(row);
  }
  fillAll();
  // Give asynchronous phone lookups time to unlock the name without overwriting user edits.
  let attempts = 0;
  const timer = setInterval(() => { fillAll(); if (++attempts >= 30) clearInterval(timer); }, 1000);
  root.querySelector(".retry").onclick = () => fillAll(true);
  root.querySelector(".close").onclick = async () => { clearInterval(timer); await chrome.runtime.sendMessage({ type: "CLEAR" }); host.remove(); };
})();
