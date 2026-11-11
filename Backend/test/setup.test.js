import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import {
  User,
  SuperAdminSetup,
  SetupState,
  AuditLog,
  Department,
  Company,
  Location,
  Role,
  TransportRequest,
  initializeDatabase,
} from "../src/models.js";
import { readConfig } from "../src/config.js";

let mongo, app, sent, failMail;
const config = {
  JWT_SECRET: "test-only-secret-with-at-least-32-characters",
  JWT_EXPIRES_IN: "8h",
  OTP_EXPIRES_MINUTES: 5,
  OTP_RESEND_SECONDS: 60,
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
};
const details = {
  fullName: "Alex Morgan",
  username: "alex.morgan",
  email: "alex@example.com",
  password: "LongSecurePassword!123",
  confirmPassword: "LongSecurePassword!123",
};
const mailer = {
  async sendOtp(email, otp) {
    if (failMail) throw new Error("SMTP unavailable");
    sent.push({ email, otp });
  },
};
before(
  async () => {
    mongo = await MongoMemoryReplSet.create({
      // Small, disposable fixtures do not need MongoDB's default 500 MB reserve.
      replSet: { count: 1, storageEngine: "wiredTiger", args: ["--setParameter", "indexBuildMinAvailableDiskSpaceMB=50"] },
      binary: { version: "8.0.17" },
    });
    await mongoose.connect(mongo.getUri());
    await initializeDatabase();
    app = createApp({ config, mailer });
  },
  { timeout: 240000 },
);
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Company.deleteMany({}),
    Location.deleteMany({}),
    SuperAdminSetup.deleteMany({}),
    SetupState.deleteMany({}),
    AuditLog.deleteMany({}),
    Department.deleteMany({}),
    Role.deleteMany({}),
    TransportRequest.deleteMany({}),
  ]);
  sent = [];
  failMail = false;
  app = createApp({ config, mailer });
});
async function pending(data = details) {
  const response = await request(app)
    .post("/api/setup/super-admin")
    .send(data)
    .expect(202);
  return { ...response.body, otp: sent.at(-1).otp };
}
async function complete() {
  const data = await pending();
  return request(app)
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: data.otp })
    .expect(201);
}
test("full setup, single-use code, authenticated dashboard, logout, and username/email login", async () => {
  assert.equal(
    (await request(app).get("/api/setup/status")).body.setupRequired,
    true,
  );
  const data = await pending();
  assert.match(data.otp, /^\d{6}$/);
  assert.equal(await User.countDocuments(), 0);
  const record = await SuperAdminSetup.findById(data.setupId).select(
    "+passwordHash +otpHash",
  );
  assert.notEqual(record.otpHash, data.otp);
  assert.equal(record.otpHash.length, 64);
  assert.ok(await bcrypt.compare(details.password, record.passwordHash));
  assert.ok(record.expiresAt - record.lastOtpSentAt <= 300000);
  const agent = request.agent(app);
  const verified = await agent
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: data.otp })
    .expect(201);
  assert.equal(verified.body.user.role, "SUPER_ADMIN");
  assert.equal(verified.body.user.status, "ACTIVE");
  assert.equal(verified.body.user.isEmailVerified, true);
  assert.equal(verified.body.user.passwordHash, undefined);
  assert.match(verified.headers["set-cookie"][0], /HttpOnly/);
  assert.match(verified.headers["set-cookie"][0], /SameSite=Strict/);
  assert.equal(await SuperAdminSetup.countDocuments(), 0);
  await agent.get("/api/super-admin/auth/me").expect(200);
  const stats = await agent.get("/api/super-admin/dashboard/stats").expect(200);
  assert.equal(stats.body.totalEmployees, 0);
  assert.equal(stats.body.totalDepartments, 0);
  await agent.post("/api/super-admin/auth/logout").send({}).expect(204);
  await agent.get("/api/super-admin/auth/me").expect(401);
  for (const identifier of [details.username, details.email.toUpperCase()]) {
    await agent
      .post("/api/super-admin/auth/login")
      .send({ identifier, password: details.password })
      .expect(200);
  }
  const bad = await agent
    .post("/api/super-admin/auth/login")
    .send({ identifier: details.username, password: "incorrect" })
    .expect(401);
  const unknown = await agent
    .post("/api/super-admin/auth/login")
    .send({ identifier: "missing", password: "incorrect" })
    .expect(401);
  assert.deepEqual(bad.body, unknown.body);
  assert.equal(
    (await request(app).get("/api/setup/status")).body.setupRequired,
    false,
  );
  await request(app)
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: data.otp })
    .expect(409);
  assert.equal(
    await AuditLog.countDocuments({ event: "SUPER_ADMIN_SETUP_COMPLETED" }),
    1,
  );
});
test("company CRUD is protected, validated, unique and persistent", async () => {
  const base = "/api/super-admin/companies";
  const missingId = new mongoose.Types.ObjectId().toString();
  await request(app).get(base).expect(401);
  await request(app).post(base).send({ name: "Acme" }).expect(401);
  await request(app).put(`${base}/${missingId}`).send({ name: "Acme" }).expect(401);
  await request(app).delete(`${base}/${missingId}`).expect(401);
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  await request(app).put("/api/super-admin/budget").set("Cookie", cookie)
    .send({ creditLimit: 50000 }).expect(200);
  const created = await request(app).post(base).set("Cookie", cookie).send({ name: " Acme ", description: "Main office" }).expect(201);
  const id = created.body.company.id;
  assert.equal(created.body.company.name, "Acme");
  assert.equal(created.body.company.budget, 0);
  await request(app).post(base).set("Cookie", cookie).send({ name: "acme" }).expect(409);
  for (const body of [{ name: "x" }, { name: "Valid", description: "x".repeat(501) }, { name: "Valid", budget: -1 }, { name: "Valid", budget: "100" }, { name: "Valid", role: "ADMIN" }]) {
    await request(app).post(base).set("Cookie", cookie).send(body).expect(400);
  }
  const updated = await request(app).put(`${base}/${id}`).set("Cookie", cookie)
    .send({ name: "Acme Group", description: "Updated", budget: 30000 }).expect(200);
  assert.equal(updated.body.company.budget, 30000);
  assert.equal((await Company.findById(id)).name, "Acme Group");
  const second = await request(app).post(base).set("Cookie", cookie)
    .send({ name: "Northwind", budget: 20000 }).expect(201);
  assert.equal(second.body.company.budget, 20000);
  await request(app).put(`${base}/${second.body.company.id}`).set("Cookie", cookie)
    .send({ name: "Northwind", budget: 20001 }).expect(400);
  await request(app).put("/api/super-admin/budget").set("Cookie", cookie)
    .send({ creditLimit: 49999 }).expect(400);
  const list = await request(app).get(base).set("Cookie", cookie).expect(200);
  assert.deepEqual(list.body.companies.map((item) => item.name), ["Acme Group", "Northwind"]);
  assert.deepEqual(list.body.companies.map((item) => item.budget), [30000, 20000]);
  await request(app).delete(`${base}/bad-id`).set("Cookie", cookie).expect(400);
  await request(app).put(`${base}/${missingId}`).set("Cookie", cookie).send({ name: "Valid" }).expect(404);
  await request(app).delete(`${base}/${second.body.company.id}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/${id}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/${id}`).set("Cookie", cookie).expect(404);
  assert.equal(await Company.countDocuments(), 0);
});

