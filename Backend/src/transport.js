import express from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { User, Department, TransportRequest } from "./models.js";
import { sopConfig, transportPermissions, canRequest, canApprove, canBook, eligibleVehicles } from "./sop.js";
import { sidebarAccess, hasAccess, assignedApproverAllowed } from "./access.js";

const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID");
const text = z.string().trim().min(2).max(500);
const contact = z.string().trim().max(30).regex(/^\+?[\d\s().-]+$/).refine((value) => { const count = value.replace(/\D/g, "").length; return count >= 7 && count <= 15; });
const requestInput = z.object({
  service: z.enum(["RIDE", "FLASH"]), approverId: id,
  requesterDesignation: z.string().trim().max(100).default(""), requesterContact: contact, departmentId: id, workLocation: text, approverDesignation: text,
  passengerCount: z.number().int().min(0).max(10),
  pickupAt: z.iso.datetime({ offset: true }), pickup: text, stopover: z.string().trim().max(500).default(""), destination: text,
  vehicle: z.enum(sopConfig.vehicles), deliveryRoute: z.enum(["BETWEEN_FACTORIES", "CUSTOMER_DELIVERY", "OTHER"]).default("OTHER"),
  purpose: text, justification: z.string().trim().max(500).default(""),
  passengers: z.array(z.object({ name: text, designation: z.string().trim().max(100).default("") }).strict()).max(10).default([]),
  receiverName: z.string().trim().max(100).default(""), receiverContact: z.string().trim().max(30).default(""), itemDetails: z.string().trim().max(500).default(""),
  groupCarEligible: z.boolean().default(false),
  version: z.number().int().min(0).optional(),
}).strict();
const actionInput = z.object({
  action: z.enum(["APPROVE", "REJECT", "RETURN", "BOOK", "COMPLETE", "CANCEL", "CONFIRM_CANCEL", "REQUEST_CHANGE", "CONFIRM_CHANGE", "REPORT_ISSUE"]),
  version: z.number().int().min(0), note: z.string().trim().max(1000).default(""),
  approvalShared: z.boolean().optional(), externalActionConfirmed: z.boolean().optional(),
  bookingReference: z.string().trim().max(100).optional(), driverDetails: z.string().trim().max(500).optional(),
  routeVerified: z.boolean().optional(), completionMessageChecked: z.boolean().optional(),
}).strict();
const active = (user) => user && user.isActive && user.status === "ACTIVE";
const staffProfile = (user, department) => ({ id: user.id, fullName: user.fullName, username: user.username, contact: user.contact || "", role: user.role, sidebarAccess: sidebarAccess(user), departmentId: department?.id || "", department: department?.name || "", permissions: transportPermissions(user), sopAcknowledgedAt: user.sopAcknowledgedAt });
const publicRequest = (record) => ({ ...record.toObject(), id: record.id });
const event = (user, action, note = "") => ({ action, actor: user._id, actorName: user.fullName, at: new Date(), note });
const notice = (pickup) => { if (new Date(pickup).getTime() - Date.now() < 30 * 60000) fail(400, "The request and approval must be shared at least 30 minutes before pickup. Choose a later pickup time."); };
function whatsapp(record) {
  const person = record.requesterDetails;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }).format(record.pickupAt);
  const rows = ["FMJ Corporate Transport", `Service: PickMe ${record.service === "RIDE" ? "Ride" : "Flash"}`,
    `Requester: ${person.fullName} | ${person.designation} | ${person.contact}`, `Department: ${person.department}`, `Location: ${person.workLocation}`,
    `Approver: ${record.approverDetails.fullName} | ${record.approverDetails.designation}`, `Pickup: ${time} (Sri Lanka)`,
    `Pickup location: ${record.pickup}`, `Stopover: ${record.stopover || "None"}`, `Destination: ${record.destination}`, `Vehicle: ${record.vehicle.replaceAll("_", " ")}`,
    `Official purpose / justification: ${record.purpose || record.justification}`];
  if (record.service === "RIDE") rows.push(`Passengers (${record.passengers.length}): ${record.passengers.map((person) => `${person.name} (${person.designation})`).join(", ")}`);
  else rows.push(`Receiver: ${record.receiverName} | ${record.receiverContact}`, `Items/samples: ${record.itemDetails}`);
  if (record.approvalSharedAt) rows.push(`Approved by: ${record.approverDetails.fullName}`, `Approval recorded: ${record.approvalSharedAt.toISOString()}`);
  return rows.join("\n");
}

