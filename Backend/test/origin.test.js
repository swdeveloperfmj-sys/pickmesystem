import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

const config = {
  APP_ORIGIN: "http://localhost:5173",
  NODE_ENV: "development",
};

test("development login accepts local hostname aliases through the origin guard", async () => {
  const app = createApp({ config, mailer: {}, limits: false });
  for (const origin of [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ]) {
    // An empty login reaches validation (400), without database access.
    await request(app)
      .post("/api/super-admin/auth/login")
      .set("Origin", origin)
      .send({})
      .expect(400);
  }
});

test("development rejects foreign origins, other ports, schemes, and malformed origins", async () => {
  const app = createApp({ config, mailer: {}, limits: false });
  for (const origin of [
    "http://example.com:5173",
    "http://localhost.evil.example:5173",
    "http://127.0.0.1:5174",
    "https://127.0.0.1:5173",
    "http://127.0.0.1:5173/path",
    "null",
  ]) {
    const response = await request(app)
      .post("/api/setup/super-admin")
      .set("Origin", origin)
      .send({})
      .expect(403);
    assert.equal(response.body.message, "Request origin is not allowed.");
  }
});

test("production continues to require the exact configured origin", async () => {
  const app = createApp({
    config: { ...config, NODE_ENV: "production" },
    mailer: {},
    limits: false,
  });
  await request(app)
    .post("/api/super-admin/auth/login")
    .set("Origin", config.APP_ORIGIN)
    .send({})
    .expect(400);
  await request(app)
    .post("/api/super-admin/auth/login")
    .set("Origin", "http://127.0.0.1:5173")
    .send({})
    .expect(403);
});

test("production allows credentialed API requests only from the configured frontend", async () => {
  const frontendOrigin = "https://frontend.example.com";
  const app = createApp({
    config: {
      ...config,
      APP_ORIGIN: frontendOrigin,
      NODE_ENV: "production",
    },
    mailer: {},
    limits: false,
  });
  const response = await request(app)
    .get("/api/super-admin/auth/me")
    .set("Origin", frontendOrigin)
    .expect(401);
  assert.equal(response.headers["access-control-allow-origin"], frontendOrigin);
  assert.equal(response.headers["access-control-allow-credentials"], "true");

  await request(app)
    .options("/api/super-admin/auth/login")
    .set("Origin", frontendOrigin)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type")
    .expect(204)
    .expect("Access-Control-Allow-Origin", frontendOrigin);
  await request(app)
    .options("/api/super-admin/auth/login")
    .set("Origin", "https://attacker.example")
    .set("Access-Control-Request-Method", "POST")
    .expect(403);
});
