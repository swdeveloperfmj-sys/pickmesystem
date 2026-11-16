export function openPickMeBooking(record) {
  if (record.service !== "RIDE") return Promise.reject(new Error("The PickMe helper currently supports Ride requests. Book Flash deliveries manually."));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("Install the CTMS PickMe Booking Helper extension, then refresh this page and try again.")); }, 5000);
    function cleanup() { clearTimeout(timer); window.removeEventListener("message", receive); }
    function receive(event) {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ctms-booking-extension" || event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(); else reject(new Error(event.data.error || "Could not open PickMe."));
    }
    window.addEventListener("message", receive);
    window.postMessage({ source: "ctms-booking", type: "OPEN", id, payload: {
      id: record.id, service: record.service, status: record.status,
      name: record.requesterDetails.fullName, phone: record.requesterDetails.contact,
      pickup: record.pickup, destination: record.destination, stopover: record.stopover || "",
      department: record.requesterDetails.department || "", vehicle: record.vehicle,
      pickupAt: record.pickupAt, passengerCount: record.passengerCount,
    } }, location.origin);
  });
}
