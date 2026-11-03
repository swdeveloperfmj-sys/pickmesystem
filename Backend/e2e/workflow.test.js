import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium } from "playwright";
import { createApp } from "../src/app.js";
import { initializeDatabase, User } from "../src/models.js";

test(
  "browser: initial setup → OTP → dashboard → logout → login, including mobile layout",
  { timeout: 180000 },
  async () => {
    const frontendRequire = createRequire(
      new URL("../../Frontend/package.json", import.meta.url),
    );
    const { createServer } = await import(
      pathToFileURL(frontendRequire.resolve("vite")).href
    );
    let mongo, backend, vite, browser, page;
    let sentOtp;
    try {
      mongo = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        binary: { version: "8.0.17" },
      });
      await mongoose.connect(mongo.getUri());
      await initializeDatabase();
      const config = {
        JWT_SECRET: "browser-test-only-secret-at-least-32-characters",
        JWT_EXPIRES_IN: "8h",
        OTP_EXPIRES_MINUTES: 5,
        OTP_RESEND_SECONDS: 60,
        NODE_ENV: "test",
        APP_ORIGIN: "",
      };
      const app = createApp({
        config,
        mailer: {
          async sendOtp(_email, otp) {
            sentOtp = otp;
          },
        },
      });
      backend = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => backend.once("listening", resolve));
      vite = await createServer({
        root: fileURLToPath(new URL("../../Frontend", import.meta.url)),
        configFile: fileURLToPath(
          new URL("../../Frontend/vite.config.js", import.meta.url),
        ),
        server: {
          host: "127.0.0.1",
          port: 0,
          proxy: { "/api": `http://127.0.0.1:${backend.address().port}` },
        },
      });
      await vite.listen();
      config.APP_ORIGIN = `http://127.0.0.1:${vite.httpServer.address().port}`;
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(15000);
      const pageErrors = [];
      let logoutRequests = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/api/super-admin/auth/logout")) logoutRequests++;
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(config.APP_ORIGIN);
      await page.waitForURL("**/super-admin/setup");
      const artifactDir = fileURLToPath(new URL("../artifacts", import.meta.url));
      await mkdir(artifactDir, { recursive: true });
      async function checkResponsiveLayout({ navigation = false } = {}) {
        for (const width of [320, 360, 390, 600, 768, 900, 1024]) {
          await page.setViewportSize({ width, height: 844 });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
            `Page must fit a ${width}px viewport`,
          );
          if (navigation && width <= 900) {
            const menu = page.getByRole("button", { name: "Navigation menu" });
            assert.equal(await menu.getAttribute("aria-expanded"), "false");
            const contentBefore = await page.locator(".dashboard-main").boundingBox();
            await menu.click();
            const contentAfter = await page.locator(".dashboard-main").boundingBox();
            assert.equal(contentAfter.y, contentBefore.y, "Opening navigation must not move content");
            await page.getByRole("button", { name: "Close navigation menu" }).waitFor();
            await page.getByRole("button", { name: "System Settings", exact: true }).click();
            await page.getByRole("heading", { name: "System Settings", exact: true, level: 1 }).waitFor();
            assert.equal(await menu.getAttribute("aria-expanded"), "false");
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
              `Long section names must fit a ${width}px viewport`,
            );
            await menu.click();
            await page.getByRole("button", { name: "Dashboard", exact: true }).click();
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      async function logout() {
        const menu = page.getByRole("button", { name: "Navigation menu" });
        if (await menu.isVisible() && await menu.getAttribute("aria-expanded") === "false") {
          await menu.click();
        }
        const before = logoutRequests;
        const trigger = page.getByRole("button", { name: "Logout", exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Log out?", exact: true });
        await dialog.waitFor();
        assert.equal(logoutRequests, before);
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(logoutRequests, before);
        await trigger.click();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(logoutRequests, before);
        await trigger.click();
        await page.screenshot({ path: `${artifactDir}/logout-confirmation.png`, fullPage: true });
        await dialog.getByRole("button", { name: "Logout", exact: true }).click();
      }
      const themeSwitch = page.getByRole("switch", { name: "Dark mode" });
      if (await themeSwitch.getAttribute("aria-checked") === "true") {
        await themeSwitch.click();
      }
      await themeSwitch.click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.reload();
      await page.getByRole("switch", { name: "Dark mode", checked: true }).waitFor();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/setup-dark-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/setup-dark-mobile.png`, fullPage: true });
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByLabel("Full name", { exact: true }).fill("Alex Morgan");
      await page.getByLabel("Username", { exact: true }).fill("alex.morgan");
      await page
        .getByLabel("Email address", { exact: true })
        .fill("alex@example.com");
      await page
        .getByLabel("Password", { exact: true })
        .fill("LongSecurePassword!123");
      await page
        .getByRole("button", { name: "Show password", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Password", { exact: true }).getAttribute("type"),
        "text",
      );
      await page
        .getByRole("button", { name: "Hide password", exact: true })
        .click();
      await page
        .getByLabel("Confirm password", { exact: true })
        .fill("LongSecurePassword!123");
      await page.screenshot({
        path: `${artifactDir}/setup-desktop.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `${artifactDir}/setup-mobile.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole("button", { name: "Continue to email verification" })
        .click();
      await page.waitForURL("**/super-admin/verify-email");
      await checkResponsiveLayout();
      assert.equal(await User.countDocuments(), 0);
      assert.match(sentOtp, /^\d{6}$/);
      assert.equal(
        await page.getByRole("button", { name: /Resend code in/ }).isDisabled(),
        true,
      );
      await page.getByLabel("Verification code", { exact: true }).fill(sentOtp);
      await page
        .getByRole("button", { name: "Verify email & create account" })
        .click();
      await page.waitForURL("**/super-admin/dashboard");
      await page
        .getByRole("heading", { name: "Overview", exact: true })
        .waitFor();
      assert.equal(await User.countDocuments({ role: "SUPER_ADMIN" }), 1);
      assert.deepEqual(
        await page.evaluate(() => Object.entries(localStorage)),
        [["ctms-theme", "light"]],
      );
      assert.equal(
        await page.evaluate(() => document.cookie.includes("ctms_session")),
        false,
      );
      await page.getByRole("switch", { name: "Dark mode", checked: false }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await checkResponsiveLayout({ navigation: true });
      await page.screenshot({ path: `${artifactDir}/dashboard-dark-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/dashboard-dark-mobile.png`, fullPage: true });
      await page.getByRole("button", { name: "Navigation menu" }).click();
      await page.screenshot({ path: `${artifactDir}/navigation-mobile.png`, fullPage: true });
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name: "Navigation menu" }).getAttribute("aria-expanded"), "false");
      await page.getByRole("button", { name: "Navigation menu" }).click();
      await page.getByRole("button", { name: "Close navigation menu" }).click({ position: { x: 380, y: 830 } });
      assert.equal(await page.getByRole("button", { name: "Navigation menu" }).getAttribute("aria-expanded"), "false");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.screenshot({
        path: `${artifactDir}/dashboard-desktop.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `${artifactDir}/dashboard-mobile.png`,
        fullPage: true,
      });
      async function selectSection(name) {
        const menu = page.getByRole("button", { name: "Navigation menu" });
        if (await menu.isVisible() && await menu.getAttribute("aria-expanded") === "false") await menu.click();
        await page.getByRole("button", { name, exact: true }).click();
      }
      await selectSection("Department Management");
      await page.getByLabel("Department name", { exact: true }).fill("Human Resources");
      await page.getByLabel("Description (optional)", { exact: true }).fill("People and culture");
      await page.getByRole("button", { name: "Create department", exact: true }).click();
      await page.getByText("Department created.", { exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
      assert.equal(await page.locator(".metric").filter({ hasText: "Total Departments" }).locator("strong").innerText(), "1");
      await selectSection("Department Management");
      const department = page.getByRole("article", { name: "Human Resources", exact: true });
      await department.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Department name", { exact: true }).fill("People Operations");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.getByText("Department updated.", { exact: true }).waitFor();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/departments-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.screenshot({ path: `${artifactDir}/departments-dark-mobile.png`, fullPage: true });
      await page.getByLabel("Department name", { exact: true }).fill("Finance");
      await page.getByRole("button", { name: "Create department", exact: true }).click();
      await page.getByText("Department created.", { exact: true }).waitFor();
      await selectSection("User Management");
      await page.getByRole("button", { name: "Roles", exact: true }).click();
      await page.getByLabel("Role name", { exact: true }).fill("Transport Coordinator");
      await page.getByLabel("Role description (optional)", { exact: true }).fill("Coordinates company transport");
      await page.getByRole("button", { name: "Create role", exact: true }).click();
      await page.getByText("Role created. You can now assign it from the Users section.", { exact: true }).waitFor();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/roles-dark-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/roles-dark-mobile.png`, fullPage: true });
      await page.getByRole("button", { name: "Users", exact: true }).click();
      await page.getByLabel("Full name", { exact: true }).fill("Jamie Silva");
      await page.getByLabel("Username", { exact: true }).fill("jamie.silva");
      await page.getByLabel("Email address", { exact: true }).fill("jamie@example.com");
      await page.getByLabel("Password", { exact: true }).fill("UserPassword!123");
      await page.getByLabel("Role", { exact: true }).selectOption({ label: "Transport Coordinator" });
      await page.getByLabel("Department", { exact: true }).selectOption({ label: "People Operations" });
      await page.getByRole("button", { name: "Create user", exact: true }).click();
      await page.getByText("User created.", { exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
      assert.equal(await page.locator(".metric").filter({ hasText: "Total Employees" }).locator("strong").innerText(), "0");
      await selectSection("User Management");
      const person = page.getByRole("article", { name: "Jamie Silva", exact: true });
      await person.getByText(/Transport Coordinator/).waitFor();
      await person.getByText(/People Operations/).waitFor();
      await person.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Role", { exact: true }).selectOption("MANAGER");
      await page.getByLabel("Status", { exact: true }).selectOption("INACTIVE");
      await page.getByLabel("Department", { exact: true }).selectOption({ label: "Finance" });
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.getByText("User updated.", { exact: true }).waitFor();
      await person.getByText("Manager · Inactive · Finance", { exact: true }).waitFor();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/users-dark-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/users-dark-mobile.png`, fullPage: true });
      await selectSection("Department Management");
      const finance = page.getByRole("article", { name: "Finance", exact: true });
      await finance.getByRole("button", { name: "Delete", exact: true }).click();
      await finance.getByRole("button", { name: "Confirm delete" }).click();
      await page.getByRole("alert").filter({ hasText: "This department has assigned users" }).waitFor();
      await finance.getByRole("button", { name: "Keep department" }).click();
      await selectSection("User Management");
      await person.getByRole("button", { name: "Delete", exact: true }).click();
      await person.getByRole("button", { name: "Keep user" }).click();
      await person.getByRole("button", { name: "Delete", exact: true }).click();
      await person.getByRole("button", { name: "Confirm delete" }).click();
      await page.getByText("User deleted.", { exact: true }).waitFor();
      await selectSection("Department Management");
      await finance.getByRole("button", { name: "Delete", exact: true }).click();
      await finance.getByRole("button", { name: "Confirm delete" }).click();
      await page.getByText("Department deleted.", { exact: true }).waitFor();
      const updatedDepartment = page.getByRole("article", { name: "People Operations", exact: true });
      await updatedDepartment.getByRole("button", { name: "Delete", exact: true }).click();
      await updatedDepartment.getByRole("button", { name: "Keep department" }).click();
      assert.equal(await User.countDocuments({ role: "SUPER_ADMIN" }), 1);
      await updatedDepartment.getByRole("button", { name: "Delete", exact: true }).click();
      await updatedDepartment.getByRole("button", { name: "Confirm delete" }).click();
      await page.getByText("Department deleted.", { exact: true }).waitFor();
      await selectSection("Dashboard");
      assert.equal(await page.locator(".metric").filter({ hasText: "Total Departments" }).locator("strong").innerText(), "0");
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await logout();
      await page.waitForURL("**/super-admin/login");
      await checkResponsiveLayout();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByLabel("Username or email", { exact: true })
        .fill("alex@example.com");
      await page
        .getByLabel("Password", { exact: true })
        .fill("LongSecurePassword!123");
      await page.getByRole("button", { name: "Sign in securely" }).click();
      await page.waitForURL("**/super-admin/dashboard");
      await page.goto(`${config.APP_ORIGIN}/super-admin/setup`);
      await page.waitForURL("**/super-admin/login");
      await page.goto(`${config.APP_ORIGIN}/super-admin/dashboard`);
      await page
        .getByRole("heading", { name: "Overview", exact: true })
        .waitFor();
      await logout();
      await page.waitForURL("**/super-admin/login");
      await page.goto(`${config.APP_ORIGIN}/super-admin/dashboard`);
      await page.waitForURL("**/super-admin/login");
      assert.deepEqual(pageErrors, []);
    } catch (error) {
      if (page && !page.isClosed()) {
        await page.screenshot({ path: fileURLToPath(new URL("../artifacts/workflow-failure.png", import.meta.url)), fullPage: true }).catch(() => {});
        console.error("Browser workflow failed:", error.message);
      }
      throw error;
    } finally {
      await browser?.close();
      await vite?.close();
      if (backend) await new Promise((resolve) => backend.close(resolve));
      await mongoose.disconnect();
      await mongo?.stop();
    }
  },
);