test("location CRUD is protected, validated, unique and persistent", async () => {
  const base = "/api/super-admin/locations";
  const missingId = new mongoose.Types.ObjectId().toString();
  await request(app).get(base).expect(401);
  await request(app).post(base).send({ name: "Main Office" }).expect(401);
  await request(app).put(`${base}/${missingId}`).send({ name: "Main Office" }).expect(401);
  await request(app).delete(`${base}/${missingId}`).expect(401);
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const created = await request(app).post(base).set("Cookie", cookie)
    .send({ name: "  Main Office  ", description: "Headquarters" }).expect(201);
  const id = created.body.location.id;
  assert.equal(created.body.location.name, "Main Office");
  assert.equal(created.body.location.nameKey, undefined);
  await request(app).post(base).set("Cookie", cookie).send({ name: "main office" }).expect(409);
  for (const body of [{ name: " " }, { name: "x" }, { name: "Branch", description: "x".repeat(501) }, { name: "Branch", role: "ADMIN" }]) {
    await request(app).post(base).set("Cookie", cookie).send(body).expect(400);
  }
  await request(app).put(`${base}/${id}`).set("Cookie", cookie)
    .send({ name: "City Office", description: "Updated" }).expect(200);
  assert.equal((await Location.findById(id)).name, "City Office");
  const list = await request(app).get(base).set("Cookie", cookie).expect(200);
  assert.deepEqual(list.body.locations.map((item) => item.name), ["City Office"]);
  await request(app).delete(`${base}/bad-id`).set("Cookie", cookie).expect(400);
  await request(app).put(`${base}/${missingId}`).set("Cookie", cookie).send({ name: "Valid" }).expect(404);
  await request(app).delete(`${base}/${id}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/${id}`).set("Cookie", cookie).expect(404);
  assert.equal(await Location.countDocuments(), 0);
});

test("users can be created without a role or custom roles and keep explicit access", async () => {
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  assert.equal(await Role.countDocuments(), 0);
  const body = { fullName: "Normal User", username: "normal.user", designation: "Executive", contact: "0771234567", password: "Password123", status: "ACTIVE", departmentId: null, sidebarAccess: ["DASHBOARD", "REQUESTS"], approverIds: [] };
  const created = await request(app).post("/api/super-admin/users").set("Cookie", cookie).send(body).expect(201);
  assert.equal(created.body.user.role, "EMPLOYEE");
  assert.equal(created.body.user.designation, "Executive");
  assert.deepEqual(created.body.user.sidebarAccess, body.sidebarAccess);
  await request(app).put(`/api/super-admin/users/${created.body.user.id}`).set("Cookie", cookie).send({ ...body, role: "EMPLOYEE", fullName: "Updated User" }).expect(200);
  const department = await Department.create({ name: "Finance", nameKey: "finance" });
  const company = await Company.create({ name: "Acme", nameKey: "acme" });
  const approver = await request(app).post("/api/super-admin/users").set("Cookie", cookie).send({ ...body, username: "new.approver", departmentId: department.id, departmentIds: [department.id], companyIds: [company.id], sidebarAccess: ["DASHBOARD", "APPROVALS"] }).expect(201);
  assert.ok(approver.body.user.sidebarAccess.includes("APPROVALS"));
  assert.equal(await Role.countDocuments(), 0);
});

test("normal users persist selected approvers and reject unrelated or inactive approvers", async () => {
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const department = await Department.create({ name: "Operations", nameKey: "operations" });
  const company = await Company.create({ name: "Acme", nameKey: "acme" });
  const other = await Company.create({ name: "Other", nameKey: "other" });
  const role = await Role.create({ name: "Staff", nameKey: "staff" });
  const base = { fullName: "Test Person", username: "approver.one", designation: "Sales Manager", contact: "0771234567", password: "Password123", role: `CUSTOM_${role.id}`, status: "ACTIVE", departmentId: department.id, departmentIds: [department.id], companyIds: [company.id], sidebarAccess: ["DASHBOARD", "APPROVALS"] };
  const first = await request(app).post("/api/super-admin/users").set("Cookie", cookie).send(base).expect(201);
  const second = await request(app).post("/api/super-admin/users").set("Cookie", cookie).send({ ...base, username: "approver.two" }).expect(201);
  const member = { ...base, username: "normal.user", sidebarAccess: ["DASHBOARD", "REQUESTS"], approverIds: [first.body.user.id] };
  const created = await request(app).post("/api/super-admin/users").set("Cookie", cookie).send(member).expect(201);
  const userId = created.body.user.id;
  assert.deepEqual(created.body.user.approverIds, [first.body.user.id]);
  const staff = request.agent(app);
  await staff.post("/api/transport/auth/login").send({ username: member.username, password: member.password }).expect(200);
  assert.deepEqual((await staff.get("/api/transport/approvers").expect(200)).body.approvers.map((user) => user.id), [first.body.user.id]);
  await request(app).put(`/api/super-admin/users/${userId}`).set("Cookie", cookie).send({ ...member, companyIds: [other.id] }).expect(400);
  await User.findByIdAndUpdate(second.body.user.id, { status: "INACTIVE" });
  await request(app).put(`/api/super-admin/users/${userId}`).set("Cookie", cookie).send({ ...member, approverIds: [second.body.user.id] }).expect(400);
  await request(app).put(`/api/super-admin/users/${userId}`).set("Cookie", cookie).send({ ...member, approverIds: [userId] }).expect(400);
  await request(app).put(`/api/super-admin/users/${userId}`).set("Cookie", cookie).send({ ...member, approverIds: [] }).expect(200);
  assert.deepEqual((await staff.get("/api/transport/approvers").expect(200)).body.approvers, []);
  const list = await request(app).get("/api/super-admin/users").set("Cookie", cookie).expect(200);
  assert.deepEqual(list.body.users.find((user) => user.id === userId).approverIds, []);
});

