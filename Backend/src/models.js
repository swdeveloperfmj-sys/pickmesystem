import mongoose from "mongoose";
const { Schema } = mongoose;
const userSchema = new Schema(
  {
    fullName: { type: String, required: true },
    username: { type: String, required: true, unique: true, lowercase: true },
    email: { type: String, required() { return this.role === "SUPER_ADMIN"; }, lowercase: true },
    contact: { type: String, trim: true, maxlength: 30 },
    designation: { type: String, default: "" },
    locationType: { type: String, enum: ["", "FACTORY", "HEAD_OFFICE", "SHOWROOM"], default: "" },
    workLocation: { type: String, default: "", maxlength: 150 },
    employeeCategory: { type: String, enum: ["EXECUTIVE_OR_BELOW", "MANAGER"], default: "EXECUTIVE_OR_BELOW" },
    sopAcknowledgedAt: { type: Date, default: null },
    passwordHash: { type: String, required: true, select: false },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    role: {
      type: String,
      match: /^(SUPER_ADMIN|ADMIN|EMPLOYEE|MANAGER|OPERATOR|CUSTOM_[a-f\d]{24})$/,
      required: true,
    },
    sidebarAccess: { type: [String], enum: ["DASHBOARD", "REQUESTS", "APPROVALS", "BOOKINGS", "REPORTS", "HISTORY"], default: undefined },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// Database constraint, independent of application-level checks.
userSchema.index({ email: 1 }, {
  name: "user_email_unique",
  unique: true,
  partialFilterExpression: { email: { $type: "string" } },
});
userSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: "SUPER_ADMIN" } },
);
export const User = mongoose.model("User", userSchema);
export const Role = mongoose.model("Role", new Schema({
  name: { type: String, required: true, maxlength: 100 },
  nameKey: { type: String, required: true, unique: true },
  description: { type: String, default: "", maxlength: 500 },
}, { timestamps: true }));
export const TransportRequest = mongoose.model("TransportRequest", new Schema({
  requester: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  approver: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  requesterDetails: { type: Schema.Types.Mixed, required: true },
  approverDetails: { type: Schema.Types.Mixed, required: true },
  service: { type: String, enum: ["RIDE", "FLASH"], required: true },
  pickupAt: { type: Date, required: true },
  pickup: String,
  stopover: String,
  destination: String,
  vehicle: String,
  deliveryRoute: String,
  groupCarEligible: { type: Boolean, default: false },
  purpose: String,
  justification: String,
  passengers: [{ _id: false, name: String, designation: String }],
  passengerCount: { type: Number, min: 0, max: 10 },
  receiverName: String,
  receiverContact: String,
  itemDetails: String,
  status: { type: String, default: "PENDING_APPROVAL", index: true },
  requestSharedAt: Date,
  approvalSharedAt: Date,
  bookingReference: String,
  driverDetails: String,
  bookingRecordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  version: { type: Number, default: 0 },
  history: [{ _id: false, action: String, actor: Schema.Types.ObjectId, actorName: String, at: Date, note: String }],
}, { timestamps: true }));
export const Department = mongoose.model(
  "Department",
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      nameKey: { type: String, required: true, unique: true },
      description: { type: String, default: "", maxlength: 500 },
      budget: { type: Number, min: 0, default: 0 },
      assignmentVersion: { type: Number, default: 0, select: false },
    },
    { timestamps: true },
  ),
);
export const OrganizationBudget = mongoose.model("OrganizationBudget", new Schema({
  _id: String,
  creditLimit: { type: Number, min: 0, default: 0 },
}, { timestamps: true }));
export const SuperAdminSetup = mongoose.model(
  "SuperAdminSetup",
  new Schema(
    {
      _id: String,
      email: { type: String, required: true, unique: true },
      username: { type: String, required: true, unique: true },
      fullName: String,
      passwordHash: { type: String, select: false },
      otpHash: { type: String, select: false },
      expiresAt: { type: Date, expires: 0 },
      attempts: { type: Number, default: 0 },
      lastOtpSentAt: Date,
    },
    { timestamps: true },
  ),
);
// This record survives account deletion: setup is permanently closed once completed.
export const SetupState = mongoose.model(
  "SetupState",
  new Schema({ _id: String, completedAt: Date }),
);
export const AuditLog = mongoose.model(
  "AuditLog",
  new Schema(
    {
      event: String,
      userId: Schema.Types.ObjectId,
      ip: String,
    },
    { timestamps: true },
  ),
);
export async function initializeDatabase() {
  await Promise.all([
    User.init(),
    SuperAdminSetup.init(),
    SetupState.init(),
    AuditLog.init(),
    Department.init(),
    Role.init(),
    TransportRequest.init(),
  ]);
  // Replace the original unique index, which permits only one user without email.
  // The partial unique index above is installed before dropping the old index.
  const emailIndex = (await User.collection.indexes()).find((index) => index.name === "email_1");
  if (emailIndex?.unique && emailIndex.key.email === 1 && Object.keys(emailIndex.key).length === 1) {
    try { await User.collection.dropIndex("email_1"); }
    catch (error) { if (error.code !== 27) throw error; }
  }
  if (await User.exists({ role: "SUPER_ADMIN" })) {
    await SetupState.updateOne(
      { _id: "super-admin" },
      { $setOnInsert: { completedAt: new Date() } },
      { upsert: true },
    );
  }
}
