import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import {
  randomInt,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { User, SuperAdminSetup, SetupState, AuditLog, Department, Company, Location, Role, TransportRequest, OrganizationBudget } from "./models.js";
import { registerTransport } from "./transport.js";
import { isAllowedOrigin } from "./origin.js";
import { sopConfig } from "./sop.js";
import { staffModules, sidebarAccess, matchesApprover } from "./access.js";

const registration = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[^<>\p{Cc}]+$/u),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(40)
      .regex(/^[a-z0-9_.-]+$/),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(12)
      .refine(
        (v) => Buffer.byteLength(v, "utf8") <= 72,
        "Password must fit within 72 UTF-8 bytes",
      ),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"],
  });
const challenge = z.object({ setupId: z.uuid() }).strict();
const verification = challenge.extend({ otp: z.string().regex(/^\d{6}$/) });
const login = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(200),
  })
  .strict();
const departmentInput = z.object({
  name: z.string().trim().min(2).max(100).regex(/^[^<>\p{Cc}]+$/u)
    .transform((value) => value.replace(/\s+/g, " ")),
  description: z.string().trim().max(500).default(""),
}).strict();
const roleInput = z.object({
  name: z.string().trim().min(2).max(100).regex(/^[^<>\p{Cc}]+$/u)
    .transform((value) => value.replace(/\s+/g, " ")),
  description: z.string().trim().max(500).default(""),
}).strict();
const departmentId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid department ID");
const managedUserInput = z.object({
  fullName: registration.shape.fullName,
  username: registration.shape.username,
  contact: z.string().trim().min(7).max(30)
    .regex(/^\+?[\d\s().-]+$/, "Enter a valid contact number")
    .refine((value) => { const digits = value.replace(/\D/g, ""); return digits.length >= 7 && digits.length <= 15; }, "Contact number must contain 7 to 15 digits"),
  role: z.string().regex(/^(ADMIN|EMPLOYEE|MANAGER|OPERATOR|CUSTOM_[a-f\d]{24})$/, "Select a valid role"),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  departmentId: departmentId.nullable(),
  departmentIds: z.array(departmentId).refine((ids) => new Set(ids).size === ids.length, "Select each department once").optional(),
  companyIds: z.array(departmentId).refine((ids) => new Set(ids).size === ids.length, "Select each company once").optional(),
  approverIds: z.array(departmentId).refine((ids) => new Set(ids).size === ids.length, "Select each approver once").optional(),
  locationIds: z.array(departmentId).refine((ids) => new Set(ids).size === ids.length, "Select each location once").optional(),
  sidebarAccess: z.array(z.enum(staffModules)).max(staffModules.length).refine((items) => new Set(items).size === items.length, "Select each section once").optional(),
}).strict();
const userPassword = z.string().min(6).refine(
  (value) => Buffer.byteLength(value, "utf8") <= 72,
  "Password must fit within 72 UTF-8 bytes",
);
const createUserInput = managedUserInput.extend({ password: userPassword, role: managedUserInput.shape.role.default("EMPLOYEE") })
  .refine((value) => value.role === "EMPLOYEE" || value.role.startsWith("CUSTOM_"), {
    message: "Select a valid user role.",
    path: ["role"],
  });