test("department CRUD is protected, validated, unique, persistent, and reflected in dashboard totals", async () => {
  const base = "/api/super-admin/departments";
  const missingId = new mongoose.Types.ObjectId().toString();
  await request(app).get(base).expect(401);
  await request(app).post(base).send({ name: "Finance" }).expect(401);
  await request(app).put(`${base}/${missingId}`).send({ name: "Finance" }).expect(401);
  await request(app).delete(`${base}/${missingId}`).expect(401);
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const created = await request(app).post(base).set("Cookie", cookie)
    .send({ name: "  Human   Resources  ", description: "People and culture" }).expect(201);
  const id = created.body.department.id;
  assert.equal(created.body.department.name, "Human Resources");
  assert.equal(created.body.department.nameKey, undefined);
  await request(app).post(base).set("Cookie", cookie).send({ name: "human resources" }).expect(409);
  for (const body of [{ name: " " }, { name: "x" }, { name: "Finance", description: "x".repeat(501) }, { name: "Finance", role: "ADMIN" }]) {
    await request(app).post(base).set("Cookie", cookie).send(body).expect(400);
  }
  await request(app).post(base).set("Cookie", cookie).send({ name: "Finance" }).expect(201);
  await request(app).put(`${base}/${id}`).set("Cookie", cookie).send({ name: "FINANCE" }).expect(409);
  const updated = await request(app).put(`${base}/${id}`).set("Cookie", cookie)
    .send({ name: "People Operations", description: "Updated description" }).expect(200);
  assert.equal(updated.body.department.description, "Updated description");
  assert.equal((await Department.findById(id)).name, "People Operations");
  const list = await request(app).get(base).set("Cookie", cookie).expect(200);
  assert.deepEqual(list.body.departments.map((item) => item.name), ["Finance", "People Operations"]);
  const stats = await request(app).get("/api/super-admin/dashboard/stats").set("Cookie", cookie).expect(200);
  assert.equal(stats.body.totalDepartments, 2);
  await request(app).put(`${base}/bad-id`).set("Cookie", cookie).send({ name: "Valid" }).expect(400);
  await request(app).delete(`${base}/bad-id`).set("Cookie", cookie).expect(400);
  await request(app).put(`${base}/${missingId}`).set("Cookie", cookie).send({ name: "Valid" }).expect(404);
  await request(app).delete(`${base}/${missingId}`).set("Cookie", cookie).expect(404);
  await request(app).delete(`${base}/${id}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/${id}`).set("Cookie", cookie).expect(404);
  const after = await request(app).get("/api/super-admin/dashboard/stats").set("Cookie", cookie);
  assert.equal(after.body.totalDepartments, 1);
  await request(app).post(base).set("Cookie", cookie).set("Origin", "https://evil.example")
    .send({ name: "Blocked" }).expect(403);
});

test("user CRUD validates roles, credentials and department links while protecting the Super Admin", async () => {
  const base = "/api/super-admin/users";
  const absent = new mongoose.Types.ObjectId().toString();
  for (const method of ["get", "post", "put", "delete"]) {
    await request(app)[method](method === "get" || method === "post" ? base : `${base}/${absent}`).send({}).expect(401);
  }
  const verified = await complete();
  const adminId = verified.body.user.id;
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const first = await Department.create({ name: "Engineering", nameKey: "engineering" });
  const second = await Department.create({ name: "Finance", nameKey: "finance" });
  const employeeRole = await Role.create({ name: "Team Member", nameKey: "team member" });
  const managerRole = await Role.create({ name: "Team Lead", nameKey: "team lead" });
  const data = { fullName: "Taylor Silva", username: "taylor.silva", designation: "Executive", contact: "0771234567", password: "User12", role: `CUSTOM_${employeeRole.id}`, status: "ACTIVE", departmentId: first.id };
  const created = await request(app).post(base).set("Cookie", cookie).send(data).expect(201);
  const userId = created.body.user.id;
  assert.equal(created.body.user.department.name, "Engineering");
  assert.equal(created.body.user.departmentId, first.id);
  assert.equal(created.body.user.passwordHash, undefined);
  assert.equal(created.body.user.isEmailVerified, false);
  assert.equal(created.body.user.contact, "0771234567");
  assert.equal(created.body.user.email, undefined);
  assert.equal(await bcrypt.compare(data.password, (await User.findById(userId).select("+passwordHash")).passwordHash), true);
  const list = await request(app).get(base).set("Cookie", cookie).expect(200);
  assert.equal(list.body.users.length, 1);
  assert.equal(list.body.users[0].passwordHash, undefined);
  const { password, ...update } = data;
  for (const change of [{ role: "SUPER_ADMIN" }, { role: "ADMIN" }, { departmentId: absent }, { departmentId: "invalid" }, { isEmailVerified: true }, { contact: "abc1234" }, { contact: "123" }, { contact: "" }, { contact: "1".repeat(16) }, { password: "short" }, { password: "🔒".repeat(20) }, { status: "UNKNOWN" }]) {
    await request(app).post(base).set("Cookie", cookie).send({ ...data, ...change }).expect(400);
  }
  await request(app).post(base).set("Cookie", cookie).send({ ...data, username: "unique.user", departmentId: null }).expect(201);
  await request(app).post(base).set("Cookie", cookie).send({ ...data, contact: "0777654321" }).expect(409);
  await request(app).put(`${base}/${adminId}`).set("Cookie", cookie).send(update).expect(404);
  await request(app).delete(`${base}/${adminId}`).set("Cookie", cookie).expect(404);
  await request(app).put(`${base}/${userId}`).set("Cookie", cookie).send({ ...update, role: "SUPER_ADMIN" }).expect(400);
  await request(app).delete(`/api/super-admin/departments/${first.id}`).set("Cookie", cookie).expect(409);
  assert.ok(await Department.findById(first.id));
  const edited = await request(app).put(`${base}/${userId}`).set("Cookie", cookie)
    .send({ ...update, fullName: "Taylor Perera", contact: "0779998888", departmentId: second.id, role: `CUSTOM_${managerRole.id}`, status: "INACTIVE" }).expect(200);
  assert.equal(edited.body.user.department.name, "Finance");
  assert.equal(edited.body.user.isActive, false);
  assert.equal(edited.body.user.contact, "0779998888");
  assert.equal(await bcrypt.compare(password, (await User.findById(userId).select("+passwordHash")).passwordHash), true);
  await request(app).delete(`/api/super-admin/departments/${first.id}`).set("Cookie", cookie).expect(204);
  const replacement = "New123";
  await request(app).put(`${base}/${userId}`).set("Cookie", cookie).send({ ...update, departmentId: null, password: replacement }).expect(200);
  assert.equal(await bcrypt.compare(replacement, (await User.findById(userId).select("+passwordHash")).passwordHash), true);
  assert.equal((await User.findById(userId)).department, null);
  await request(app).delete(`/api/super-admin/departments/${second.id}`).set("Cookie", cookie).expect(204);
  await request(app).put(`${base}/${absent}`).set("Cookie", cookie).send({ ...update, departmentId: null }).expect(404);
  await request(app).delete(`${base}/invalid`).set("Cookie", cookie).expect(400);
  await request(app).post(base).set("Cookie", cookie).set("Origin", "https://evil.example").send(data).expect(403);
  const token = jwt.sign({ role: data.role }, config.JWT_SECRET, { subject: userId, issuer: "ctms", audience: "ctms-super-admin" });
  await request(app).get(base).set("Cookie", `ctms_session=${token}`).expect(401);
  await request(app).delete(`${base}/${userId}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/${userId}`).set("Cookie", cookie).expect(404);
  assert.equal(await User.countDocuments({ role: "SUPER_ADMIN" }), 1);
});

