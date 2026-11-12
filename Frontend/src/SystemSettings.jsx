import React, { useEffect, useState } from "react";
import { api } from "./api";

const money = (value) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(value);

export default function SystemSettings({ ThemeToggle, onChanged }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState("");
  const [credit, setCredit] = useState("");
  const [savedCredit, setSavedCredit] = useState(0);
  const [allocated, setAllocated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState({});
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([api("/super-admin/settings"), api("/super-admin/budget"), api("/super-admin/companies")])
      .then(([settings, budget, companies]) => {
        if (!active) return;
        setData(settings); setName(settings.user.fullName);
        setCredit(String(budget.creditLimit)); setSavedCredit(budget.creditLimit);
        setAllocated(companies.companies.reduce((sum, company) => sum + (company.budget || 0), 0));
      }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function save(event, section) {
    event.preventDefault();
    if (busy) return;
    setBusy(section); setFeedback((old) => ({ ...old, [section]: null }));
    try {
      if (section === "profile") {
        const result = await api("/super-admin/settings/profile", { fullName: name.trim() }, "PUT");
        setData((old) => ({ ...old, user: result.user })); setName(result.user.fullName);
        onChanged?.();
      } else {
        const result = await api("/super-admin/budget", { creditLimit: Number(credit) }, "PUT");
        setSavedCredit(result.creditLimit); setCredit(String(result.creditLimit));
      }
      setFeedback((old) => ({ ...old, [section]: { message: section === "profile" ? "Administrator profile saved." : "Weekly transport credit limit saved." } }));
    } catch (err) {
      setFeedback((old) => ({ ...old, [section]: { error: true, message: err.message } }));
    } finally { setBusy(""); }
  }
  const message = (section) => feedback[section] && <p className={feedback[section].error ? "error" : "settings-success"} role={feedback[section].error ? "alert" : "status"}>{feedback[section].message}</p>;
  return <section className="system-settings" aria-label="System settings">
    <header className="insight-heading"><div><span className="eyebrow accent">WORKSPACE PREFERENCES</span><h2>System Settings</h2><p className="muted">Manage your administrator profile, transport budget and display preferences.</p></div></header>
    {loading ? <p role="status">Loading settings…</p> : error ? <div className="error" role="alert">{error}<button className="secondary" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div> : data && <div className="settings-grid">
      <section className="settings-card" aria-labelledby="settings-profile"><header><h3 id="settings-profile">Administrator profile</h3><span className="badge">Email verified</span></header><p className="muted">Your name appears in the sidebar and on new activity records.</p>
        <form onSubmit={(event) => save(event, "profile")}>
          <label>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={name} disabled={!!busy} onChange={(event) => setName(event.target.value)} /></label>
          <div className="settings-fields"><label>Username<input readOnly value={data.user.username || ""} /></label><label>Verified email<input readOnly value={data.user.email || ""} /></label></div>
          <p className="settings-help muted">Username and verified email are read-only.</p>
          {message("profile")}<div className="settings-actions"><button className="primary" disabled={!!busy || name.trim() === data.user.fullName}>{busy === "profile" ? "Saving…" : "Save profile"}</button><button type="button" className="secondary" disabled={!!busy || name === data.user.fullName} onClick={() => { setName(data.user.fullName); setFeedback((old) => ({ ...old, profile: null })); }}>Discard changes</button></div>
        </form>
      </section>
      <section className="settings-card" aria-labelledby="settings-budget"><header><h3 id="settings-budget">Transport credit</h3><span className="badge">Weekly · LKR</span></header><p className="muted">Set the overall weekly limit shared by company budgets.</p>
        <form onSubmit={(event) => save(event, "budget")}><label>Weekly credit limit (LKR)<input type="number" required min="0" max="1000000000000" step="0.01" value={credit} disabled={!!busy} onChange={(event) => setCredit(event.target.value)} /></label>
          <dl className="settings-values"><div><dt>Allocated to companies</dt><dd>{money(allocated)}</dd></div><div><dt>Unallocated credit</dt><dd>{money(savedCredit - allocated)}</dd></div></dl>
          <p className="settings-help muted">The limit cannot be lower than allocated company budgets. This is the same limit used in Department Management → Companies.</p>
          {message("budget")}<div className="settings-actions"><button className="primary" disabled={!!busy || credit === "" || Number(credit) === savedCredit}>{busy === "budget" ? "Saving…" : "Save credit limit"}</button><button type="button" className="secondary" disabled={!!busy || credit === String(savedCredit)} onClick={() => { setCredit(String(savedCredit)); setFeedback((old) => ({ ...old, budget: null })); }}>Discard changes</button></div>
        </form>
      </section>
      <section className="settings-card" aria-labelledby="settings-appearance"><header><h3 id="settings-appearance">Appearance</h3><ThemeToggle /></header><p className="muted">Choose light or dark mode. Your preference applies immediately and is saved in this browser.</p></section>
      <section className="settings-card" aria-labelledby="settings-policy"><header><h3 id="settings-policy">Transport policy</h3><span className="badge">Read-only</span></header><dl className="settings-values"><div><dt>Minimum advance notice</dt><dd>{data.transport.minimumNoticeMinutes} minutes</dd></div><div><dt>Time zone</dt><dd>{data.transport.timezone}</dd></div><div><dt>Currency</dt><dd>{data.transport.currency}</dd></div><div><dt>Vehicle types</dt><dd>{data.transport.vehicles.map((value) => value.replaceAll("_", " ").toLowerCase()).join(", ")}</dd></div></dl><p className="settings-help muted">Vehicle eligibility follows the transport SOP. Policy changes require a server code update.</p></section>
      <section className="settings-card settings-security" aria-labelledby="settings-security"><header><h3 id="settings-security">Session & security</h3><span className="badge">Server managed</span></header><dl className="settings-values"><div><dt>Session duration</dt><dd>{data.security.sessionDuration}</dd></div><div><dt>Setup verification code validity</dt><dd>{data.security.otpExpiryMinutes} minutes</dd></div><div><dt>Verification resend cooldown</dt><dd>{data.security.otpResendSeconds} seconds</dd></div><div><dt>HTTPS-only session cookies</dt><dd>{data.security.secureCookies ? "Enabled" : "Disabled (development / test)"}</dd></div></dl><p className="settings-help muted">Initial administrator setup is closed. Session and verification settings are managed through server configuration.</p></section>
    </div>}
  </section>;
}
