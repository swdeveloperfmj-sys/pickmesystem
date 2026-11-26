import { SmsNotification, User } from "./models.js";
import { canApprove, canBook } from "./sop.js";

export function normalizeMobile(value = "") {
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^07\d{8}$/.test(digits)) digits = `94${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) digits = `94${digits}`;
  return /^947\d{8}$/.test(digits) ? digits : null;
}

const labels = {
  SUBMITTED: "submitted", RESUBMITTED: "resubmitted", APPROVE: "approved",
  REJECT: "rejected", RETURN: "returned for correction", START_BOOKING: "booking started",
  BOOK: "booked", COMPLETE_BOOKING: "completed", COMPLETE: "completed",
  CANCEL: "cancelled", CONFIRM_CANCEL: "cancellation confirmed",
  REQUEST_CHANGE: "change requested", CONFIRM_CHANGE: "returned for correction",
  REPORT_ISSUE: "issue reported",
};

export function smsMessage(record, action, audience) {
  let state = labels[action];
  if (["SUBMITTED", "RESUBMITTED"].includes(action) && record.status === "APPROVED") state = "automatically approved";
  if (record.status === "CANCELLATION_REQUESTED") state = "cancellation requested";
  const next = audience === "approver" && record.status === "PENDING_APPROVAL" ? "Please review in CTMS."
    : audience === "booking" && record.status === "APPROVED" && !record.bookingStartedAt ? "Please arrange booking in CTMS."
    : audience === "booking" && ["REQUEST_CHANGE", "CANCEL", "REPORT_ISSUE"].includes(action) ? "Please review in CTMS."
    : audience === "requester" && record.status === "RETURNED" ? "Please correct and resubmit in CTMS."
    : "View details in CTMS.";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(record.pickupAt);
  return `CTMS ${record.service} #${String(record._id).slice(-8)}: ${state}. Pickup ${time} (SL). ${next}`;
}

export async function queueTransportSms(record, action, config, session) {
  if (!config.TEXTWARE_SMS_ENABLED) return;
  const approvers = [record.approver, ...(record.approvers || [])].filter(Boolean).map(String);
  const submission = ["SUBMITTED", "RESUBMITTED"].includes(action);
  const notifyBooking = record.status === "APPROVED" ||
    ["BOOK", "COMPLETE_BOOKING", "COMPLETE", "CONFIRM_CANCEL", "REQUEST_CHANGE", "CONFIRM_CHANGE", "REPORT_ISSUE"].includes(action) ||
    (action === "CANCEL" && record.history.some((entry) => ["APPROVE", "AUTO_APPROVED", "BOOK"].includes(entry.action)));
  const users = await User.find({ isActive: true, status: "ACTIVE", role: { $ne: "SUPER_ADMIN" },
    $or: [{ _id: { $in: [record.requester, ...approvers] } }, ...(notifyBooking ? [
      { sidebarAccess: "BOOKINGS" }, { sidebarAccess: { $exists: false }, role: "OPERATOR" },
    ] : [])],
  }).session(session);
  const seen = new Set();
  const jobs = [];
  // Requester first so overlapping accounts/numbers receive one message per event.
  users.sort((a, b) => Number(String(b._id) === String(record.requester)) - Number(String(a._id) === String(record.requester)));
  for (const user of users) {
    const audience = String(user._id) === String(record.requester) ? "requester"
      : approvers.includes(String(user._id)) && canApprove(user) && (!submission || record.status === "PENDING_APPROVAL") ? "approver"
      : notifyBooking && canBook(user) ? "booking" : null;
    if (!audience) continue;
    const to = normalizeMobile(user.contact);
    if (to && seen.has(to)) continue;
    if (to) seen.add(to);
    jobs.push({ request: record._id, version: record.version, recipient: user._id, audience, action, to,
      message: smsMessage(record, action, audience), status: to ? "PENDING" : "SKIPPED",
      outcome: to ? undefined : "INVALID_MOBILE" });
  }
  if (jobs.length) await SmsNotification.insertMany(jobs, session ? { session } : {});
}

export function createSmsSender(config, fetchImpl = fetch) {
  return async ({ to, message }) => {
    const response = await fetchImpl(config.TEXTWARE_SMS_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: config.TEXTWARE_SMS_USERNAME,
        password: config.TEXTWARE_SMS_PASSWORD, src: config.TEXTWARE_SMS_SENDER_ID,
        dst: to, msg: message }),
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
    if (!response.ok) throw new Error("SMS_RESPONSE_UNKNOWN");
    const result = (await response.text()).trim();
    if (!result) throw new Error("SMS_RESPONSE_UNKNOWN");
    if (/^(error|failed|failure|denied|invalid|insufficient|unauthori[sz]ed)\b/i.test(result)) return "FAILED";
    return "ACCEPTED";
  };
}

export async function processSmsQueue(send, limit = 20) {
  // An interrupted send may have reached the provider. Do not automatically duplicate it.
  await SmsNotification.updateMany({ status: "SENDING", attemptedAt: { $lt: new Date(Date.now() - 60000) } },
    { $set: { status: "UNKNOWN", outcome: "INTERRUPTED_SEND" } });
  for (let i = 0; i < limit; i++) {
    const job = await SmsNotification.findOneAndUpdate({ status: "PENDING" },
      { $set: { status: "SENDING", attemptedAt: new Date() } }, { sort: { createdAt: 1 }, returnDocument: "after" });
    if (!job) break;
    const user = await User.findById(job.recipient);
    const allowed = user && user.isActive && user.status === "ACTIVE" && user.role !== "SUPER_ADMIN" &&
      (job.audience === "requester" || (job.audience === "approver" ? canApprove(user) : canBook(user)));
    const to = allowed && normalizeMobile(user.contact);
    if (!to) {
      await SmsNotification.updateOne({ _id: job._id }, { $set: { status: "SKIPPED", outcome: "RECIPIENT_UNAVAILABLE" } });
      continue;
    }
    let status;
    try { status = await send({ to, message: job.message }); }
    catch { status = "UNKNOWN"; }
    await SmsNotification.updateOne({ _id: job._id }, { $set: { status, to,
      outcome: status === "ACCEPTED" ? "PROVIDER_ACCEPTED" : status === "FAILED" ? "PROVIDER_REJECTED" : "DELIVERY_UNCERTAIN" } });
  }
}

export function startSmsWorker(config) {
  if (!config.TEXTWARE_SMS_ENABLED) {
    console.log("SMS notifications disabled. Configure TEXTWARE_SMS_ENABLED to enable.");
    return async () => {};
  }
  const send = createSmsSender(config);
  let running;
  const tick = () => {
    if (!running) running = processSmsQueue(send).catch(() => console.error("SMS queue processing failed.")).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  tick();
  return async () => { clearInterval(timer); await running; };
}