test("approver users can select multiple departments and companies without a location assignment", async () => {
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const departments = await Department.create([
    { name: "Finance", nameKey: "finance" },
    { name: "Operations", nameKey: "operations" },
  ]);
  const companies = await Company.create([
    { name: "Acme", nameKey: "acme" },
    { name: "Northwind", nameKey: "northwind" },
  ]);
  const role = await Role.create({ name: "Approver", nameKey: "approver" });
  const base = {
    fullName: "Alex Approver",
    username: "alex.approver",
    designation: "Finance Manager",
    contact: "0771234567",
    password: "Approver123",
    role: `CUSTOM_${role.id}`,
    status: "ACTIVE",
    sidebarAccess: ["DASHBOARD", "APPROVALS"],
    departmentId: departments[0].id,
    departmentIds: departments.map((department) => department.id),
    companyIds: companies.map((company) => company.id),
  };
  await request(app).post("/api/super-admin/users").set("Cookie", cookie)
    .send({ ...base, departmentId: null, departmentIds: [], companyIds: [] }).expect(400);
  await request(app).post("/api/super-admin/users").set("Cookie", cookie)
    .send({ ...base, companyIds: [new mongoose.Types.ObjectId().toString()] }).expect(400);
  const created = await request(app).post("/api/super-admin/users").set("Cookie", cookie)
    .send(base).expect(201);
  const { user } = created.body;
  assert.equal(user.department.name, departments[0].name);
  assert.deepEqual(user.departments.map((department) => department.name).sort(), ["Finance", "Operations"]);
  assert.deepEqual(user.companies.map((company) => company.name).sort(), ["Acme", "Northwind"]);
  assert.deepEqual(user.locationIds, []);
  assert.deepEqual(user.locations, []);
  const listed = await request(app).get("/api/super-admin/users").set("Cookie", cookie).expect(200);
  assert.deepEqual(listed.body.users[0].departmentIds.sort(), departments.map((department) => department.id).sort());
  assert.deepEqual(listed.body.users[0].companyIds.sort(), companies.map((company) => company.id).sort());
  assert.deepEqual(listed.body.users[0].locationIds, []);
  for (const department of departments) {
    await request(app).delete(`/api/super-admin/departments/${department.id}`).set("Cookie", cookie).expect(409);
  }
  await request(app).delete(`/api/super-admin/companies/${companies[0].id}`).set("Cookie", cookie).expect(409);
  const updated = await request(app).put(`/api/super-admin/users/${user.id}`).set("Cookie", cookie)
    .send({
      ...base,
      password: undefined,
      departmentIds: [],
      companyIds: [],
      locationIds: [],
    }).expect(400);
  assert.equal(updated.body.message, "Approver users must have at least one department and company assigned.");
  await request(app).put(`/api/super-admin/users/${user.id}`).set("Cookie", cookie)
    .send({
      ...base,
      password: undefined,
      sidebarAccess: ["DASHBOARD"],
      departmentId: null,
      departmentIds: [],
      companyIds: [],
      locationIds: [],
    }).expect(200);
  for (const company of companies) {
    await request(app).delete(`/api/super-admin/companies/${company.id}`).set("Cookie", cookie).expect(204);
  }
  for (const department of departments) {
    await request(app).delete(`/api/super-admin/departments/${department.id}`).set("Cookie", cookie).expect(204);
  }
});

test("legacy email index migration allows multiple users without emails and retains email uniqueness", async () => {
  await User.collection.createIndex({ email: 1 }, { name: "email_1", unique: true });
  await initializeDatabase();
  const indexes = await User.collection.indexes();
  assert.ok(indexes.some((index) => index.name === "user_email_unique" && index.unique));
  assert.equal(indexes.some((index) => index.name === "email_1"), false);
  const fields = { fullName: "Contact User", passwordHash: "test-hash", role: "EMPLOYEE", contact: "0771234567" };
  await User.create({ ...fields, username: "contact.one" });
  await User.create({ ...fields, username: "contact.two" });
  await User.create({ ...fields, username: "contact.three", email: "unique@example.com" });
  await assert.rejects(User.create({ ...fields, username: "contact.four", email: "unique@example.com" }), (error) => error.code === 11000);
});

test("department assignment and deletion cannot leave a dangling user reference", async () => {
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const department = await Department.create({ name: "Concurrent", nameKey: "concurrent" });
  const role = await Role.create({ name: "Race Tester", nameKey: "race tester" });
  const data = { fullName: "Race Test", username: "race.test", designation: "Executive", contact: "+94 77 222 3333", password: "RacePassword!123", role: `CUSTOM_${role.id}`, status: "ACTIVE", departmentId: department.id };
  const [assigned, removed] = await Promise.all([
    request(app).post("/api/super-admin/users").set("Cookie", cookie).send(data),
    request(app).delete(`/api/super-admin/departments/${department.id}`).set("Cookie", cookie),
  ]);
  assert.ok([201, 400].includes(assigned.status), JSON.stringify(assigned.body));
  assert.ok([204, 409].includes(removed.status), JSON.stringify(removed.body));
  if (await User.exists({ department: department._id })) assert.ok(await Department.exists({ _id: department._id }));
});

test("custom roles are unique, protected, persistent and assignable without Super Admin privileges", async () => {
  const base = "/api/super-admin/roles";
  const missingId = new mongoose.Types.ObjectId().toString();
  await request(app).get(base).expect(401);
  await request(app).post(base).send({ name: "Coordinator" }).expect(401);
  await request(app).put(`${base}/${missingId}`).send({ name: "Coordinator" }).expect(401);
  await request(app).delete(`${base}/${missingId}`).expect(401);
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const defaults = await request(app).get(base).set("Cookie", cookie).expect(200);
  assert.deepEqual(defaults.body.roles, []);
  for (const name of ["Super Admin", "super_admin", "Super Administrator"]) {
    await request(app).post(base).set("Cookie", cookie).send({ name }).expect(409);
  }
  for (const data of [{ name: " " }, { name: "x" }, { name: "Valid", permissions: ["SUPER_ADMIN"] }, { name: "Valid", description: "x".repeat(501) }]) {
    await request(app).post(base).set("Cookie", cookie).send(data).expect(400);
  }
  const created = await request(app).post(base).set("Cookie", cookie)
    .send({ name: " Transport   Coordinator ", description: "Coordinates transport" }).expect(201);
  assert.equal(created.body.role.name, "Transport Coordinator");
  assert.equal(created.body.role.builtIn, false);
  const role = created.body.role.value;
  await request(app).post(base).set("Cookie", cookie).send({ name: "transport coordinator" }).expect(409);
  const list = await request(app).get(base).set("Cookie", cookie).expect(200);
  assert.equal(list.body.roles.length, 1);
  const roleId = role.slice(7);
  const editedRole = await request(app).put(`${base}/${roleId}`).set("Cookie", cookie)
    .send({ name: "Transport Lead", description: "Updated responsibilities" }).expect(200);
  assert.equal(editedRole.body.role.value, role);
  assert.equal(editedRole.body.role.name, "Transport Lead");
  await request(app).post(base).set("Cookie", cookie).send({ name: "transport lead" }).expect(409);
  await request(app).put(`${base}/${roleId}`).set("Cookie", cookie)
    .send({ name: "x" }).expect(400);
  const userData = { fullName: "Sam Silva", username: "sam.silva", designation: "Executive", contact: "011 234 5678", password: "RolePassword!123", role, status: "ACTIVE", departmentId: null };
  await request(app).post("/api/super-admin/users").set("Cookie", cookie).send({ ...userData, role: "ADMIN" }).expect(400);
  const person = await request(app).post("/api/super-admin/users").set("Cookie", cookie).send(userData).expect(201);
  assert.equal(person.body.user.role, role);
  const { password, ...update } = userData;
  await request(app).delete(`${base}/${roleId}`).set("Cookie", cookie).expect(409);
  await request(app).put(`/api/super-admin/users/${person.body.user.id}`).set("Cookie", cookie).send({ ...update, role: "EMPLOYEE" }).expect(400);
  await request(app).put(`/api/super-admin/users/${person.body.user.id}`).set("Cookie", cookie).send(update).expect(200);
  assert.equal((await User.findById(person.body.user.id)).role, role);
  const unknown = `CUSTOM_${new mongoose.Types.ObjectId()}`;
  await request(app).post("/api/super-admin/users").set("Cookie", cookie).send({ ...userData, role: unknown }).expect(400);
  const token = jwt.sign({ role }, config.JWT_SECRET, { subject: person.body.user.id, issuer: "ctms", audience: "ctms-super-admin" });
  await request(app).get(base).set("Cookie", `ctms_session=${token}`).expect(401);
  await request(app).post("/api/super-admin/auth/login").send({ identifier: userData.username, password }).expect(401);
  await request(app).post(base).set("Cookie", cookie).set("Origin", "https://evil.example").send({ name: "Blocked" }).expect(403);
  await request(app).delete(`/api/super-admin/users/${person.body.user.id}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/bad-id`).set("Cookie", cookie).expect(400);
  await request(app).delete(`${base}/${roleId}`).set("Cookie", cookie).expect(204);
  await request(app).delete(`${base}/${roleId}`).set("Cookie", cookie).expect(404);
  const legacy = await User.create({
    fullName: "Legacy Staff",
    username: "legacy.staff",
    contact: "0112345678",
    passwordHash: "legacy-test-hash",
    role: "EMPLOYEE",
  });
  const legacyUpdate = await request(app).put(`/api/super-admin/users/${legacy.id}`)
    .set("Cookie", cookie)
    .send({ fullName: legacy.fullName, username: legacy.username, designation: "Executive", contact: legacy.contact, role: legacy.role, status: legacy.status, departmentId: null })
    .expect(200);
  assert.equal(legacyUpdate.body.user.role, "EMPLOYEE");
});

