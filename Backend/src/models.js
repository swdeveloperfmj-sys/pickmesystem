import mongoose from "mongoose";
const { Schema } = mongoose;
const userSchema = new Schema(
  {
    fullName: { type: String, required: true },
    username: { type: String, required: true, unique: true, lowercase: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    role: {
      type: String,
      match: /^(SUPER_ADMIN|ADMIN|EMPLOYEE|MANAGER|OPERATOR|CUSTOM_[a-f\d]{24})$/,
      required: true,
    },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// Database constraint, independent of application-level checks.
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
export const Department = mongoose.model(
  "Department",
  new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      nameKey: { type: String, required: true, unique: true },
      description: { type: String, default: "", maxlength: 500 },
      assignmentVersion: { type: Number, default: 0, select: false },
    },
    { timestamps: true },
  ),
);
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
  ]);
  if (await User.exists({ role: "SUPER_ADMIN" })) {
    await SetupState.updateOne(
      { _id: "super-admin" },
      { $setOnInsert: { completedAt: new Date() } },
      { upsert: true },
    );
  }
}
