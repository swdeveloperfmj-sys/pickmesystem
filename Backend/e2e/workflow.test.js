import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium } from "playwright";
import { createApp } from "../src/app.js";
import { initializeDatabase, User, Department, Company, TransportRequest } from "../src/models.js";

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
        replSet: { count: 1, args: ["--setParameter", "indexBuildMinAvailableDiskSpaceMB=50"] },
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
            await page.locator(".dashboard-top > span").filter({ hasText: "System Settings" }).waitFor();
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
        .locator(".dashboard-top > span").filter({ hasText: "Dashboard" })
        .waitFor();
      assert.equal(await User.countDocuments({ role: "SUPER_ADMIN" }), 1);
      const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
      await collapse.click();
      assert.equal((await page.locator(".sidebar").boundingBox()).width, 80);
      assert.equal((await page.locator(".dashboard-main").boundingBox()).x, 80);
      assert.equal(await page.locator(".sidebar-toggle").isVisible(), false);
      await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      assert.equal((await page.locator(".sidebar").boundingBox()).width, 252);
      await collapse.click();
      await page.getByRole("button", { name: "Department Management", exact: true }).click();
      await page.locator(".dashboard-top > span").filter({ hasText: "Department Management" }).waitFor();
      assert.equal((await page.locator(".sidebar").boundingBox()).width, 252);
      await page.getByRole("button", { name: "Dashboard", exact: true }).click();
      await collapse.click();
      await page.screenshot({ path: `${artifactDir}/sidebar-collapsed.png`, fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal((await page.locator(".sidebar").boundingBox()).width, 390);
      await page.getByRole("button", { name: "Navigation menu" }).click();
      await page.getByRole("button", { name: "Dashboard", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal((await page.locator(".sidebar").boundingBox()).width, 252);
      await collapse.click();
      await page.getByRole("button", { name: "Expand sidebar", exact: true }).focus();
      await page.keyboard.press("Enter");
      assert.equal((await page.locator(".sidebar").boundingBox()).width, 252);
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
      await page.getByRole("button", { name: "+ Create department", exact: true }).click();
      await page.getByLabel("Department name", { exact: true }).fill("Human Resources");
      await page.getByLabel("Description (optional)", { exact: true }).fill("People and culture");
      await page.getByRole("button", { name: "Create department", exact: true }).click();
      await page.getByText("Department created.", { exact: true }).waitFor();
      await page.reload();
      await page.locator(".dashboard-top > span").filter({ hasText: "Dashboard" }).waitFor();
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
      await page.getByRole("button", { name: "Companies", exact: true }).click();
      await page.getByRole("button", { name: "+ Create company", exact: true }).click();
      await page.getByLabel("Company name", { exact: true }).fill("Acme Holdings");
      await page.getByRole("button", { name: "Create company", exact: true }).click();
      const company = page.getByRole("article", { name: "Acme Holdings", exact: true });
      await company.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Company name", { exact: true }).fill("Acme Group");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      const updatedCompany = page.getByRole("article", { name: "Acme Group", exact: true });
      await updatedCompany.waitFor();
      await checkResponsiveLayout();
      await updatedCompany.getByRole("button", { name: "Delete", exact: true }).click();
      await updatedCompany.getByRole("button", { name: "Confirm delete", exact: true }).click();
      await page.getByText("Company deleted.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Departments", exact: true }).click();
      await page.getByRole("button", { name: "+ Create department", exact: true }).click();
      await page.getByLabel("Department name", { exact: true }).fill("Finance");
      await page.getByRole("button", { name: "Create department", exact: true }).click();
      await page.getByText("Department created.", { exact: true }).waitFor();
      await selectSection("User Management");
      await page.getByRole("button", { name: "Roles", exact: true }).click();
      await page.getByRole("button", { name: "+ Create role", exact: true }).click();
      await page.getByLabel("Role name", { exact: true }).fill("Transport Coordinator");
      await page.getByLabel("Description (optional)", { exact: true }).fill("Coordinates company transport");
      await page.getByRole("dialog", { name: "Create role", exact: true }).getByRole("button", { name: "Create role", exact: true }).click();
      await page.getByText("Role created.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "+ Create role", exact: true }).click();
      await page.getByLabel("Role name", { exact: true }).fill("Manager");
      await page.getByRole("dialog", { name: "Create role", exact: true }).getByRole("button", { name: "Create role", exact: true }).click();
      await page.getByText("Role created.", { exact: true }).waitFor();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/roles-dark-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/roles-dark-mobile.png`, fullPage: true });
      await page.getByRole("button", { name: "Users", exact: true }).click();
      await page.getByRole("button", { name: "Add user", exact: true }).click();
      await page.getByRole("dialog", { name: "Create user", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Create user", exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Add user", exact: true }).click();
      await page.getByLabel("Full name", { exact: true }).fill("Jamie Silva");
      await page.getByLabel("Username", { exact: true }).fill("jamie.silva");
      assert.equal(await page.getByLabel("Email address", { exact: true }).count(), 0);
      await page.getByLabel("Contact number", { exact: true }).fill("0771234567");
      await page.getByLabel("Password", { exact: true }).fill("User12");
      await page.getByLabel("Role", { exact: true }).selectOption({ label: "Transport Coordinator" });
      assert.equal(await page.getByRole("group", { name: "Transport profile (SOP)", exact: true }).count(), 0);
      await page.getByLabel("Department", { exact: true }).selectOption({ label: "People Operations" });
      await page.getByRole("group", { name: "Sidebar access", exact: true }).getByRole("checkbox", { name: /^Reports/ }).check();
      await page.getByRole("button", { name: "Create user", exact: true }).click();
      await page.getByText("User created.", { exact: true }).waitFor();
      await page.reload();
      await page.locator(".dashboard-top > span").filter({ hasText: "Dashboard" }).waitFor();
      assert.equal(await page.locator(".metric").filter({ hasText: "Total Employees" }).locator("strong").innerText(), "0");
      await selectSection("User Management");
      const person = page.getByRole("row", { name: "Jamie Silva", exact: true });
      await person.getByText(/Transport Coordinator/).waitFor();
      await person.getByText(/People Operations/).waitFor();
      await person.getByRole("button", { name: "Edit", exact: true }).click();
      assert.equal(await page.getByRole("group", { name: "Transport profile (SOP)", exact: true }).count(), 0);
      assert.equal(await page.getByRole("group", { name: "Sidebar access", exact: true }).getByRole("checkbox", { name: /^Reports/ }).isChecked(), true);
      assert.equal(await page.getByLabel("Contact number", { exact: true }).inputValue(), "0771234567");
      await page.getByLabel("Contact number", { exact: true }).fill("0777654321");
      await page.getByLabel("Role", { exact: true }).selectOption({ label: "Manager" });
      await page.getByLabel("Status", { exact: true }).selectOption("INACTIVE");
      await page.getByLabel("Department", { exact: true }).selectOption({ label: "Finance" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: `${artifactDir}/user-editor-dark-desktop.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.getByText("User updated.", { exact: true }).waitFor();
      await person.getByText("Manager", { exact: true }).waitFor();
      await person.getByText("Inactive", { exact: true }).waitFor();
      await person.getByText("Finance", { exact: true }).waitFor();
      await person.getByText(/0777654321/).waitFor();
      const directoryHash = await bcrypt.hash("Sample123", 12);
      await User.insertMany(Array.from({ length: 12 }, (_, index) => ({ fullName: `Team Member ${String(index + 1).padStart(2, "0")}`, username: `directory.sample${index + 1}`, contact: `0771234${String(index).padStart(3, "0")}`, role: index % 3 === 0 ? "ADMIN" : index % 3 === 1 ? "EMPLOYEE" : "OPERATOR", passwordHash: directoryHash })));
      await page.reload();
      await page.locator(".dashboard-top > span").filter({ hasText: "Dashboard" }).waitFor();
      await selectSection("User Management");
      await page.getByText("Page 1 of 2", { exact: true }).waitFor();
      assert.equal(await page.locator(".user-table tbody tr").count(), 10);
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByText("Page 2 of 2", { exact: true }).waitFor();
      assert.equal(await page.locator(".user-table tbody tr").count(), 3);
      await page.getByRole("button", { name: "Previous", exact: true }).click();
      await page.getByLabel("Search users", { exact: true }).fill("no-match-example");
      await page.getByText("No matching users", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await page.getByLabel("Filter by role", { exact: true }).selectOption({ label: "Manager" });
      assert.equal(await page.locator(".user-table tbody tr").count(), 1);
      await page.getByLabel("Filter by department", { exact: true }).selectOption({ label: "Finance" });
      await page.getByLabel("Filter by status", { exact: true }).selectOption("ACTIVE");
      await page.getByText("No matching users", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/users-dark-desktop.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.screenshot({ path: `${artifactDir}/users-light-desktop.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator(".user-table-scroll").evaluate((element) => element.scrollWidth > element.clientWidth), true);
      await page.screenshot({ path: `${artifactDir}/users-dark-mobile.png`, fullPage: true, animations: "disabled" });
      await selectSection("Department Management");
      const finance = page.getByRole("article", { name: "Finance", exact: true });
      await finance.getByRole("button", { name: "Delete", exact: true }).click();
      await finance.getByRole("button", { name: "Confirm delete" }).click();
      await page.getByRole("alert").filter({ hasText: "This department has assigned users" }).waitFor();
      await finance.getByRole("button", { name: "Keep department" }).click();
      await selectSection("User Management");
      await person.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete user?", exact: true }).getByRole("button", { name: "Keep user" }).click();
      await person.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete user?", exact: true }).getByRole("button", { name: "Confirm delete" }).click();
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
        .locator(".dashboard-top > span").filter({ hasText: "Dashboard" })
        .waitFor();
      await logout();
      await page.waitForURL("**/super-admin/login");
      await page.goto(`${config.APP_ORIGIN}/super-admin/dashboard`);
      await page.waitForURL("**/super-admin/login");
      const transportDept = await Department.create({ name: "Transport Test", nameKey: "transport test" });
      const passwordHash = await bcrypt.hash("Staff123", 12);
      const common = { passwordHash, department: transportDept._id, contact: "0771234567" };
      const transportCompany = await Company.create({ name: "Transport Co", nameKey: "transport co e2e" });
      const staffApprover = await User.create({ ...common, fullName: "Sales Approver", username: "sales.approver", role: "MANAGER", departments: [transportDept._id], companies: [transportCompany._id], company: transportCompany._id });
      const staffRequester = await User.create({ ...common, fullName: "Request Employee", username: "request.employee", role: "EMPLOYEE", sidebarAccess: ["DASHBOARD", "REQUESTS", "REPORTS", "HISTORY"], departments: [transportDept._id], companies: [transportCompany._id], company: transportCompany._id, approvers: [staffApprover._id] });
      await User.create({ ...common, fullName: "Booking Assistant", username: "booking.assistant", role: "OPERATOR" });
      async function staffLogin(username, password = "Staff123") {
        await page.goto(`${config.APP_ORIGIN}/login`);
        await page.getByLabel("Username", { exact: true }).fill(username);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Sign in to transport", exact: true }).click();
        await page.waitForURL("**/transport");
        await page.getByRole("heading", { name: /^Welcome,/ }).waitFor();
      }
      async function staffLogout() {
        await page.getByRole("button", { name: "Logout", exact: true }).click();
        await page.getByRole("dialog", { name: "Log out?" }).getByRole("button", { name: "Logout", exact: true }).click();
        await page.waitForURL("**/login");
      }
      await staffLogin(staffRequester.username);
      await page.setViewportSize({ width: 1440, height: 900 });
      const staffNav = page.getByRole("navigation", { name: "Staff workspace", exact: true });
      assert.equal(await staffNav.getByRole("button", { name: "Transport Requests", exact: true }).count(), 1);
      assert.equal(await staffNav.getByRole("button", { name: "Approval Management", exact: true }).count(), 0);
      assert.equal(await staffNav.getByRole("button", { name: "Booking Management", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      assert.equal(await page.locator(".sidebar-toggle").isVisible(), false);
      await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      await staffNav.getByRole("button", { name: "Reports", exact: true }).click();
      await page.getByRole("heading", { name: "Reports", exact: true }).waitFor();
      await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      await staffNav.getByRole("button", { name: "Request History", exact: true }).click();
      assert.equal(await page.locator(".staff-dashboard").evaluate((element) => element.classList.contains("sidebar-collapsed")), false);
      await page.getByRole("heading", { name: "Request History", exact: true }).waitFor();
      await staffNav.getByRole("button", { name: "Dashboard", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Navigation menu", exact: true }).click();
      await staffNav.getByRole("button", { name: "Transport Requests", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Navigation menu", exact: true }).getAttribute("aria-expanded"), "false");
      await page.getByRole("button", { name: "Navigation menu", exact: true }).click();
      await staffNav.getByRole("button", { name: "Dashboard", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "New request", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: /Read guidelines/ }).click();
      await page.getByRole("button", { name: "I have read and understood the SOP", exact: true }).click();
      await page.getByRole("button", { name: "New request", exact: true }).click();
      await page.getByLabel("Requester designation", { exact: true }).fill("Production Executive");
      assert.equal(await page.getByLabel("Number of passengers", { exact: true }).inputValue(), "1");
      assert.equal(await page.getByLabel("Number of passengers", { exact: true }).getAttribute("readonly"), "");
      await page.getByLabel("Additional passengers (optional)", { exact: true }).fill("Person Two | Executive\n\nPerson Three | Engineer");
      assert.equal(await page.getByLabel("Number of passengers", { exact: true }).inputValue(), "3");
      await page.getByLabel("Additional passengers (optional)", { exact: true }).fill("Person Two | Executive\n   ");
      assert.equal(await page.getByLabel("Number of passengers", { exact: true }).inputValue(), "2");
      await page.getByLabel("Department / work location", { exact: true }).fill("Factory 1");
      await page.getByText("Assigned approvers: Sales Approver", { exact: true }).waitFor();
      const future = await page.evaluate(() => { const date = new Date(Date.now() + 3 * 3600000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
      await page.getByLabel("Pickup date and time", { exact: true }).fill(future);
      await page.getByLabel("Pickup location", { exact: true }).fill("Factory 1");
      await page.getByLabel("Destination", { exact: true }).fill("Head Office");
      await page.getByLabel("Official purpose", { exact: true }).fill("Official quality meeting");
      await page.getByLabel("Justification", { exact: true }).fill("Review production samples with management");
      await page.getByRole("button", { name: "Prepare WhatsApp request text", exact: true }).click();
      assert.match(await page.getByLabel("WhatsApp request text", { exact: true }).inputValue(), /Request Employee/);
      await page.getByRole("checkbox", { name: /This is my own necessary official request/ }).check();
      await page.getByRole("checkbox", { name: /I have shared these request details/ }).check();
      await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
      await page.getByText("Pending approval", { exact: true }).waitFor();
      const savedTrip = await TransportRequest.findOne({ requester: staffRequester._id });
      assert.equal(savedTrip.passengerCount, 2);
      assert.equal(savedTrip.passengers.length, 2);
      assert.equal(await page.locator(".staff-stat").filter({ hasText: "Awaiting approval" }).locator("strong").innerText(), "1");
      await checkResponsiveLayout();
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.screenshot({ path: `${artifactDir}/staff-dashboard-dark-desktop.png`, fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/staff-request-mobile.png`, fullPage: true, animations: "disabled" });
      assert.equal(await page.getByRole("button", { name: "Approve", exact: true }).count(), 0);
      await staffLogout();
      await staffLogin("sales.approver");
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByRole("checkbox", { name: /I checked need, justification and vehicle eligibility/ }).check();
      await page.getByRole("button", { name: "Confirm action", exact: true }).click();
      await page.getByText("Approved", { exact: true }).waitFor();
      await staffLogout();
      await staffLogin("booking.assistant");
      await page.getByRole("button", { name: "Book", exact: true }).click();
      await page.getByLabel("PickMe booking reference", { exact: true }).fill("TEST-PICKME-001");
      await page.getByRole("checkbox", { name: /I checked completeness and approval/ }).check();
      await page.getByRole("button", { name: "Confirm action", exact: true }).click();
      await page.getByText("Booked", { exact: true }).waitFor();
      await page.screenshot({ path: `${artifactDir}/staff-booking-mobile.png`, fullPage: true, animations: "disabled" });
      await staffLogout();
      await staffLogin(staffRequester.username);
      await page.getByRole("button", { name: "Complete", exact: true }).click();
      await page.getByRole("checkbox", { name: "I verified the pickup location, route and destination.", exact: true }).check();
      await page.getByRole("checkbox", { name: "I checked the trip completion message.", exact: true }).check();
      await page.getByRole("button", { name: "Confirm action", exact: true }).click();
      await page.locator(".request-card").getByText("Completed", { exact: true }).waitFor();
      assert.equal(await TransportRequest.countDocuments({ status: "COMPLETED" }), 1);
      await staffLogout();
      await staffLogin("directory.sample1", "Sample123");
      assert.equal(await page.getByRole("heading", { name: "Finish your account setup", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "New request", exact: true }).isDisabled(), true);
      await page.getByText("Read guidelines and acknowledge the SOP to create a request.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("dialog", { name: "Transport guidelines", exact: true }).isVisible(), false);
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/staff-setup-dark-desktop.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("switch", { name: "Dark mode" }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      await page.screenshot({ path: `${artifactDir}/staff-setup-light-desktop.png`, fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/staff-setup-mobile.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: /Read guidelines/ }).click();
      await page.getByRole("dialog", { name: "Transport guidelines", exact: true }).waitFor();
      await page.getByRole("button", { name: "I have read and understood the SOP", exact: true }).click();
      await page.getByRole("dialog", { name: "Transport guidelines", exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "New request", exact: true }).click();
      await page.getByLabel("Requester designation", { exact: true }).waitFor();
      await checkResponsiveLayout();
      await page.screenshot({ path: `${artifactDir}/request-form-desktop.png`, fullPage: true, animations: "disabled" });
      await page.getByLabel("Service", { exact: true }).selectOption("FLASH");
      await page.getByLabel("Receiver name", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Number of passengers", { exact: true }).count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${artifactDir}/request-form-flash-mobile.png`, fullPage: true, animations: "disabled" });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Transport guidelines", exact: true }).waitFor({ state: "hidden" });
      await User.updateOne({ username: "directory.sample1" }, { $set: { sidebarAccess: [] } });
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByRole("heading", { name: "No workspace access assigned", exact: true }).waitFor();
      assert.equal(await page.getByRole("navigation", { name: "Staff workspace", exact: true }).getByRole("button").count(), 0);
      assert.equal(await page.getByRole("button", { name: "New request", exact: true }).count(), 0);
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