test("SOP workflow collects request details without transport profiles and enforces self-service, Annexure B/C, approval deadlines, booking ownership and completion", async () => {
  const verified = await complete();
  const adminCookie = verified.headers["set-cookie"][0].split(";")[0];
  const department = await Department.create({ name: "Production", nameKey: "production" });
  const company = await Company.create({ name: "FMJ", nameKey: "fmj" });
  const password = "Staff123";
  const passwordHash = await bcrypt.hash(password, 12);
  async function employee(username, designation, role = "EMPLOYEE", extra = {}) {
    return User.create({ fullName: username, username, passwordHash, contact: "0771234567", role, designation, department: department._id, departments: [department._id], company: company._id, companies: [company._id], ...extra });
  }
  const approver = await employee("approver", "Sales Manager", "MANAGER");
  const otherApprover = await employee("other.approver", "Finance Manager", "MANAGER");
  const requester = await employee("requester", "Production Executive", "EMPLOYEE", { approvers: [approver._id] });
  const outsider = await employee("outsider", "HR Executive");
  const assistant = await employee("assistant", "Administrative Assistant", "OPERATOR");
  const showroom = await User.create({ fullName: "showroom", username: "showroom", passwordHash, contact: "0771234567", role: "EMPLOYEE" });
  async function loginStaff(user) {
    const agent = request.agent(app);
    await agent.post("/api/transport/auth/login").send({ username: user.username, password }).expect(200);
    return agent;
  }
  const owner = await loginStaff(requester), reviewer = await loginStaff(approver), booking = await loginStaff(assistant);
  const other = await loginStaff(outsider), wrongReviewer = await loginStaff(otherApprover), store = await loginStaff(showroom);
  const base = "/api/transport/requests";
  const pickupAt = new Date(Date.now() + 2 * 3600000).toISOString();
  const body = { requesterDesignation: "Production Executive", requesterContact: "0771234567", departmentId: department.id, passengerCount: 1, service: "RIDE", pickupAt, pickup: "Factory 1", destination: "Head Office", vehicle: "THREE_WHEELER", purpose: "Official sample review", justification: "Required quality review", passengers: [{ name: requester.fullName, designation: "Production Executive" }] };
  await request(app).get(base).expect(401);
  await owner.get("/api/super-admin/users").expect(401);
  await owner.post(base).send(body).expect(400);
  await owner.post("/api/transport/acknowledge").send({ acknowledged: true }).expect(200);
  await store.post(base).send(body).expect(400);
  await owner.post(base).send({ ...body, requesterId: outsider.id }).expect(400);
  await owner.post(base).send({ ...body, officialOnly: false }).expect(400);
  await owner.post(base).send({ ...body, pickupAt: new Date(Date.now() + 20 * 60000).toISOString() }).expect(400);
  await owner.post(base).send({ ...body, vehicle: "CAR" }).expect(400);
  await owner.post(base).send({ ...body, passengers: [] }).expect(400);
  await owner.post(base).send({ ...body, passengerCount: 2 }).expect(400);
  await owner.post(base).send({ ...body, passengers: [{ name: "Someone Else", designation: "Executive" }] }).expect(400);
  await owner.post(base).send({ ...body, requesterContact: "invalid" }).expect(400);
  await owner.post(base).send({ ...body, departmentId: "not-an-id" }).expect(400);
  await owner.post(base).send({ ...body, approverId: outsider.id }).expect(400);
  const submitted = await owner.post(base).send(body).expect(201);
  const record = submitted.body.request;
  assert.equal(record.requesterDetails.contact, body.requesterContact);
  assert.equal(record.requesterDetails.designation, "Production Executive");
  assert.deepEqual(record.approvers.map(String), [approver.id]);
  assert.equal(record.requesterDetails.workLocation, "");
  assert.equal(record.passengerCount, 1);
  assert.equal(record.requesterDetails.department, "Production");
  assert.equal((await other.get(base)).body.requests.length, 0);
  assert.equal((await wrongReviewer.get(base)).body.requests.length, 0);
  await other.get(`${base}/${record.id}/message`).expect(404);
  await wrongReviewer.post(`${base}/${record.id}/action`).send({ action: "APPROVE", version: 0, approvalShared: true }).expect(404);
  await booking.post(`${base}/${record.id}/action`).send({ action: "BOOK", version: 0, externalActionConfirmed: true, bookingReference: "TOO-EARLY" }).expect(403);
  await reviewer.post(`${base}/${record.id}/action`).send({ action: "APPROVE", version: 0 }).expect(400);
  await TransportRequest.updateOne({ _id: record.id }, { pickupAt: new Date(Date.now() + 10 * 60000) });
  await reviewer.post(`${base}/${record.id}/action`).send({ action: "APPROVE", version: 0, approvalShared: true }).expect(400);
  await TransportRequest.updateOne({ _id: record.id }, { pickupAt: new Date(pickupAt) });
  const approved = await reviewer.post(`${base}/${record.id}/action`).send({ action: "APPROVE", version: 0, approvalShared: true }).expect(200);
  assert.equal(approved.body.request.status, "APPROVED");
  await owner.put(`${base}/${record.id}`).send({ ...body, version: 0 }).expect(409);
  await booking.post(`${base}/${record.id}/action`).send({ action: "BOOK", version: 1, bookingReference: "REF1" }).expect(400);
  const booked = await booking.post(`${base}/${record.id}/action`).send({ action: "BOOK", version: 1, bookingReference: "REF1", externalActionConfirmed: true }).expect(200);
  assert.equal(booked.body.request.status, "BOOKED");
  await owner.post(`${base}/${record.id}/action`).send({ action: "COMPLETE", version: 2 }).expect(400);
  await owner.post(`${base}/${record.id}/action`).send({ action: "COMPLETE", version: 2, routeVerified: true, completionMessageChecked: true }).expect(200);
  assert.match((await owner.get(`${base}/${record.id}/message`)).body.text, /Approved by: approver/);
  const stats = await request(app).get("/api/super-admin/dashboard/stats").set("Cookie", adminCookie).expect(200);
  assert.equal(stats.body.totalTransportRequests, 1); assert.equal(stats.body.completedBookings, 1);
  assert.equal((await request(app).get("/api/super-admin/transport/requests").set("Cookie", adminCookie)).body.requests.length, 1);
  await request(app).post(`/api/super-admin/transport/requests/${record.id}/action`).set("Cookie", adminCookie)
    .send({ action: "COMPLETE", version: 3, routeVerified: true, completionMessageChecked: true }).expect(403);
  const group = [...body.passengers, { name: "Person Two", designation: "Executive" }, { name: "Person Three", designation: "Executive" }];
  await owner.post(base).send({ ...body, vehicle: "CAR", passengers: group }).expect(400);
  await owner.post(base).send({ ...body, vehicle: "CAR", passengers: group, passengerCount: 3, groupCarEligible: true }).expect(201);
  const flash = { ...body, service: "FLASH", passengers: [], passengerCount: 0, deliveryRoute: "CUSTOMER_DELIVERY", receiverName: "Receiver", receiverContact: "0771234567", itemDetails: "Fabric samples" };
  await owner.post(base).send(flash).expect(400);
  await owner.post(base).send({ ...flash, vehicle: "MOTORBIKE", receiverContact: "bad" }).expect(400);
  await owner.post(base).send({ ...flash, vehicle: "MOTORBIKE" }).expect(201);
  await User.updateOne({ _id: requester._id }, { isActive: false });
  await owner.get(base).expect(401);
});

