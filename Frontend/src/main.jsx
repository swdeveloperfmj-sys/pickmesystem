import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { api } from "./api";
import "./styles.css";

const ThemeContext = createContext(null);

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content", theme === "dark" ? "#171717" : "#ffbd44",
    );
    try {
      localStorage.setItem("ctms-theme", theme);
    } catch {}
  }, [theme]);
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useContext(ThemeContext);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-label="Dark mode"
      aria-checked={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <span aria-hidden="true">{dark ? "☾" : "☀"}</span>
      {dark ? "Dark mode" : "Light mode"}
      <i aria-hidden="true" />
    </button>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">C</span>
      <span>
        CTMS<small>TRANSPORT MANAGEMENT</small>
      </span>
    </div>
  );
}
function AuthLayout({ children, step, login = false }) {
  return (
    <main className="auth-shell">
      <aside className="story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">YOUR ORGANIZATION. CONNECTED.</span>
          <h1>
            A better journey
            <br />
            starts here.
          </h1>
          <p>
            One place to manage your people, approvals, and company transport.
          </p>
          <div className="route-art" aria-hidden="true">
            <span className="route-dot" />
            <div />
            <span className="route-dot end" />
          </div>
          <div className="trust">
            <span>✓</span>
            <div>
              <strong>Secure by design</strong>
              <small>Verified access. Clear accountability.</small>
            </div>
          </div>
        </div>
        <footer>Company Transport Management System</footer>
      </aside>
      <section className="auth-main">
        <div className="auth-top">
          ADMINISTRATION PORTAL
          <div className="header-actions">
            <span>● Secure access</span>
            <ThemeToggle />
          </div>
        </div>
        <div className="form-wrap">
          <div className="mobile-brand">
            <Brand />
          </div>
          {!login && (
            <div className="steps">
              <span className={step === 1 ? "current" : "done"}>
                1 <b>Account details</b>
              </span>
              <i />
              <span className={step === 2 ? "current" : ""}>
                2 <b>Verify email</b>
              </span>
            </div>
          )}
          {children}
        </div>
        <footer className="auth-footer">
          Protected access for your organization’s administrators.
        </footer>
      </section>
    </main>
  );
}
function ErrorBox({ error }) {
  return error ? (
    <div role="alert" className="error">
      {error}
    </div>
  ) : null;
}
function PasswordField({
  label = "Password",
  name = "password",
  minLength,
  autoComplete = "new-password",
  value,
  onChange,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={name}>{label}</label>
      <span className="password-input">
        <input
          id={name}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </div>
  );
}
function Setup({ refreshStatus }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const strength =
    Number(password.length >= 12) +
    Number(/[a-z]/.test(password) && /[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  async function submit(event) {
    event.preventDefault();
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.password !== data.confirmPassword)
      return setError("Passwords must match.");
    if (new TextEncoder().encode(data.password).length > 72)
      return setError("Use a password of no more than 72 UTF-8 bytes.");
    setBusy(true);
    try {
      const result = await api("/setup/super-admin", data);
      sessionStorage.setItem(
        "ctms_pending",
        JSON.stringify({ ...result, email: data.email }),
      );
      navigate("/super-admin/verify-email");
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await refreshStatus();
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout step={1}>
      <span className="eyebrow accent">INITIAL SETUP</span>
      <h2>
        Company Transport
        <br />
        Management System
      </h2>
      <p className="subtitle">Create Your Super Administrator Account</p>
      <p className="muted">
        Set up the first account to securely manage your organization.
      </p>
      <ErrorBox error={error} />
      <form onSubmit={submit}>
        <label>
          Full name
          <input
            name="fullName"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            placeholder="Enter your full name"
          />
        </label>
        <div className="field-row">
          <label>
            Username
            <input
              name="username"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9_.\-]+"
              autoComplete="username"
              placeholder="e.g. alex.morgan"
            />
          </label>
          <label>
            Email address
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@company.com"
            />
          </label>
        </div>
        <PasswordField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
        />
        <div className="strength" aria-live="polite">
          <div>
            {[1, 2, 3, 4].map((i) => (
              <i
                key={i}
                className={password && strength >= i ? `level-${strength}` : ""}
              />
            ))}
          </div>
          <small>
            {password
              ? ["Very weak", "Weak", "Fair", "Good", "Strong"][strength]
              : "Use at least 12 characters. Mix letters, numbers, and symbols."}
          </small>
        </div>
        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          minLength={12}
        />
        <div className="info">
          <span>◇</span>
          <p>
            We’ll email you a verification code. Your account is created only
            after your email is verified.
          </p>
        </div>
        <button className="primary" disabled={busy}>
          {busy
            ? "Sending verification code…"
            : "Continue to email verification"}{" "}
          <span>→</span>
        </button>
      </form>
      <p className="form-bottom">
        Already set up? <Link to="/super-admin/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
function readPending() {
  try {
    return JSON.parse(sessionStorage.getItem("ctms_pending"));
  } catch {
    return null;
  }
}
function Verify({ refreshStatus }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(readPending);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!pending?.setupId) return <Navigate to="/super-admin/setup" replace />;
  const cooldown = Math.max(
    0,
    Math.ceil((new Date(pending.resendAt).getTime() - now) / 1000),
  );
  const remaining = Math.max(
    0,
    Math.ceil((new Date(pending.expiresAt).getTime() - now) / 1000),
  );
  async function verify(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/setup/verify-otp", {
        setupId: pending.setupId,
        otp: new FormData(event.currentTarget).get("otp"),
      });
      sessionStorage.removeItem("ctms_pending");
      await refreshStatus();
      navigate("/super-admin/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await refreshStatus();
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/setup/resend-otp", {
        setupId: pending.setupId,
      });
      const updated = { ...pending, ...result };
      setPending(updated);
      sessionStorage.setItem("ctms_pending", JSON.stringify(updated));
      setNotice("A new code has been sent. Use the most recent email.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout step={2}>
      <span className="eyebrow accent">EMAIL VERIFICATION</span>
      <h2>Check your inbox.</h2>
      <p className="subtitle">One last step to get started</p>
      <p className="muted">
        Enter the six-digit code sent to <strong>{pending.email}</strong>.
      </p>
      <ErrorBox error={error} />
      {notice && (
        <p role="status" className="info">
          {notice}
        </p>
      )}
      <form onSubmit={verify}>
        <label>
          Verification code
          <input
            className="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            placeholder="000000"
          />
        </label>
        <p className="muted" aria-live="off">
          {remaining
            ? `Code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
            : "This code has expired. Return to setup to request a new code."}
        </p>
        <button className="primary" disabled={busy || !remaining}>
          {busy ? "Please wait…" : "Verify email & create account"}{" "}
          <span>→</span>
        </button>
      </form>
      <button
        className="text-button"
        onClick={resend}
        disabled={busy || cooldown > 0 || !remaining}
      >
        {cooldown ? `Resend code in ${cooldown}s` : "Resend verification code"}
      </button>
      <p className="form-bottom">
        <Link to="/super-admin/setup">← Return to account details</Link>
      </p>
      <div className="info">
        Five incorrect codes will lock this verification. Resending does not
        reset the attempt limit.
      </div>
    </AuthLayout>
  );
}
function Login({ setupRequired }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(
        "/super-admin/auth/login",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      navigate("/super-admin/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout login>
      <span className="eyebrow accent">SUPER ADMINISTRATOR</span>
      <h2>Welcome back.</h2>
      <p className="subtitle">Sign in to your administration portal</p>
      <p className="muted">Use your verified Super Administrator account.</p>
      <ErrorBox error={error} />
      <form onSubmit={submit}>
        <label>
          Username or email
          <input
            name="identifier"
            required
            maxLength={254}
            autoComplete="username"
            placeholder="Enter your username or email"
          />
        </label>
        <PasswordField autoComplete="current-password" />
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in securely"} <span>→</span>
        </button>
      </form>
      {setupRequired && (
        <p className="form-bottom">
          First time here?{" "}
          <Link to="/super-admin/setup">Set up your account</Link>
        </p>
      )}
    </AuthLayout>
  );
}
const sections = [
  "Dashboard",
  "User Management",
  "Department Management",
  "Manager Management",
  "Transport Requests",
  "Approval Management",
  "Booking Management",
  "Reports",
  "Audit Logs",
  "System Settings",
];
const metrics = [
  ["Total Employees", "totalEmployees", "People in your organization"],
  ["Total Departments", "totalDepartments", "Organizational units"],
  ["Total Managers", "totalManagers", "Approval team members"],
  [
    "Total Transport Requests",
    "totalTransportRequests",
    "All transport requests",
  ],
  ["Pending Approvals", "pendingApprovals", "Awaiting a decision"],
  ["Completed Bookings", "completedBookings", "Successfully completed trips"],
];
function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [section, setSection] = useState("Dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.querySelector(".menu-toggle")?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  async function load() {
    setError("");
    try {
      const [profile, data] = await Promise.all([
        api("/super-admin/auth/me"),
        api("/super-admin/dashboard/stats"),
      ]);
      setUser(profile.user);
      setStats(data);
    } catch (err) {
      if (err.status === 401) navigate("/super-admin/login", { replace: true });
      else setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function logout() {
    try {
      await api("/super-admin/auth/logout", {});
      navigate("/super-admin/login", { replace: true });
    } catch (err) {
      setError(err.message);
    }
  }
  if (!user)
    return (
      <div className="loading">
        <p>{error || "Opening your administration portal…"}</p>
        {error && <button onClick={load}>Try again</button>}
      </div>
    );
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-heading">
          <Brand />
          <button
            type="button"
            className="menu-toggle"
            aria-label="Navigation menu"
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
        <div className={`sidebar-menu${menuOpen ? " is-open" : ""}`} id="workspace-navigation">
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Workspace">
          {sections.map((item, i) => (
            <button
              key={item}
              onClick={() => {
                setSection(item);
                setMenuOpen(false);
              }}
              aria-current={section === item ? "page" : undefined}
              className={section === item ? "active" : ""}
            >
              <span aria-hidden="true">
                {["▦", "♙", "▤", "♧", "⇄", "☑", "▣", "▥", "◷", "⚙"][i]}
              </span>
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{user.fullName[0]}</span>
          <div>
            <strong>{user.fullName}</strong>
            <small>Super Administrator</small>
          </div>
          <button onClick={logout} title="Logout" aria-label="Logout">
            ↪
          </button>
        </div>
        </div>
      </aside>
      {menuOpen && (
        <button
          type="button"
          className="menu-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <main className="dashboard-main">
        <header className="dashboard-top">
          <span>
            Administration <b>/</b> {section}
          </span>
          <div className="header-actions">
            <span className="badge connection-badge">● System connected</span>
            <ThemeToggle />
          </div>
        </header>
        <div className="dashboard-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow accent">YOUR WORKSPACE AT A GLANCE</span>
              <h1>{section === "Dashboard" ? "Overview" : section}</h1>
              <p className="muted">
                {section === "Dashboard"
                  ? `Welcome back, ${user.fullName.split(" ")[0]}. Here’s your organization today.`
                  : "Manage your organization from one secure workspace."}
              </p>
            </div>
            <button className="secondary" onClick={load}>
              ↻ Refresh
            </button>
          </div>
          <ErrorBox error={error} />
          {section === "Dashboard" ? (
            <>
              <div className="metric-grid">
                {metrics.map(([label, key, description], i) => (
                  <article className="metric" key={key}>
                    <div>
                      <span>{label}</span>
                      <span
                        className={`metric-icon color-${i % 3}`}
                        aria-hidden="true"
                      >
                        {["♙", "▤", "♧", "⇄", "◷", "✓"][i]}
                      </span>
                    </div>
                    <strong>
                      {stats?.[key] == null ? "—" : stats[key].toLocaleString()}
                    </strong>
                    <small>
                      {stats?.[key] == null ? "Not connected yet" : description}
                    </small>
                  </article>
                ))}
              </div>
              <section className="welcome-card">
                <div className="welcome-symbol">✓</div>
                <div>
                  <span className="eyebrow accent">READY FOR WHAT’S NEXT</span>
                  <h2>Your administration workspace is ready.</h2>
                  <p>
                    Your verified Super Administrator account is active.
                    Employee and manager totals are connected to your user
                    directory.
                  </p>
                  <p className="muted">
                    Department, transport, approval, and booking statistics will
                    appear when their modules are connected.
                  </p>
                </div>
              </section>
              <div className="account-card">
                <div>
                  <h3>Account security</h3>
                  <p className="muted">
                    Initial setup is permanently closed. Access is restricted to
                    your verified account.
                  </p>
                </div>
                <span className="badge">✓ Email verified</span>
              </div>
            </>
          ) : (
            <section className="empty-state">
              <span className="welcome-symbol">◇</span>
              <h2>{section}</h2>
              <p>This module is not connected in this workspace yet.</p>
              <p className="muted">
                Your Super Administrator access is ready. This workspace
                currently includes secure setup, authentication, and the
                overview dashboard.
              </p>
              <button
                className="secondary"
                onClick={() => setSection("Dashboard")}
              >
                Return to dashboard
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
function App() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  async function refreshStatus() {
    const data = await api("/setup/status");
    setStatus(data);
    setError("");
    return data;
  }
  useEffect(() => {
    refreshStatus().catch((err) => setError(err.message));
  }, []);
  if (!status)
    return (
      <div className="loading">
        <Brand />
        <p role="status">{error || "Checking application setup…"}</p>
        {error && (
          <button
            onClick={() =>
              refreshStatus().catch((err) => setError(err.message))
            }
          >
            Try again
          </button>
        )}
      </div>
    );
  return (
    <Routes>
      <Route
        path="/super-admin/setup"
        element={
          status.setupRequired ? (
            <Setup refreshStatus={refreshStatus} />
          ) : (
            <Navigate to="/super-admin/login" replace />
          )
        }
      />
      <Route
        path="/super-admin/verify-email"
        element={
          status.setupRequired ? (
            <Verify refreshStatus={refreshStatus} />
          ) : (
            <Navigate to="/super-admin/dashboard" replace />
          )
        }
      />
      <Route
        path="/super-admin/login"
        element={<Login setupRequired={status.setupRequired} />}
      />
      <Route path="/super-admin/dashboard" element={<Dashboard />} />
      <Route
        path="*"
        element={
          <Navigate
            to={
              status.setupRequired ? "/super-admin/setup" : "/super-admin/login"
            }
            replace
          />
        }
      />
    </Routes>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </BrowserRouter>,
);
