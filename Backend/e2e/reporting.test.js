import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

test("reports and audit UI: filters, export, errors and mobile themes", { timeout: 60000 }, async () => {
  const require = createRequire(new URL("../../Frontend/package.json", import.meta.url));
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const vite = await createServer({ root: fileURLToPath(new URL("../../Frontend", import.meta.url)), server: { port: 0, strictPort: false } });
  let browser;
  try {
    await vite.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
    async function checkLayout(module) {
      for (const width of [1920, 1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
          const layout = await page.locator(".insight-filters").evaluate((element) => {
            const box = element.getBoundingClientRect();
            const fields = [...element.querySelectorAll("label")].map((field) => field.getBoundingClientRect().height);
            return { height: box.height, fields };
          });
          assert.ok(layout.fields.every((height) => height < 100), `${module}: compact fields at ${width}`);
          assert.ok(layout.height < (width > 1000 ? 300 : 800), `${module}: compact filter panel at ${width}`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${module}: no overflow at ${width}`);
          await page.screenshot({ path: fileURLToPath(new URL(`../artifacts/${module}-${theme}-${width}.png`, import.meta.url)), fullPage: true });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    let failAudit = false;
    let settingsUser = { fullName: "Test Administrator", username: "admin", email: "admin@example.com" };
    let settingsCredit = 1000;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let body = {};
      if (url.pathname.endsWith("/settings")) body = { user: settingsUser, security: { sessionDuration: "8h", otpExpiryMinutes: 5, otpResendSeconds: 60, secureCookies: false }, transport: { minimumNoticeMinutes: 30, timezone: "Asia/Colombo", currency: "LKR", vehicles: ["CAR", "THREE_WHEELER"] } };
      if (url.pathname.endsWith("/settings/profile")) { settingsUser = { ...settingsUser, ...route.request().postDataJSON() }; body = { user: settingsUser }; }
      if (url.pathname.endsWith("/budget")) { if (route.request().method() === "PUT") settingsCredit = route.request().postDataJSON().creditLimit; body = { creditLimit: settingsCredit }; }
      if (url.pathname.endsWith("/companies")) body = { companies: [{ budget: 200 }] };
      if (url.pathname.endsWith("/setup/status")) body = { setupRequired: false };
      if (url.pathname.endsWith("/auth/me")) body = { user: { fullName: "Test Administrator" } };
      if (url.pathname.endsWith("/requests")) body = { requests: [
        { id: "request-1", requesterDetails: { fullName: "Alex", department: "Finance" }, pickup: "Colombo", destination: "Kandy", pickupAt: "2026-11-12T08:00:00Z", service: "RIDE", status: "COMPLETED", bookingAmount: 2500 },
        { id: "request-2", requesterDetails: { fullName: "Sam", department: "Sales" }, pickup: "Galle", destination: "Colombo", pickupAt: "2026-11-13T08:00:00Z", service: "FLASH", status: "PENDING_APPROVAL" },
      ] };
      if (url.pathname.endsWith("/audit-logs")) {
        if (failAudit) return route.fulfill({ status: 500, json: { message: "Test service unavailable" } });
        body = { logs: url.searchParams.has("search") ? [] : [{ _id: "log-1", event: "SUBMITTED", source: "TRANSPORT", at: "2026-11-12T08:00:00Z", actorName: "Alex", reference: "request-1", note: "Request submitted" }], total: url.searchParams.has("search") ? 0 : 1 };
      }
      await route.fulfill({ json: body });
    });
    await page.goto(`http://localhost:${vite.httpServer.address().port}/super-admin/dashboard`);
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page.getByRole("cell", { name: "Alex Finance request-1" }).waitFor();
    await checkLayout("reports");
    await page.getByLabel("Search requests").fill("Alex");
    assert.equal(await page.locator("tbody tr").count(), 1);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    assert.equal((await download).suggestedFilename(), "transport-report.csv");
    await page.getByLabel("Search requests").fill("missing");
    await page.getByRole("heading", { name: "No matching requests" }).waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Service", { exact: true }).selectOption("FLASH");
    assert.equal(await page.locator("tbody tr").count(), 1);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow: ${width} ${theme}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Audit Logs", exact: true }).click();
    await page.getByRole("cell", { name: "Alex", exact: true }).waitFor();
    await checkLayout("audit-logs");
    await page.getByLabel("Search activity").fill("missing");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.getByRole("heading", { name: "No matching activity" }).waitFor();
    failAudit = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Test service unavailable" }).waitFor();
    failAudit = false;
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("cell", { name: "Alex", exact: true }).waitFor();
    await page.getByRole("button", { name: "System Settings", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).fill("New Administrator");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Administrator profile saved." }).waitFor();
    assert.equal(settingsUser.fullName, "New Administrator");
    await page.getByLabel("Weekly credit limit (LKR)").fill("2000");
    await page.getByRole("button", { name: "Save credit limit" }).click();
    await page.getByRole("status").filter({ hasText: "Weekly transport credit limit saved." }).waitFor();
    assert.equal(settingsCredit, 2000);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Settings no overflow at ${width}`);
        await page.screenshot({ path: fileURLToPath(new URL(`../artifacts/settings-${theme}-${width}.png`, import.meta.url)), fullPage: true });
      }
    }
  } finally {
    await browser?.close();
    await vite.close();
  }
});