test("Super Admin sidebar grants persist, control staff actions, and revoke access in an existing session", async () => {
  const verified = await complete();
  const cookie = verified.headers["set-cookie"][0].split(";")[0];
  const base = "/api/super-admin/users";
  const team = await Department.create({ name: "Transport", nameKey: "transport" });
  const company = await Company.create({ name: "Transport Co", nameKey: "transport co" });
  const staffRole = await Role.create({ name: "Transport Staff", nameKey: "transport staff" });
  const account = (username, sidebarAccess) => ({ fullName: username, username, designation: "Executive", contact: "0771234567", password: "Staff123", role: `CUSTOM_${staffRole.id}`, status: "ACTIVE", departmentId: null, sidebarAccess });
  const ownerData = account("access.owner", ["DASHBOARD", "REQUESTS", "REPORTS"]);
  const reviewerData = {
    ...account("access.approver", ["DASHBOARD"]),
    departmentId: team.id,
    departmentIds: [team.id],
    companyIds: [company.id],
  };
  const bookerData = account("access.booker", ["DASHBOARD"]);
  const create = async (data) => (await request(app).post(base).set("Cookie", cookie).send(data).expect(201)).body.user;
  const reviewerUser = await create(reviewerData);
  const ownerUser = await create({ ...ownerData, departmentId: team.id, departmentIds: [team.id], companyIds: [company.id], approverIds: [] });
  const bookerUser = await create(bookerData);
  assert.deepEqual(ownerUser.sidebarAccess, ownerData.sidebarAccess);
  for (const sidebarAccess of [["SUPER_ADMIN"], ["REQUESTS", "REQUESTS"], "REQUESTS", null]) {
    await request(app).post(base).set("Cookie", cookie).send({ ...ownerData, username: "invalid.access", sidebarAccess }).expect(400);
  }
  const grant = async (user, data, sidebarAccess) => {
    const result = await request(app).put(`${base}/${user.id}`).set("Cookie", cookie).send({ ...data, sidebarAccess }).expect(200);
    assert.deepEqual(result.body.user.sidebarAccess, sidebarAccess);
  };
  async function login(user) { const client = request.agent(app); await client.post("/api/transport/auth/login").send({ username: user.username, password: "Staff123" }).expect(200); return client; }
  const owner = await login(ownerUser), reviewer = await login(reviewerUser), booker = await login(bookerUser);
  await owner.post("/api/transport/acknowledge").send({ acknowledged: true }).expect(200);
  await owner.put(`${base}/${ownerUser.id}`).send({ ...ownerData, sidebarAccess: ["BOOKINGS"] }).expect(401);
  const body = { requesterDesignation: "Executive", requesterContact: "0771234567", departmentId: team.id, passengerCount: 1, service: "RIDE", pickupAt: new Date(Date.now() + 3 * 3600000).toISOString(), pickup: "Office", destination: "Factory", vehicle: "THREE_WHEELER", purpose: "Official review", justification: "Production review", passengers: [{ name: ownerUser.fullName, designation: "Executive" }] };
  await owner.post("/api/transport/requests").send(body).expect(400);
  await grant(reviewerUser, reviewerData, ["DASHBOARD", "APPROVALS"]);
  await request(app).put(`${base}/${ownerUser.id}`).set("Cookie", cookie).send({ ...ownerData, departmentId: team.id, departmentIds: [team.id], companyIds: [company.id], approverIds: [reviewerUser.id] }).expect(200);
  assert.equal((await reviewer.get("/api/transport/me")).body.user.permissions.approve, true);
  const approvers = (await owner.get("/api/transport/approvers").expect(200)).body.approvers;
  assert.ok(approvers.some((person) => person.id === reviewerUser.id));
  const record = (await owner.post("/api/transport/requests").send(body).expect(201)).body.request;
  const action = `/api/transport/requests/${record.id}/action`;
  await grant(reviewerUser, reviewerData, ["DASHBOARD"]);
  await reviewer.post(action).send({ action: "APPROVE", version: 0, approvalShared: true }).expect(403);
  await grant(reviewerUser, reviewerData, ["APPROVALS"]);
  await reviewer.post(action).send({ action: "APPROVE", version: 0, approvalShared: true }).expect(200);
  await booker.post(action).send({ action: "BOOK", version: 1, externalActionConfirmed: true, bookingReference: "ACCESS-001" }).expect(404);
  await grant(bookerUser, bookerData, ["BOOKINGS"]);
  await booker.post(action).send({ action: "BOOK", version: 1, externalActionConfirmed: true, bookingReference: "ACCESS-001" }).expect(200);
  await grant(bookerUser, bookerData, []);
  await booker.get("/api/transport/requests").expect(403);
  await grant(ownerUser, ownerData, ["REPORTS", "HISTORY"]);
  await owner.get("/api/transport/requests").expect(200);
  await owner.post("/api/transport/requests").send(body).expect(403);
  await owner.post(action).send({ action: "CANCEL", version: 2, note: "Cancel" }).expect(403);
  const profile = (await owner.get("/api/transport/me").expect(200)).body.user;
  assert.deepEqual(profile.sidebarAccess, ["REPORTS", "HISTORY"]);
  assert.equal(profile.permissions.request, false);
});