export function registerTransport(app, { config, requireSuperAdmin }) {
  const dummyHash = bcrypt.hashSync(randomUUID(), 12);
  app.post("/api/transport/auth/login", rateLimit({ windowMs: 15 * 60000, limit: 10 }), async (req, res) => {
    const body = z.object({ username: z.string().trim().toLowerCase().min(1).max(40), password: z.string().min(1).max(200) }).strict().parse(req.body);
    const user = await User.findOne({ username: body.username }).select("+passwordHash");
    const valid = await bcrypt.compare(body.password, user?.passwordHash || dummyHash);
    if (!valid || !active(user) || user.role === "SUPER_ADMIN") fail(401, "Invalid credentials or account unavailable.");
    const token = jwt.sign({ role: user.role }, config.JWT_SECRET, { subject: user.id, expiresIn: config.JWT_EXPIRES_IN, issuer: "ctms", audience: "ctms-staff", algorithm: "HS256" });
    const { exp } = jwt.decode(token);
    res.cookie("ctms_staff", token, { httpOnly: true, secure: config.NODE_ENV === "production", sameSite: "strict", path: "/api/transport", maxAge: Math.max(0, exp * 1000 - Date.now()) });
    res.json({ user: staffProfile(user) });
  });
  async function requireStaff(req, _res, next) {
    try {
      const payload = jwt.verify(req.cookies.ctms_staff || "", config.JWT_SECRET, { issuer: "ctms", audience: "ctms-staff", algorithms: ["HS256"] });
      const user = await User.findById(payload.sub);
      if (!active(user) || user.role === "SUPER_ADMIN" || user.role !== payload.role) throw new Error("account");
      req.user = user;
      next();
    } catch { next(Object.assign(new Error("Staff sign-in is required."), { status: 401 })); }
  }
  const router = express.Router();
  router.get("/me", async (req, res) => res.json({ user: staffProfile(req.user, req.user.department && await Department.findById(req.user.department)) }));
  router.post("/auth/logout", (_req, res) => {
    res.clearCookie("ctms_staff", { httpOnly: true, secure: config.NODE_ENV === "production", sameSite: "strict", path: "/api/transport" });
    res.sendStatus(204);
  });
  router.get("/config", (_req, res) => res.json(sopConfig));
  router.get("/departments", async (_req, res) => res.json({ departments: (await Department.find().sort({ name: 1 })).map((department) => ({ id: department.id, name: department.name })) }));
  router.post("/acknowledge", async (req, res) => {
    z.object({ acknowledged: z.literal(true) }).strict().parse(req.body);
    const user = await User.findByIdAndUpdate(req.user._id, { $set: { sopAcknowledgedAt: new Date() } }, { returnDocument: "after" });
    res.json({ user: staffProfile(user, user.department && await Department.findById(user.department)) });
  });
  router.get("/approvers", async (req, res) => {
    const users = await User.find({ isActive: true, status: "ACTIVE", role: { $ne: "SUPER_ADMIN" }, $or: [{ sidebarAccess: "APPROVALS" }, { sidebarAccess: { $exists: false }, role: { $in: ["MANAGER", "ADMIN"] } }] });
    res.json({ approvers: users.filter((user) => canApprove(user) && user.id !== req.user.id && assignedApproverAllowed(req.user, user)).map((user) => ({ id: user.id, fullName: user.fullName })) });
  });
  const visible = (user) => user.role === "SUPER_ADMIN" || canBook(user) ? {} : { $or: [{ requester: user._id }, { approver: user._id }] };
  router.use("/requests", (req, _res, next) => {
    if (req.user.role !== "SUPER_ADMIN" && !sidebarAccess(req.user).length) fail(403, "Your administrator has not granted transport workspace access.");
    next();
  });
  router.get("/requests", async (req, res) => {
    const records = await TransportRequest.find(visible(req.user)).sort({ createdAt: -1 });
    res.json({ requests: records.map(publicRequest) });
  });
  router.get("/requests/:id/message", async (req, res) => {
    const record = await TransportRequest.findOne({ _id: id.parse(req.params.id), ...visible(req.user) });
    if (!record) fail(404, "Request not found.");
    res.json({ text: whatsapp(record) });
  });
  async function submit(req, res, update) {
    const user = req.user;
    if (!canRequest(user)) fail(403, "Sign in with your staff account to submit your own request.");
    if (!user.sopAcknowledgedAt) fail(400, "Read and acknowledge the SOP before requesting transport.");
    const data = requestInput.parse(req.body);
    const department = user.department ? await Department.findById(user.department) : null;
    if (!department) fail(400, "Your account must have an assigned department before requesting transport.");
    notice(data.pickupAt);
    const approver = await User.findById(data.approverId);
    if (!active(approver) || !canApprove(approver) || approver.id === user.id || approver.role === "SUPER_ADMIN") fail(400, "Select an active authorized approver.");
    if (!assignedApproverAllowed(user, approver)) fail(400, "Select one of your assigned approvers.");
    if (data.service === "RIDE") {
      if (!data.passengers.length || !data.passengers.some((person) => person.name.toLowerCase() === user.fullName.toLowerCase())) fail(400, "Ride passenger details must include you.");
      if (data.passengerCount !== data.passengers.length) fail(400, "Passenger count must match the listed passengers.");
      if (new Set(data.passengers.map((person) => person.name.toLowerCase())).size !== data.passengers.length) fail(400, "List each passenger once.");
    } else {
      text.parse(data.receiverName); contact.parse(data.receiverContact); text.parse(data.itemDetails);
      if (data.passengers.length || data.passengerCount !== 0) fail(400, "Flash requests are for item/sample delivery, not passengers.");
    }
    const eligible = eligibleVehicles({ ...data, category: ["MANAGER", "ADMIN"].includes(user.role) ? "MANAGER" : "EXECUTIVE_OR_BELOW" });
    if (!eligible.includes(data.vehicle)) fail(400, `Annexure B permits: ${eligible.join(", ")} for this request.`);
    const { approverId, version, requesterDesignation, requesterContact, departmentId, workLocation, approverDesignation, ...details } = data;
    const values = { ...details, pickupAt: new Date(data.pickupAt), requester: user._id, approver: approver._id,
      requesterDetails: { id: user.id, fullName: user.fullName, username: user.username, designation: "", contact: requesterContact, departmentId: department.id, department: department.name, workLocation }, approverDetails: { fullName: approver.fullName, designation: approverDesignation },
      status: "PENDING_APPROVAL", requestSharedAt: null, approvalSharedAt: null, bookingReference: "", driverDetails: "", bookingRecordedBy: null };
    let record;
    if (update) {
      if (version === undefined) fail(400, "A request version is required when editing. Refresh first.");
      record = await TransportRequest.findOneAndUpdate({ _id: id.parse(req.params.id), requester: user._id, version, status: { $in: ["PENDING_APPROVAL", "RETURNED", "REJECTED"] } },
        { $set: values, $inc: { version: 1 }, $push: { history: event(user, "RESUBMITTED") } }, { returnDocument: "after" });
      if (!record) fail(409, "This request cannot be edited now. Refresh its status.");
    } else record = await TransportRequest.create({ ...values, history: [event(user, "SUBMITTED", "Request submitted.")] });
    res.status(update ? 200 : 201).json({ request: publicRequest(record) });
  }
  router.post("/requests", (req, res) => submit(req, res, false));
  router.put("/requests/:id", (req, res) => submit(req, res, true));
  router.post("/requests/:id/action", async (req, res) => {
    const data = actionInput.parse(req.body);
    const user = req.user;
    if (user.role === "SUPER_ADMIN") fail(403, "Use the responsible employee's own account to perform this workflow action.");
    const record = await TransportRequest.findOne({ _id: id.parse(req.params.id), ...visible(user) });
    if (!record) fail(404, "Request not found.");
    const own = String(record.requester) === user.id && hasAccess(user, "REQUESTS");
    const assigned = String(record.approver) === user.id && canApprove(user);
    const booking = canBook(user) && user.role !== "SUPER_ADMIN";
    const status = record.status;
    let nextStatus;
    const changes = {};
    const reason = () => { if (data.note.length < 2) fail(400, "Enter a reason or details for this action."); };
    switch (data.action) {
      case "APPROVE":
        if (!assigned || status !== "PENDING_APPROVAL") fail(403, "Only the assigned authorized approver can approve a pending request.");
        notice(record.pickupAt);
        if (!data.approvalShared) fail(400, "Confirm your approval has been shared in WhatsApp.");
        changes.approvalSharedAt = new Date(); nextStatus = "APPROVED"; break;
      case "REJECT":
        if (!assigned || status !== "PENDING_APPROVAL") fail(403, "Only the assigned approver can reject this request.");
        reason(); nextStatus = "REJECTED"; break;
      case "RETURN":
        if (!(booking || assigned) || !["PENDING_APPROVAL", "APPROVED"].includes(status)) fail(403, "This request cannot be returned by your account.");
        reason(); nextStatus = "RETURNED"; break;
      case "BOOK":
        if (!booking || status !== "APPROVED" || !record.approvalSharedAt) fail(403, "Only the Administrative Assistant can record a booking after approval.");
        if (record.pickupAt <= new Date()) fail(400, "Pickup time has passed. Return this request for rescheduling.");
        if (!data.externalActionConfirmed || !data.bookingReference?.trim()) fail(400, "Enter the PickMe booking reference and confirm the actual booking is complete.");
        changes.bookingReference = data.bookingReference; changes.driverDetails = data.driverDetails || ""; changes.bookingRecordedBy = user._id; nextStatus = "BOOKED"; break;
      case "COMPLETE":
        if (!own || status !== "BOOKED") fail(403, "Only the requester can confirm a booked trip is complete.");
        if (!data.routeVerified || !data.completionMessageChecked) fail(400, "Verify pickup, route and destination, and check the completion message first.");
        nextStatus = "COMPLETED"; break;
      case "CANCEL":
        if (!own || ["COMPLETED", "CANCELLED", "CANCELLATION_REQUESTED"].includes(status)) fail(403, "This request cannot be cancelled by your account.");
        reason(); nextStatus = ["BOOKED", "CHANGE_REQUESTED"].includes(status) ? "CANCELLATION_REQUESTED" : "CANCELLED"; break;
      case "CONFIRM_CANCEL":
        if (!booking || status !== "CANCELLATION_REQUESTED" || !data.externalActionConfirmed) fail(403, "The Administrative Assistant must confirm cancellation in PickMe first.");
        reason(); nextStatus = "CANCELLED"; break;
      case "REQUEST_CHANGE":
        if (!own || status !== "BOOKED") fail(403, "Only the requester can report a change to a booked trip.");
        reason(); nextStatus = "CHANGE_REQUESTED"; break;
      case "CONFIRM_CHANGE":
        if (!booking || status !== "CHANGE_REQUESTED" || !data.externalActionConfirmed) fail(403, "The Administrative Assistant must resolve the existing PickMe booking first.");
        reason(); nextStatus = "RETURNED"; break;
      case "REPORT_ISSUE":
        if (!own || !["BOOKED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].includes(status)) fail(403, "Only the requester can report an issue with an active booking.");
        reason(); nextStatus = status; break;
    }
    const updated = await TransportRequest.findOneAndUpdate({ _id: record._id, version: data.version, status },
      { $set: { ...changes, status: nextStatus }, $inc: { version: 1 }, $push: { history: event(user, data.action, data.action === "BOOK" ? `PickMe reference: ${data.bookingReference}. ${data.driverDetails || ""} ${data.note}`.trim() : data.note) } }, { returnDocument: "after" });
    if (!updated) fail(409, "This request changed. Refresh before trying again.");
    res.json({ request: publicRequest(updated) });
  });
  app.use("/api/transport", requireStaff, router);
  app.use("/api/super-admin/transport", requireSuperAdmin, (req, _res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) fail(403, "Super Administrator monitoring is read-only. Use the responsible staff account for actions.");
    next();
  }, router);
}
