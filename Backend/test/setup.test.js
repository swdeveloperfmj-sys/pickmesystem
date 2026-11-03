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
      replSet: { count: 1, storageEngine: "wiredTiger" },
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
    SuperAdminSetup.deleteMany({}),
    SetupState.deleteMany({}),
    AuditLog.deleteMany({}),
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
  assert.equal(stats.body.totalDepartments, null);
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