test("SOP changes, returns and cancellations require responsible staff and reject stale versions", async () => {
  const department = await Department.create({ name: "Accounts", nameKey: "accounts" });
  const company = await Company.create({ name: "Accounts Co", nameKey: "accounts co" });
  const passwordHash = await bcrypt.hash("Staff123", 12);
  const common = { passwordHash, contact: "0771234567", department: department._id, departments: [department._id], company: company._id, companies: [company._id], locationType: "HEAD_OFFICE", workLocation: "Head Office", sopAcknowledgedAt: new Date() };
  const approver = await User.create({ ...common, fullName: "Approver", username: "approver", role: "MANAGER", designation: "Finance Manager" });
  const secondApprover = await User.create({ ...common, fullName: "Second Approver", username: "second.approver", role: "MANAGER", designation: "Finance Manager" });
  const ownerUser = await User.create({ ...common, fullName: "Owner", username: "owner", role: "EMPLOYEE", designation: "Accounts Executive", approvers: [approver._id, secondApprover._id] });
  const operator = await User.create({ ...common, fullName: "Assistant", username: "assistant", role: "OPERATOR", designation: "Administrative Assistant" });
  const stranger = await User.create({ ...common, fullName: "Other Manager", username: "other.manager", role: "MANAGER", designation: "Finance Manager" });
  async function agent(user) { const agent = request.agent(app); await agent.post("/api/transport/auth/login").send({ username: user.username, password: "Staff123" }).expect(200); return agent; }
  const owner = await agent(ownerUser), reviewer = await agent(approver), alsoReviewer = await agent(secondApprover), assistant = await agent(operator), outsider = await agent(stranger);
  const base = "/api/transport/requests";
  const body = { requesterDesignation: "Accounts Executive", requesterContact: "0771234567", departmentId: department.id, passengerCount: 1, service: "RIDE", pickupAt: new Date(Date.now() + 3 * 3600000).toISOString(), pickup: "Office", destination: "Factory", vehicle: "THREE_WHEELER", purpose: "Accounts review", justification: "Official review", passengers: [{ name: "Owner", designation: "Accounts Executive" }] };
  let record = (await owner.post(base).send(body).expect(201)).body.request;
  assert.deepEqual(record.approvers.map(String).sort(), [approver.id, secondApprover.id].sort());
  assert.equal((await alsoReviewer.get(base)).body.requests.length, 1);
  assert.equal((await outsider.get(base)).body.requests.length, 0);
  await outsider.post(`${base}/${record.id}/action`).send({ action: "APPROVE", version: record.version, approvalShared: true }).expect(404);
  async function act(agent, action, extra = {}) { const result = await agent.post(`${base}/${record.id}/action`).send({ action, version: record.version, ...extra }).expect(200); record = result.body.request; }
  await act(reviewer, "RETURN", { note: "Clarify purpose" });
  await owner.put(`${base}/${record.id}`).send({ ...body, version: 0 }).expect(409);
  record = (await owner.put(`${base}/${record.id}`).send({ ...body, version: record.version }).expect(200)).body.request;
  await act(reviewer, "APPROVE", { approvalShared: true });
  await act(assistant, "BOOK", { bookingReference: "REF2", externalActionConfirmed: true });
  await act(owner, "REPORT_ISSUE", { note: "Driver delayed; notify assistant" });
  await act(owner, "REQUEST_CHANGE", { note: "Destination needs changing" });
  await assistant.post(`${base}/${record.id}/action`).send({ action: "CONFIRM_CHANGE", version: record.version, note: "Resolved" }).expect(403);
  await act(assistant, "CONFIRM_CHANGE", { externalActionConfirmed: true, note: "Old PickMe booking cancelled; resubmit" });
  record = (await owner.put(`${base}/${record.id}`).send({ ...body, version: record.version }).expect(200)).body.request;
  assert.equal(record.approvalSharedAt, null);
  await act(reviewer, "APPROVE", { approvalShared: true });
  await act(assistant, "BOOK", { bookingReference: "REF3", externalActionConfirmed: true });
  await act(owner, "CANCEL", { note: "Meeting cancelled" });
  assert.equal(record.status, "CANCELLATION_REQUESTED");
  await owner.post(`${base}/${record.id}/action`).send({ action: "CONFIRM_CANCEL", version: record.version, externalActionConfirmed: true, note: "Cancel" }).expect(403);
  await act(assistant, "CONFIRM_CANCEL", { externalActionConfirmed: true, note: "Cancelled in PickMe" });
  assert.equal(record.status, "CANCELLED");
  assert.ok(record.history.some((item) => item.action === "REPORT_ISSUE"));
  await owner.post("/api/transport/auth/logout").send({}).expect(204);
  await owner.get(base).expect(401);
});