const updateUserInput = managedUserInput.extend({ password: userPassword.optional() });
const publicRole = (role) => ({ value: `CUSTOM_${role.id}`, name: role.name, description: role.description, builtIn: false });
const managedUser = (user) => ({
  ...publicUser(user),
  sidebarAccess: sidebarAccess(user),
  approverIds: user.approvers?.map(String),
  sopAcknowledgedAt: user.sopAcknowledgedAt,
  departmentId: user.department?._id?.toString() || null,
  department: user.department ? { id: user.department.id, name: user.department.name } : null,
  departmentIds: (user.departments?.length ? user.departments : user.department ? [user.department] : []).map((department) => department._id?.toString() || department.id),
  departments: (user.departments?.length ? user.departments : user.department ? [user.department] : []).map((department) => ({ id: department.id, name: department.name })),
  companyIds: (user.companies?.length ? user.companies : user.company ? [user.company] : []).map((company) => company._id?.toString() || company.id),
  companies: (user.companies?.length ? user.companies : user.company ? [user.company] : []).map((company) => ({ id: company.id, name: company.name })),
  locationIds: (user.locations?.length ? user.locations : user.location ? [user.location] : []).map((location) => location._id?.toString() || location.id),
  locations: (user.locations?.length ? user.locations : user.location ? [user.location] : []).map((location) => ({ id: location.id, name: location.name })),
});
const publicDepartment = (department) => ({
  id: department.id,
  name: department.name,
  description: department.description,
  createdAt: department.createdAt,
  updatedAt: department.updatedAt,
});
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const publicUser = (user) => ({
  id: user.id,
  fullName: user.fullName,
  username: user.username,
  email: user.email,
  contact: user.contact || "",
  role: user.role,
  status: user.status,
  isActive: user.isActive,
  isEmailVerified: user.isEmailVerified,
});
export function createApp({ config, mailer, limits = true }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet(), express.json({ limit: "16kb" }), cookieParser());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  // Same-origin cookies; do not trust arbitrary forwarded headers or enable wildcard CORS.
  app.use("/api", (req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("Origin") &&
      !isAllowedOrigin(req.get("Origin"), config)
    ) {
      return next(new ApiError(403, "Request origin is not allowed."));
    }
    next();
  });
  const limiter = (limit, windowMs) =>
    limits
      ? rateLimit({
          windowMs,
          limit,
          standardHeaders: "draft-8",
          legacyHeaders: false,
          message: { message: "Too many requests. Please try again later." },
        })
      : (_req, _res, next) => next();
  app.use("/api", limiter(300, 15 * 60 * 1000));
  const otpLimiter = limiter(10, 15 * 60 * 1000);
  const verifyLimiter = limiter(30, 15 * 60 * 1000);
  const loginLimiter = limiter(10, 15 * 60 * 1000);
  const hashOtp = (id, otp) =>
    createHmac("sha256", config.JWT_SECRET)
      .update(`ctms-setup:${id}:${otp}`)
      .digest("hex");
  const newCode = (id) => {
    const otp = String(randomInt(0, 1000000)).padStart(6, "0");
    return {
      otp,
      otpHash: hashOtp(id, otp),
      expiresAt: new Date(Date.now() + config.OTP_EXPIRES_MINUTES * 60000),
      lastOtpSentAt: new Date(),
    };
  };
  const audit = (event, req, userId) =>
    AuditLog.create({ event, ip: req.ip, userId });
  async function setupClosed() {
    return Boolean(
      (await SetupState.exists({ _id: "super-admin" })) ||
      (await User.exists({ role: "SUPER_ADMIN" })),
    );
  }
  async function requireOpen() {
    if (await setupClosed())
      throw new ApiError(
        409,
        "Initial setup is permanently closed. Please sign in.",
      );
  }
  function setSession(res, user) {
    const token = jwt.sign({ role: user.role }, config.JWT_SECRET, {
      subject: user.id,
      expiresIn: config.JWT_EXPIRES_IN,
      issuer: "ctms",
      audience: "ctms-super-admin",
      algorithm: "HS256",
    });
    const { exp } = jwt.decode(token);
    res.cookie("ctms_session", token, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/super-admin",
      maxAge: Math.max(0, exp * 1000 - Date.now()),
    });
  }
  async function requireSuperAdmin(req, _res, next) {
    try {
      const payload = jwt.verify(
        req.cookies.ctms_session || "",
        config.JWT_SECRET,
        { issuer: "ctms", audience: "ctms-super-admin", algorithms: ["HS256"] },
      );
      if (payload.role !== "SUPER_ADMIN") throw new Error("role");
      const user = await User.findById(payload.sub);
      if (
        !user ||
        user.role !== "SUPER_ADMIN" ||
        !user.isActive ||
        user.status !== "ACTIVE" ||
        !user.isEmailVerified
      )
        throw new Error("account");
      req.user = user;
      next();
    } catch {
      next(new ApiError(401, "Super Admin authentication is required."));
    }
  }
  app.get("/api/setup/status", async (_req, res) =>
    res.json({ setupRequired: !(await setupClosed()) }),
  );
  app.post("/api/setup/super-admin", otpLimiter, async (req, res) => {
    await requireOpen();
    const data = registration.parse(req.body);
    if (
      await User.exists({
        $or: [{ email: data.email }, { username: data.username }],
      })
    )
      throw new ApiError(409, "Unable to use these account details.");
    const id = randomUUID();
    const { otp, ...code } = newCode(id);
    try {
      await SuperAdminSetup.create({
        _id: id,
        email: data.email,
        username: data.username,
        fullName: data.fullName,
        passwordHash: await bcrypt.hash(data.password, 12),
        ...code,
      });
    } catch (error) {
      if (error.code === 11000)
        throw new ApiError(
          409,
          "A verification is already pending for these details. Use the existing verification page or wait for expiry.",
        );
      throw error;
    }
    try {
      await audit("SETUP_OTP_REQUESTED", req);
      await mailer.sendOtp(data.email, otp);
    } catch {
      await SuperAdminSetup.deleteOne({ _id: id });
      throw new ApiError(
        503,
        "Unable to send verification email. Please try again later.",
      );
    }
    res.status(202).json({
      setupId: id,
      expiresAt: code.expiresAt,
      resendAt: new Date(
        code.lastOtpSentAt.getTime() + config.OTP_RESEND_SECONDS * 1000,
      ),
    });
  });
  app.post("/api/setup/resend-otp", otpLimiter, async (req, res) => {
    await requireOpen();
    const { setupId } = challenge.parse(req.body);
    const { otp, ...code } = newCode(setupId);
    // Compare and replace in MongoDB: concurrent resends cannot bypass the cooldown.
    const previous = await SuperAdminSetup.findOneAndUpdate(
      {
        _id: setupId,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: 5 },
        lastOtpSentAt: {
          $lte: new Date(Date.now() - config.OTP_RESEND_SECONDS * 1000),
        },
      },
      { $set: code },
      { returnDocument: "before" },
    ).select("+otpHash");
    if (!previous)
      throw new ApiError(
        429,
        "Cannot resend yet. Wait for the cooldown, or restart setup if the code expired or is locked.",
      );
    try {
      await audit("SETUP_OTP_RESENT", req);
      await mailer.sendOtp(previous.email, otp);
    } catch {
      await SuperAdminSetup.updateOne(
        { _id: setupId, otpHash: code.otpHash },
        {
          $set: {
            otpHash: previous.otpHash,
            expiresAt: previous.expiresAt,
            lastOtpSentAt: previous.lastOtpSentAt,
          },
        },
      );
      throw new ApiError(
        503,
        "Unable to send verification email. Please try again later.",
      );
    }
    res.json({
      expiresAt: code.expiresAt,
      resendAt: new Date(
        code.lastOtpSentAt.getTime() + config.OTP_RESEND_SECONDS * 1000,
      ),
    });
  });
  app.post("/api/setup/verify-otp", verifyLimiter, async (req, res) => {
    await requireOpen();
    const { setupId, otp } = verification.parse(req.body);
    let createdUser;
    let invalid = false;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(
        async () => {
          invalid = false;
          if (
            (await SetupState.exists({ _id: "super-admin" }).session(
              session,
            )) ||
            (await User.exists({ role: "SUPER_ADMIN" }).session(session))
          )
            throw new ApiError(
              409,
              "Initial setup is permanently closed. Please sign in.",
            );
          const pending = await SuperAdminSetup.findOne({
            _id: setupId,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: 5 },
          })
            .select("+passwordHash +otpHash")
            .session(session);
          if (!pending) {
            invalid = true;
            return;
          }
          const actual = Buffer.from(hashOtp(setupId, otp), "hex");
          if (!timingSafeEqual(Buffer.from(pending.otpHash, "hex"), actual)) {
            await SuperAdminSetup.updateOne(
              { _id: setupId },
              { $inc: { attempts: 1 } },
              { session },
            );
            await AuditLog.create(
              [{ event: "SETUP_OTP_REJECTED", ip: req.ip }],
              {
                session,
              },
            );
            invalid = true;
            return;
          }
          await SetupState.create(
            [{ _id: "super-admin", completedAt: new Date() }],
            { session },
          );
          [createdUser] = await User.create(
            [
              {
                fullName: pending.fullName,
                username: pending.username,
                email: pending.email,
                passwordHash: pending.passwordHash,
                role: "SUPER_ADMIN",
                status: "ACTIVE",
                isActive: true,
                isEmailVerified: true,
              },
            ],
            { session },
          );
          await SuperAdminSetup.deleteMany({}, { session });
          await AuditLog.create(
            [
              {
                event: "SUPER_ADMIN_SETUP_COMPLETED",
                userId: createdUser._id,
                ip: req.ip,
              },
            ],
            { session },
          );
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (error.code === 11000)
        throw new ApiError(
          409,
          "Setup could not be completed. Refresh the setup status.",
        );
      throw error;
    } finally {
      await session.endSession();
    }
    if (invalid)
      throw new ApiError(400, "Invalid, expired, or locked verification code.");
    setSession(res, createdUser);
    res.status(201).json({ user: publicUser(createdUser) });
  });
  // Use a real bcrypt comparison even for unknown users to reduce timing differences.
  const dummyHash = bcrypt.hashSync(randomUUID(), 12);
  app.post("/api/super-admin/auth/login", loginLimiter, async (req, res) => {
    const data = login.parse(req.body);
    const user = await User.findOne({
      $or: [{ email: data.identifier }, { username: data.identifier }],
    }).select("+passwordHash");
    const matches = await bcrypt.compare(
      data.password,
      user?.passwordHash || dummyHash,
    );
    if (
      !matches ||
      !user ||
      user.role !== "SUPER_ADMIN" ||
      !user.isActive ||
      user.status !== "ACTIVE" ||
      !user.isEmailVerified
    ) {
      await audit("SUPER_ADMIN_LOGIN_REJECTED", req);
      throw new ApiError(401, "Invalid credentials or account unavailable.");
    }
    await audit("SUPER_ADMIN_LOGIN_SUCCEEDED", req, user._id);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  });
  app.use("/api/super-admin", requireSuperAdmin);
  app.get("/api/super-admin/sop", (_req, res) => res.json(sopConfig));
  app.get("/api/super-admin/roles", async (_req, res) => {
    const roles = await Role.find().sort({ nameKey: 1 });
    res.json({ roles: roles.map(publicRole) });
  });
  async function saveRole(req, res, update) {
    const id = update ? departmentId.parse(req.params.id) : undefined;
    const data = roleInput.parse(req.body);
    const nameKey = data.name.toLowerCase();
    if (["superadmin", "superadministrator"].includes(nameKey.replace(/[\s_-]+/g, ""))) {
      throw new ApiError(409, "This role name is reserved for the Super Administrator.");
    }
    let role;
    try {
      role = update
        ? await Role.findByIdAndUpdate(id, { $set: { ...data, nameKey } }, { returnDocument: "after", runValidators: true })
        : await Role.create({ ...data, nameKey });
    } catch (error) {
      if (error.code === 11000) throw new ApiError(409, "A role with this name already exists.");
      throw error;
    }
    if (!role) throw new ApiError(404, "Role not found.");
    res.status(update ? 200 : 201).json({ role: publicRole(role) });
  }
  app.post("/api/super-admin/roles", (req, res) => saveRole(req, res, false));
  app.put("/api/super-admin/roles/:id", (req, res) => saveRole(req, res, true));
  app.delete("/api/super-admin/roles/:id", async (req, res) => {
    const id = departmentId.parse(req.params.id);
    await mongoose.connection.transaction(async (session) => {
      const role = await Role.findByIdAndUpdate(id, { $inc: { assignmentVersion: 1 } }, { session });
      if (!role) throw new ApiError(404, "Role not found.");
      if (await User.exists({ role: `CUSTOM_${id}` }).session(session)) {
        throw new ApiError(409, "This role is assigned to users. Reassign or delete those users before deleting the role.");
      }
      await Role.deleteOne({ _id: id }).session(session);
    });
    res.sendStatus(204);
  });
  app.get("/api/super-admin/users", async (_req, res) => {
    const users = await User.find({ role: { $ne: "SUPER_ADMIN" } })
      .populate("department", "name")
      .populate("departments", "name")
      .populate("company", "name")
      .populate("location", "name")
      .populate("companies", "name")
      .populate("locations", "name")
      .sort({ fullName: 1, _id: 1 });
    res.json({ users: users.map(managedUser) });
  });
  async function saveUser(req, res, update) {
    const id = update ? departmentId.parse(req.params.id) : undefined;
    const data = (update ? updateUserInput : createUserInput).parse(req.body);
    const {
      password,
      departmentId: requestedDepartmentId,
      departmentIds: requestedDepartmentIds,
      companyIds: requestedCompanyIds,
      approverIds: requestedApproverIds,
      locationIds: requestedLocationIds,
      ...fields
    } = data;
    const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
    let saved;
    try {
      await mongoose.connection.transaction(async (session) => {
        const currentUser = update
          ? await User.findOne({ _id: id, role: { $ne: "SUPER_ADMIN" } }).session(session)
          : null;
        if (update && !currentUser) throw new ApiError(404, "User not found or protected Super Administrator account.");
        const departmentIds = requestedDepartmentIds ?? (requestedDepartmentId
          ? [requestedDepartmentId]
          : requestedDepartmentId === null
            ? []
            : currentUser?.departments?.length
              ? currentUser.departments.map(String)
              : currentUser?.department ? [String(currentUser.department)] : []);
        const companyIds = requestedCompanyIds ?? (currentUser?.companies?.length
          ? currentUser.companies.map(String)
          : currentUser?.company ? [String(currentUser.company)] : []);
        const locationIds = requestedLocationIds ?? (currentUser?.locations?.length
          ? currentUser.locations.map(String)
          : currentUser?.location ? [String(currentUser.location)] : []);
        const becomesApprover = (fields.sidebarAccess ?? (currentUser && sidebarAccess(currentUser)) ?? []).includes("APPROVALS");
        if (becomesApprover && (!departmentIds.length || !companyIds.length)) {
          throw new ApiError(400, "Approver users must have at least one department and company assigned.");
        }
        if (fields.role.startsWith("CUSTOM_")) {
          if (!(await Role.findByIdAndUpdate(fields.role.slice(7),
            { $inc: { assignmentVersion: 1 } }, { session }))) {
            throw new ApiError(400, "Selected role no longer exists. Refresh the role list.");
          }
        } else if (update ? !(await User.exists({ _id: id, role: fields.role }).session(session)) : fields.role !== "EMPLOYEE") {
          throw new ApiError(400, "Select a current custom role.");
        }
        // Lock selected department documents so assignment cannot race their deletion.
        for (const departmentId of departmentIds) {
          const department = await Department.findByIdAndUpdate(departmentId,
            { $inc: { assignmentVersion: 1 } }, { session });
          if (!department) throw new ApiError(400, "A selected department no longer exists. Refresh the department list.");
        }
        for (const companyId of companyIds) {
          if (!(await Company.findByIdAndUpdate(companyId, { $inc: { assignmentVersion: 1 } }, { session }))) {
            throw new ApiError(400, "A selected company no longer exists. Refresh the company list.");
          }
        }
        for (const locationId of locationIds) {
          if (!(await Location.findByIdAndUpdate(locationId, { $inc: { assignmentVersion: 1 } }, { session }))) {
            throw new ApiError(400, "A selected location no longer exists. Refresh the location list.");
          }
        }
        const values = {
          ...fields,
          department: departmentIds[0] || null,
          departments: departmentIds,
          company: null,
          location: null,
          companies: companyIds,
          locations: locationIds,
          isActive: fields.status === "ACTIVE",
        };
        if (requestedApproverIds !== undefined) {
          const approvers = await User.find({ _id: { $in: requestedApproverIds } }).session(session);
          if (!becomesApprover && (approvers.length !== requestedApproverIds.length || approvers.some((approver) => !matchesApprover(approver, departmentIds, companyIds, id)))) {
            throw new ApiError(400, "Selected approvers must be active and match the user's departments and companies. Refresh the approver selection.");
          }
          values.approvers = becomesApprover ? [] : requestedApproverIds;
        }
        if (passwordHash) values.passwordHash = passwordHash;
        if (update) {
          saved = await User.findOneAndUpdate({ _id: id, role: { $ne: "SUPER_ADMIN" } },
            { $set: values }, { session, returnDocument: "after", runValidators: true });
          if (!saved) throw new ApiError(404, "User not found or protected Super Administrator account.");
        } else {
          [saved] = await User.create([values], { session });
        }
      });
    } catch (error) {
      if (error.code === 11000) throw new ApiError(409, "Username is already in use.");
      throw error;
    }
    await saved.populate([
      { path: "department", select: "name" },
      { path: "departments", select: "name" },
      { path: "company", select: "name" },
      { path: "location", select: "name" },
      { path: "companies", select: "name" },
      { path: "locations", select: "name" },
    ]);
    res.status(update ? 200 : 201).json({ user: managedUser(saved) });
  }
  app.post("/api/super-admin/users", (req, res) => saveUser(req, res, false));
  app.put("/api/super-admin/users/:id", (req, res) => saveUser(req, res, true));
  app.delete("/api/super-admin/users/:id", async (req, res) => {
    const id = departmentId.parse(req.params.id);
    const user = await User.findOneAndDelete({ _id: id, role: { $ne: "SUPER_ADMIN" } });
    if (!user) throw new ApiError(404, "User not found or protected Super Administrator account.");
    res.sendStatus(204);
  });
  const companyInput = z.object({
    name: z.string().trim().min(2).max(100).regex(/^[^<>\p{Cc}]+$/u),
    description: z.string().trim().max(500).default(""),
    budget: z.number().finite().min(0).max(1000000000000).optional(),
  }).strict();
  const publicCompany = (company) => ({ id: company.id, name: company.name, description: company.description, budget: company.budget || 0 });
  app.get("/api/super-admin/companies", async (_req, res) => {
    res.json({ companies: (await Company.find().sort({ nameKey: 1 })).map(publicCompany) });
  });
  async function saveCompany(req, res, update) {
    const id = update ? departmentId.parse(req.params.id) : undefined;
    const data = companyInput.parse(req.body);
    const budget = data.budget ?? (update ? (await Company.findById(id))?.budget || 0 : 0);
    const credit = await OrganizationBudget.findById("organization");
    const allocated = await Company.aggregate([{ $match: update ? { _id: { $ne: new mongoose.Types.ObjectId(id) } } : {} }, { $group: { _id: null, total: { $sum: "$budget" } } }]);
    if ((allocated[0]?.total || 0) + budget > (credit?.creditLimit || 0)) {
      throw new ApiError(400, "Weekly company budgets cannot exceed the overall weekly credit limit. Set the overall weekly credit limit first.");
    }
    const values = { ...data, budget, nameKey: data.name.toLowerCase() };
    let company;
    try {
      company = update
        ? await Company.findByIdAndUpdate(id, { $set: values }, { returnDocument: "after", runValidators: true })
        : await Company.create(values);
    } catch (error) {
      if (error.code === 11000) throw new ApiError(409, "A company with this name already exists.");
      throw error;
    }
    if (!company) throw new ApiError(404, "Company not found.");
    res.status(update ? 200 : 201).json({ company: publicCompany(company) });
  }
  app.post("/api/super-admin/companies", (req, res) => saveCompany(req, res, false));
  app.put("/api/super-admin/companies/:id", (req, res) => saveCompany(req, res, true));
  app.delete("/api/super-admin/companies/:id", async (req, res) => {
    const id = departmentId.parse(req.params.id);
    await mongoose.connection.transaction(async (session) => {
      const company = await Company.findByIdAndUpdate(id, { $inc: { assignmentVersion: 1 } }, { session });
      if (!company) throw new ApiError(404, "Company not found.");
      if (await User.exists({ $or: [{ company: id }, { companies: id }] }).session(session)) {
        throw new ApiError(409, "This company has users assigned. Reassign or delete those users before deleting the company.");
      }
      await Company.deleteOne({ _id: id }).session(session);
    });
    res.sendStatus(204);
  });
  const locationInput = z.object({
    name: z.string().trim().min(2).max(100).regex(/^[^<>\p{Cc}]+$/u),
    description: z.string().trim().max(500).default(""),
  }).strict();
  const publicLocation = (location) => ({ id: location.id, name: location.name, description: location.description });
  app.get("/api/super-admin/locations", async (_req, res) => {
    res.json({ locations: (await Location.find().sort({ nameKey: 1 })).map(publicLocation) });
  });
  async function saveLocation(req, res, update) {
    const id = update ? departmentId.parse(req.params.id) : undefined;
    const data = locationInput.parse(req.body);
    const values = { ...data, nameKey: data.name.toLowerCase() };
    let location;
    try {
      location = update
        ? await Location.findByIdAndUpdate(id, { $set: values }, { returnDocument: "after", runValidators: true })
        : await Location.create(values);
    } catch (error) {
      if (error.code === 11000) throw new ApiError(409, "A location with this name already exists.");
      throw error;
    }
    if (!location) throw new ApiError(404, "Location not found.");
    res.status(update ? 200 : 201).json({ location: publicLocation(location) });
  }
  app.post("/api/super-admin/locations", (req, res) => saveLocation(req, res, false));
  app.put("/api/super-admin/locations/:id", (req, res) => saveLocation(req, res, true));
  app.delete("/api/super-admin/locations/:id", async (req, res) => {
    const id = departmentId.parse(req.params.id);
    await mongoose.connection.transaction(async (session) => {
      const location = await Location.findByIdAndUpdate(id, { $inc: { assignmentVersion: 1 } }, { session });
      if (!location) throw new ApiError(404, "Location not found.");
      if (await User.exists({ $or: [{ location: id }, { locations: id }] }).session(session)) {
        throw new ApiError(409, "This location has users assigned. Reassign or delete those users before deleting the location.");
      }
      await Location.deleteOne({ _id: id }).session(session);
    });
    res.sendStatus(204);
  });
  app.get("/api/super-admin/departments", async (_req, res) => {
    const departments = await Department.find().sort({ nameKey: 1 });
    res.json({ departments: departments.map(publicDepartment) });
  });
  app.get("/api/super-admin/budget", async (_req, res) => {
    const settings = await OrganizationBudget.findById("organization");
    res.json({ creditLimit: settings?.creditLimit || 0 });
  });
  app.put("/api/super-admin/budget", async (req, res) => {
    const { creditLimit } = z.object({ creditLimit: z.number().finite().min(0).max(1000000000000) }).strict().parse(req.body);
    const allocated = await Company.aggregate([{ $group: { _id: null, total: { $sum: "$budget" } } }]);
    if ((allocated[0]?.total || 0) > creditLimit) throw new ApiError(400, "Weekly credit limit cannot be lower than the total weekly company budgets.");
    const settings = await OrganizationBudget.findByIdAndUpdate("organization", { $set: { creditLimit } }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
    res.json({ creditLimit: settings.creditLimit });
  });
  async function saveDepartment(req, res, update) {
    const id = update ? departmentId.parse(req.params.id) : undefined;
    const data = departmentInput.parse(req.body);
    const values = { ...data, nameKey: data.name.toLowerCase() };
    let department;
    try {
      department = update
        ? await Department.findByIdAndUpdate(id, { $set: values }, { returnDocument: "after", runValidators: true })
        : await Department.create(values);
    } catch (error) {
      if (error.code === 11000) throw new ApiError(409, "A department with this name already exists.");
      throw error;
    }
    if (!department) throw new ApiError(404, "Department not found.");
    res.status(update ? 200 : 201).json({ department: publicDepartment(department) });
  }
  app.post("/api/super-admin/departments", (req, res) => saveDepartment(req, res, false));
  app.put("/api/super-admin/departments/:id", (req, res) => saveDepartment(req, res, true));
  app.delete("/api/super-admin/departments/:id", async (req, res) => {
    const id = departmentId.parse(req.params.id);
    await mongoose.connection.transaction(async (session) => {
      const department = await Department.findByIdAndDelete(id, { session });
      if (!department) throw new ApiError(404, "Department not found.");
      if (await User.exists({ $or: [{ department: id }, { departments: id }] }).session(session)) {
        throw new ApiError(409, "This department has assigned users. Reassign or remove their department before deleting it.");
      }
    });
    res.sendStatus(204);
  });
  app.get("/api/super-admin/auth/me", (req, res) =>
    res.json({ user: publicUser(req.user) }),
  );
  app.post("/api/super-admin/auth/logout", async (req, res) => {
    await audit("SUPER_ADMIN_LOGOUT", req, req.user._id);
    res.clearCookie("ctms_session", {
      path: "/api/super-admin",
      httpOnly: true,
      sameSite: "strict",
      secure: config.NODE_ENV === "production",
    });
    res.sendStatus(204);
  });
  app.get("/api/super-admin/dashboard/stats", async (_req, res) => {
    const [totalEmployees, totalManagers, totalDepartments, totalTransportRequests, pendingApprovals, completedBookings] = await Promise.all([
      User.countDocuments({ role: "EMPLOYEE" }),
      User.countDocuments({ role: "MANAGER" }),
      Department.countDocuments(),
      TransportRequest.countDocuments(),
      TransportRequest.countDocuments({ status: "PENDING_APPROVAL" }),
      TransportRequest.countDocuments({ status: "COMPLETED" }),
    ]);
    res.json({
      totalEmployees,
      totalManagers,
      totalDepartments,
      totalTransportRequests,
      pendingApprovals,
      completedBookings,
    });
  });
  registerTransport(app, { config, requireSuperAdmin });
  app.use((_req, res) =>
    res.status(404).json({ message: "Endpoint not found." }),
  );
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        message: "Please check the submitted fields.",
        errors: error.issues.map(({ path, message }) => ({
          field: path.join("."),
          message,
        })),
      });
    if (
      error.type === "entity.parse.failed" ||
      error.type === "entity.too.large"
    )
      return res.status(400).json({ message: "Invalid request body." });
    // Never log request bodies, credentials, tokens, or SMTP errors.
    if (!error.status)
      console.error(
        "API operation failed:",
        error.name,
        error.code || "INTERNAL",
      );
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "The operation could not be completed. Please try again later.",
    });
  });
  return app;
}