test("all setup endpoints remain closed even after the Super Admin is deleted", async () => {
  await complete();
  await User.deleteMany({});
  assert.equal(
    (await request(app).get("/api/setup/status")).body.setupRequired,
    false,
  );
  for (const endpoint of ["super-admin", "verify-otp", "resend-otp"])
    await request(app).post(`/api/setup/${endpoint}`).send({}).expect(409);
});
test("simultaneous valid verifications create only one Super Admin", async () => {
  const first = await pending();
  const second = await pending({
    ...details,
    username: "second.admin",
    email: "second@example.com",
  });
  const results = await Promise.all(
    [first, first, second].map((data) =>
      request(app)
        .post("/api/setup/verify-otp")
        .send({ setupId: data.setupId, otp: data.otp }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(
    results.every((r) => [201, 409].includes(r.status)),
    JSON.stringify(results.map((r) => ({ status: r.status, body: r.body }))),
  );
  assert.equal(await User.countDocuments({ role: "SUPER_ADMIN" }), 1);
  assert.equal(await SetupState.countDocuments(), 1);
  assert.equal(await SuperAdminSetup.countDocuments(), 0);
});
test("five wrong attempts lock a challenge, including concurrent guesses", async () => {
  const data = await pending();
  const wrong = data.otp === "000000" ? "111111" : "000000";
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(app)
        .post("/api/setup/verify-otp")
        .send({ setupId: data.setupId, otp: wrong }),
    ),
  );
  assert.ok(results.every((r) => r.status === 400));
  assert.equal((await SuperAdminSetup.findById(data.setupId)).attempts, 5);
  await request(app)
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: data.otp })
    .expect(400);
  await SuperAdminSetup.updateOne(
    { _id: data.setupId },
    { lastOtpSentAt: new Date(Date.now() - 61000) },
  );
  await request(app)
    .post("/api/setup/resend-otp")
    .send({ setupId: data.setupId })
    .expect(429);
  assert.equal(await User.countDocuments(), 0);
});
test("expiry is enforced without waiting for TTL cleanup", async () => {
  const data = await pending();
  await SuperAdminSetup.updateOne(
    { _id: data.setupId },
    { expiresAt: new Date(Date.now() - 1000) },
  );
  await request(app)
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: data.otp })
    .expect(400);
  await request(app)
    .post("/api/setup/resend-otp")
    .send({ setupId: data.setupId })
    .expect(429);
  assert.equal(await User.countDocuments(), 0);
});
test("resend enforces cooldown atomically, replaces the code, and preserves attempts", async () => {
  const data = await pending();
  await request(app)
    .post("/api/setup/resend-otp")
    .send({ setupId: data.setupId })
    .expect(429);
  await SuperAdminSetup.updateOne(
    { _id: data.setupId },
    { attempts: 2, lastOtpSentAt: new Date(Date.now() - 61000) },
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      request(app)
        .post("/api/setup/resend-otp")
        .send({ setupId: data.setupId }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
  assert.equal(sent.length, 2);
  assert.equal((await SuperAdminSetup.findById(data.setupId)).attempts, 2);
  // The new code is independently random, so it may equal the old one by chance.
  if (sent[1].otp !== data.otp)
    await request(app)
      .post("/api/setup/verify-otp")
      .send({ setupId: data.setupId, otp: data.otp })
      .expect(400);
  await request(app)
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: sent[1].otp })
    .expect(201);
});
test("SMTP failure creates no account and allows retry; resend failure preserves the old code", async () => {
  failMail = true;
  await request(app).post("/api/setup/super-admin").send(details).expect(503);
  assert.equal(await SuperAdminSetup.countDocuments(), 0);
  assert.equal(await User.countDocuments(), 0);
  failMail = false;
  const data = await pending();
  await SuperAdminSetup.updateOne(
    { _id: data.setupId },
    { lastOtpSentAt: new Date(Date.now() - 61000) },
  );
  failMail = true;
  await request(app)
    .post("/api/setup/resend-otp")
    .send({ setupId: data.setupId })
    .expect(503);
  await request(app)
    .post("/api/setup/verify-otp")
    .send({ setupId: data.setupId, otp: data.otp })
    .expect(201);
});
test("input validation, duplicate pending details, cross-origin requests, and privilege injection are rejected", async () => {
  for (const change of [
    { password: "short", confirmPassword: "short" },
    { confirmPassword: "does not match" },
    { email: { $ne: null } },
    { username: "<script>" },
    { role: "SUPER_ADMIN" },
    { password: "😀".repeat(24), confirmPassword: "😀".repeat(24) },
  ]) {
    await request(app)
      .post("/api/setup/super-admin")
      .send({ ...details, ...change })
      .expect(400);
  }
  await request(app)
    .post("/api/setup/super-admin")
    .set("Origin", "https://evil.example")
    .send(details)
    .expect(403);
  await pending();
  await request(app).post("/api/setup/super-admin").send(details).expect(409);
  await request(app).post("/api/register").send(details).expect(404);
});
test("non-Super-Admin roles, disabled accounts, forged tokens, and anonymous requests cannot access protected APIs", async () => {
  const passwordHash = await bcrypt.hash(details.password, 12);
  for (const role of ["EMPLOYEE", "MANAGER", "OPERATOR", "ADMIN"]) {
    const user = await User.create({
      fullName: role,
      username: role.toLowerCase(),
      email: `${role.toLowerCase()}@example.com`,
      passwordHash,
      role,
      isEmailVerified: true,
    });
    const cookie = jwt.sign({ role }, config.JWT_SECRET, {
      subject: user.id,
      issuer: "ctms",
      audience: "ctms-super-admin",
    });
    await request(app)
      .get("/api/super-admin/dashboard/stats")
      .set("Cookie", `ctms_session=${cookie}`)
      .expect(401);
    await request(app)
      .post("/api/super-admin/auth/login")
      .send({ identifier: user.username, password: details.password })
      .expect(401);
  }
  await request(app).get("/api/super-admin/auth/me").expect(401);
  await request(app)
    .get("/api/super-admin/dashboard/stats")
    .set("Cookie", "ctms_session=forged")
    .expect(401);
  const verified = await complete();
  await User.updateOne({ role: "SUPER_ADMIN" }, { isActive: false });
  await request(app)
    .get("/api/super-admin/auth/me")
    .set("Cookie", verified.headers["set-cookie"][0].split(";")[0])
    .expect(401);
  await request(app)
    .post("/api/super-admin/auth/login")
    .send({ identifier: details.username, password: details.password })
    .expect(401);
});
test("unique database index independently rejects multiple Super Admins", async () => {
  await complete();
  await assert.rejects(
    User.create({
      fullName: "Other Admin",
      username: "other",
      email: "other@example.com",
      passwordHash: "not-used",
      role: "SUPER_ADMIN",
    }),
    (error) => error.code === 11000,
  );
});
test("dashboard counts existing users and startup seals setup for an existing Super Admin", async () => {
  const verified = await complete();
  const passwordHash = await bcrypt.hash(details.password, 12);
  await User.insertMany([
    {
      fullName: "Employee One",
      username: "employee.one",
      email: "employee.one@example.com",
      role: "EMPLOYEE",
      passwordHash,
    },
    {
      fullName: "Employee Two",
      username: "employee.two",
      email: "employee.two@example.com",
      role: "EMPLOYEE",
      passwordHash,
    },
    {
      fullName: "Manager One",
      username: "manager.one",
      email: "manager.one@example.com",
      role: "MANAGER",
      passwordHash,
    },
  ]);
  const stats = await request(app)
    .get("/api/super-admin/dashboard/stats")
    .set("Cookie", verified.headers["set-cookie"][0].split(";")[0])
    .expect(200);
  assert.equal(stats.body.totalEmployees, 2);
  assert.equal(stats.body.totalManagers, 1);
  await SetupState.deleteMany({});
  await initializeDatabase();
  assert.equal(await SetupState.countDocuments({ _id: "super-admin" }), 1);
  assert.equal(
    (await request(app).get("/api/setup/status")).body.setupRequired,
    false,
  );
});
test("configuration rejects insecure or malformed production settings", () => {
  const base = {
    MONGODB_URI: "mongodb://localhost/ctms",
    JWT_SECRET: config.JWT_SECRET,
    SMTP_HOST: "smtp.example.com",
    SMTP_FROM_EMAIL: "ctms@example.com",
  };
  assert.equal(readConfig(base).OTP_EXPIRES_MINUTES, 5);
  for (const change of [
    { OTP_EXPIRES_MINUTES: "6" },
    { OTP_RESEND_SECONDS: "1" },
    { JWT_EXPIRES_IN: "0h" },
    { PORT: "0" },
    { APP_ORIGIN: "http://localhost:5173/path" },
    { NODE_ENV: "production", APP_ORIGIN: "http://ctms.example.com" },
  ])
    assert.throws(() => readConfig({ ...base, ...change }));
  assert.equal(
    readConfig({
      ...base,
      NODE_ENV: "production",
      APP_ORIGIN: "https://ctms.example.com",
    }).NODE_ENV,
    "production",
  );
});
test("OTP submission and login are rate limited", async () => {
  for (let i = 0; i < 10; i++)
    await request(app).post("/api/setup/super-admin").send({}).expect(400);
  await request(app).post("/api/setup/super-admin").send({}).expect(429);
  for (let i = 0; i < 10; i++)
    await request(app).post("/api/super-admin/auth/login").send({}).expect(400);
  await request(app).post("/api/super-admin/auth/login").send({}).expect(429);
});
test("production cookie has Secure and secrets are rejected when configuration is incomplete", async () => {
  app = createApp({ config: { ...config, NODE_ENV: "production" }, mailer });
  const result = await complete();
  assert.match(result.headers["set-cookie"][0], /Secure/);
  assert.throws(() => readConfig({}));
});
