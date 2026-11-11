import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./api";
import StaffSidebar from "./StaffSidebar";
import { staffModules } from "./access";

const label = (value) => value?.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
const localDate = (value) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const displayDate = (value) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const blank = { service: "RIDE", pickupAt: "", pickup: "", stopover: "", destination: "", vehicle: "THREE_WHEELER", deliveryRoute: "OTHER", purpose: "", passengerCount: 1, otherPassengers: "", receiverName: "", receiverContact: "", itemDetails: "", groupCarEligible: false };
const reviewsRequest = (record, user) => [record.approver, ...(record.approvers || [])].filter(Boolean).map(String).includes(String(user?.id));

function WorkspaceIcon({ type, size = 22 }) {
  const paths = {
    route: "M5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 7v7a4 4 0 0 0 4 4h2m8-1V10a4 4 0 0 0-4-4h-2",
    clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    check: "m8 12 3 3 5-6M12 3l8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z",
    trip: "m5 10 2-6h10l2 6M4 10h16v9H4v-9Zm3 4h1m8 0h1M7 19v2m10-2v2",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
    book: "M12 6v15M3 4h4a5 5 0 0 1 5 2 5 5 0 0 1 5-2h4v15h-4a5 5 0 0 0-5 2 5 5 0 0 0-5-2H3V4Z",
    refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
    logout: "M9 4H4v16h5m5-4 4-4-4-4m-6 4h10",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type] || paths.route} /></svg>;
}

export function StaffLogin({ Layout }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await api("/transport/auth/login", Object.fromEntries(new FormData(event.currentTarget))); navigate("/transport", { replace: true }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Layout login portalLabel="EMPLOYEE TRANSPORT PORTAL">
    <span className="eyebrow accent">EMPLOYEE TRANSPORT</span><h2>Staff sign in</h2>
    <p className="muted">Use the username and password provided by your administrator.</p>
    {error && <div className="error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label>Username<input name="username" required autoComplete="username" maxLength={40} /></label>
      <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
      <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in to transport"}</button>
    </form>
    <p className="form-bottom"><Link to="/super-admin/login">Super Administrator sign in</Link></p>
  </Layout>;
}

export function SopSummary() {
  return <section className="sop-summary">
    <h2>Corporate transport SOP</h2>
    <p className="muted">Source document status: For management approval.</p>
    <ul>
      <li>Official, necessary and justified travel/deliveries only. Personal trips and home-to-work commuting are prohibited.</li>
      <li>Submit your own request. Your request goes to the approvers assigned to you, and any of them can accept it. Share the request and approval in WhatsApp at least 30 minutes before pickup.</li>
      <li>Use Ride for passengers and Flash for items/samples. Inter-factory/customer deliveries use a motorbike; otherwise executives/below use a three-wheeler. A car needs manager eligibility or at least three employees in the Executive category or below travelling together, with approval.</li>
      <li>The Administrative Assistant checks approval and completeness, then books in PickMe. This system records that external booking.</li>
      <li>Coordinate with the driver, verify pickup/route/destination and the completion message, and report changes, cancellations or delays immediately.</li>
      <li>HR must explain the SOP to new recruits and retain their acknowledgement in the personal file. This acknowledgement record supplements that process.</li>
    </ul>
    <p className="muted">Enter your contact, department and location with each request. Your Super Administrator assigns the approvers for your account. Any of those approvers can accept a request; authorized booking staff record the external PickMe booking.</p>
  </section>;
}

export function StaffWorkspace({ ThemeToggle, Brand }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const policyDialog = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [overview, setOverview] = useState(null);
  const [selectedSection, setSelectedSection] = useState("DASHBOARD");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  async function load() {
    try { const data = await api("/transport/me"); setUser(data.user); setError(""); }
    catch (err) { if (err.status === 401) navigate("/login", { replace: true }); else setError(err.message); }
  }
  useEffect(() => { load(); window.addEventListener("focus", load); return () => window.removeEventListener("focus", load); }, []);
  async function acknowledge() {
    setBusy(true); setError("");
    try { const data = await api("/transport/acknowledge", { acknowledged: true }); setUser(data.user); policyDialog.current.close(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await api("/transport/auth/logout", {}); navigate("/login", { replace: true }); }
    catch (err) { setError(err.message); dialog.current.close(); } finally { setBusy(false); }
  }
  if (!user) return <main className="loading"><p role="status">{error || "Opening transport workspace…"}</p><button className="secondary" onClick={load}>Retry</button></main>;
  const section = user.sidebarAccess.includes(selectedSection) ? selectedSection : user.sidebarAccess[0];
  const sectionTitle = staffModules.find((module) => module.key === section)?.title || "Workspace access";
  const initials = user.fullName.trim().split(/\s+/).slice(0, 2).map((name) => name[0]).join("").toUpperCase();
  const overviewCards = [
    ["Total requests", "total", "route"], ["Awaiting approval", "pending", "clock"],
    ["Active trips", "active", "trip"], ["Completed", "completed", "check"],
  ];
  return <div className={`dashboard staff-dashboard${sidebarCollapsed ? " sidebar-collapsed" : ""}`}><StaffSidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} user={user} Brand={Brand} section={section} onSelect={setSelectedSection} onLogout={() => dialog.current.showModal()} Icon={WorkspaceIcon} /><main className="dashboard-main staff-workspace">
    <header className="staff-header"><div className="staff-header-inner"><div className="staff-brand-area"><span>Staff portal <b>/</b> {sectionTitle}</span></div><div className="header-actions"><ThemeToggle /><span className="staff-profile-avatar" title={user.fullName} aria-label={user.fullName}>{initials}</span><button className="staff-logout" onClick={() => dialog.current.showModal()}><WorkspaceIcon type="logout" size={18} />Logout</button></div></div></header>
    <dialog ref={dialog} className="logout-dialog" aria-labelledby="staff-logout-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <h2 id="staff-logout-title">Log out?</h2><p className="muted">Are you sure you want to log out?</p>
      <div className="logout-actions"><button className="secondary" autoFocus disabled={busy} onClick={() => dialog.current.close()}>Cancel</button><button className="primary" disabled={busy} onClick={logout}>Logout</button></div>
    </dialog>
    <dialog ref={policyDialog} className="staff-policy-dialog" aria-labelledby="staff-policy-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <header className="staff-policy-heading"><div><span className="eyebrow accent">BEFORE YOU TRAVEL</span><h2 id="staff-policy-title">Transport guidelines</h2></div><button type="button" className="user-dialog-close" aria-label="Close transport guidelines" disabled={busy} onClick={() => policyDialog.current.close()}>&times;</button></header>
      <SopSummary />
      {error && <div className="error" role="alert">{error}</div>}
      <footer className="staff-policy-footer">{!user.sopAcknowledgedAt ? <button className="primary" disabled={busy} onClick={acknowledge}>{busy ? "Saving…" : "I have read and understood the SOP"}</button> : <><span className="muted">Acknowledged {displayDate(user.sopAcknowledgedAt)} (Sri Lanka)</span><button className="secondary" onClick={() => policyDialog.current.close()}>Done</button></>}</footer>
    </dialog>
    <div className="staff-content page-enter">
      <div className="staff-page-label"><span>WORKSPACE <span aria-hidden="true">/</span> {sectionTitle}</span><button className="staff-refresh" aria-label="Refresh" onClick={() => { load(); setRefreshKey((value) => value + 1); }}><WorkspaceIcon type="refresh" size={16} />Refresh</button></div>
      {section === "DASHBOARD" && <section className="staff-hero">
        <div className="staff-hero-copy"><span className="eyebrow accent">YOUR TRANSPORT WORKSPACE</span><h1>Good to see you, {user.fullName.split(" ")[0]}</h1><p>{user.sopAcknowledgedAt ? "Your transport activity and next steps, all in one place." : "Review the transport guidelines before submitting or handling a transport request."}</p><div className="staff-hero-tags"><span><WorkspaceIcon type="user" size={14} />{label(user.role)}</span>{user.department && <span><WorkspaceIcon type="route" size={14} />{user.department}</span>}</div></div>
        <div className="staff-journey" aria-hidden="true"><div className="staff-journey-heading"><span className="staff-journey-symbol"><WorkspaceIcon type="trip" size={26} /></span><div><strong>A smoother way to work.</strong><span>One workspace. Every journey.</span></div></div><div className="staff-journey-stops"><span><i>01</i>Request</span><b /><span><i>02</i>Approve</span><b /><span><i>03</i>Travel</span></div></div>
      </section>}
      {error && <div role="alert" className="error">{error}</div>}
      {section === "DASHBOARD" && <section className="staff-overview" aria-label="Transport overview">{overviewCards.map(([title, key, icon]) => <article className="staff-stat" key={key}><div><span>{title}</span><strong>{overview ? overview[key].toLocaleString() : "—"}</strong></div><span className="staff-stat-icon"><WorkspaceIcon type={icon} /></span></article>)}</section>}
      <div className="staff-support-grid">
        <section className="staff-guidelines"><span className="staff-support-icon"><WorkspaceIcon type="book" /></span><div className="staff-support-copy"><div className="staff-support-title"><h2>Travel guidelines</h2><span className={`staff-policy-status${user.sopAcknowledgedAt ? " is-read" : ""}`}>{user.sopAcknowledgedAt ? "Acknowledged" : "Please review"}</span></div><p>Official trips only. Share your request and approval at least 30 minutes before pickup.</p></div><button className="secondary" onClick={() => policyDialog.current.showModal()}>Read guidelines <span aria-hidden="true">↗</span></button></section>
      </div>
      {!section ? <section className="empty-state"><h2>No workspace access assigned</h2><p className="muted">Ask your Super Administrator to grant sidebar access in User Management.</p></section> : <TransportPanel key={`${section}:${user.sidebarAccess.join(",")}`} user={user} section={sectionTitle} refreshKey={refreshKey} onStats={setOverview} />}
    </div>
  </main></div>;
}

function RequestForm({ user, approvers, departments, record, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...blank, requesterContact: record?.requesterDetails.contact || user.contact || "", departmentId: user.departmentId || "", workLocation: record?.requesterDetails.workLocation || "",
    ...(record ? { ...record, pickupAt: localDate(record.pickupAt), otherPassengers: record.passengers.filter((person) => person.name.toLowerCase() !== user.fullName.toLowerCase()).map((person) => person.name + " | " + person.designation).join("\n") } : {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(event) { const { name, value, type, checked } = event.target; setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value })); }
  const passengers = [{ name: user.fullName, designation: "" }, ...form.otherPassengers.split("\n").filter((line) => line.trim()).map((line) => { const [name, ...designation] = line.split("|"); return { name: name.trim(), designation: designation.join("|").trim() }; })];
  async function submit(event) {
    event.preventDefault();
    if (form.service === "RIDE" && Number(form.passengerCount) !== passengers.length) { setError("Passenger count must match you and the additional passengers listed below."); return; }
    setBusy(true); setError("");
    try {
      const body = { requesterContact: form.requesterContact, departmentId: user.departmentId, workLocation: form.workLocation, passengerCount: form.service === "RIDE" ? Number(form.passengerCount) : 0, service: form.service, pickupAt: new Date(form.pickupAt).toISOString(), pickup: form.pickup, stopover: form.stopover, destination: form.destination, vehicle: form.vehicle, deliveryRoute: form.deliveryRoute, purpose: form.purpose, justification: form.purpose,
        passengers: form.service === "RIDE" ? passengers : [], receiverName: form.service === "FLASH" ? form.receiverName : "", receiverContact: form.service === "FLASH" ? form.receiverContact : "", itemDetails: form.service === "FLASH" ? form.itemDetails : "", groupCarEligible: form.groupCarEligible };
      if (record) body.version = record.version;
      const data = await api(`/transport/requests${record ? `/${record.id}` : ""}`, body, record ? "PUT" : "POST");
      onSaved(data.request); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="transport-form request-create page-enter">
    <header className="request-create-heading"><div><span className="eyebrow accent">TRANSPORT BOOKING</span><h2>{record ? "Correct and resubmit request" : "New transport request"}</h2><p className="muted">Complete the journey details below. Required fields are marked.</p></div><div className="request-create-header-actions"><span className="request-create-mark"><WorkspaceIcon type="trip" size={24} /></span><button type="button" className="request-dialog-close" aria-label="Close request form" onClick={onClose} disabled={busy}>×</button></div></header>
    {error && <div className="error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="transport-fields">
        <h3><span>01</span>Requester details</h3>
        <div className="field-row"><label>Requester name<input value={user.fullName} readOnly /></label><label>Requester contact<input type="tel" name="requesterContact" value={form.requesterContact} onChange={change} required maxLength={30} /></label></div>
        <label>Department<input value={user.department || "No department assigned"} readOnly required={!!user.departmentId} /></label>
        <label>Department / work location<input name="workLocation" value={form.workLocation} onChange={change} required minLength={2} maxLength={150} placeholder="e.g. Factory 1, Colombo" /></label>
        <h3><span>02</span>Journey &amp; approval</h3>
        <div className="select-field"><label htmlFor="trip-service">Service</label><select id="trip-service" name="service" value={form.service} onChange={change}><option value="RIDE">PickMe Ride (passengers)</option><option value="FLASH">PickMe Flash (items/samples)</option></select></div>
        {approvers.length > 0 ? <p className="info">Assigned approvers: {approvers.map((person) => person.fullName).join(", ")}. Any of them can accept this request.</p> : <p className="error">No approver is assigned to your account. Ask your administrator to assign an approver before requesting transport.</p>}
        <label>Pickup date and time<input type="datetime-local" name="pickupAt" value={form.pickupAt} min={localDate(Date.now() + 30 * 60000)} onChange={change} required /></label>
        <div className="field-row"><label>Pickup location<input name="pickup" value={form.pickup} onChange={change} required minLength={2} maxLength={500} /></label><label>Destination<input name="destination" value={form.destination} onChange={change} required minLength={2} maxLength={500} /></label></div>
        <label>Stopover (optional)<input name="stopover" value={form.stopover} onChange={change} maxLength={500} /></label>
        {form.service === "FLASH" && <><div className="select-field"><label htmlFor="delivery-route">Delivery route</label><select id="delivery-route" name="deliveryRoute" value={form.deliveryRoute} onChange={change}><option value="OTHER">Other official delivery</option><option value="BETWEEN_FACTORIES">Between factories</option><option value="CUSTOMER_DELIVERY">Customer delivery</option></select></div><div className="field-row"><label>Receiver name<input name="receiverName" value={form.receiverName} onChange={change} required minLength={2} maxLength={100} /></label><label>Receiver contact<input type="tel" name="receiverContact" value={form.receiverContact} onChange={change} required maxLength={30} /></label></div><label>Item or sample details<textarea name="itemDetails" value={form.itemDetails} onChange={change} required minLength={2} maxLength={500} /></label></>}
        {form.service === "RIDE" && <><label>Number of passengers<input type="number" name="passengerCount" aria-label="Number of passengers" value={form.passengerCount ?? 1} onChange={(event) => setForm((current) => ({ ...current, passengerCount: event.target.value === "" ? "" : Number(event.target.value) }))} required min="1" max="10" step="1" aria-describedby="passenger-count-help" aria-invalid={Number(form.passengerCount) !== passengers.length} /><small id="passenger-count-help">Enter the total yourself, including you. It must match the requester and additional passengers listed below ({passengers.length} currently listed).</small></label><label>Additional passengers (optional)<textarea name="otherPassengers" aria-label="Additional passengers (optional)" aria-describedby="passenger-list-help" value={form.otherPassengers} onChange={change} placeholder="One per line: Full name | Designation" /><small id="passenger-list-help">Add each other passenger on a separate line. The requester is included automatically.</small></label></>}
        <div className="select-field"><label htmlFor="trip-vehicle">Vehicle</label><select id="trip-vehicle" name="vehicle" value={form.vehicle} onChange={change}><option value="MOTORBIKE">Motorbike</option><option value="THREE_WHEELER">Three-wheeler</option><option value="CAR">Car</option></select></div>
        <p className="muted">Inter-factory/customer deliveries: motorbike. Otherwise executives/below: three-wheeler; managers: car or three-wheeler. Three or more passengers may use a car with approval.</p>
        {form.service === "RIDE" && form.vehicle === "CAR" && !["MANAGER", "ADMIN"].includes(user.role) && <label className="check-label"><input type="checkbox" name="groupCarEligible" checked={form.groupCarEligible} onChange={change} required />All {passengers.length} passengers are employees in the Executive category or below; at least three are travelling together. This car request requires approval.</label>}
        <label>Official purpose / justification<textarea name="purpose" value={form.purpose} onChange={change} required minLength={2} maxLength={500} placeholder="Explain the official reason for this transport request" /></label>
        <div className="department-actions"><button className="primary" disabled={approvers.length === 0}>{busy ? "Submitting…" : "Submit for approval"}</button><button className="secondary" type="button" onClick={onClose}>Cancel</button></div>
      </fieldset>
    </form>
  </section>;
}

function ActionForm({ record, action, base, onClose, onSaved }) {
  const [note, setNote] = useState(""); const [checked, setChecked] = useState(false); const [route, setRoute] = useState(false); const [completion, setCompletion] = useState(false);
  const [reference, setReference] = useState(""); const [driver, setDriver] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await api(`${base}/requests/${record.id}/action`, { action, version: record.version, note, approvalShared: checked, externalActionConfirmed: checked, bookingReference: reference, driverDetails: driver, routeVerified: route, completionMessageChecked: completion });
      onSaved(data.request); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const requiresReason = ["REJECT", "RETURN", "CANCEL", "CONFIRM_CANCEL", "REQUEST_CHANGE", "CONFIRM_CHANGE", "REPORT_ISSUE"].includes(action);
  return <form className="transport-action" onSubmit={submit}>
    <h3>{label(action)}</h3>{error && <div className="error" role="alert">{error}</div>}
    {["CANCEL", "REQUEST_CHANGE", "REPORT_ISSUE"].includes(action) && <p className="info">Inform the Administrative Assistant immediately through your designated communication channel. Saving here does not send a notification or change a PickMe booking.</p>}
    <fieldset className="transport-fields" disabled={busy}>
      <label>Notes / reason<textarea value={note} onChange={(event) => setNote(event.target.value)} required={requiresReason} minLength={requiresReason ? 2 : undefined} maxLength={1000} /></label>
      {action === "BOOK" && <><label>PickMe booking reference<input value={reference} onChange={(event) => setReference(event.target.value)} required maxLength={100} /></label><label>Driver / tracking details (optional)<textarea value={driver} onChange={(event) => setDriver(event.target.value)} maxLength={500} /></label></>}
      {["APPROVE", "BOOK", "CONFIRM_CANCEL", "CONFIRM_CHANGE"].includes(action) && <label className="check-label"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} required />{action === "APPROVE" ? "I checked need, justification and vehicle eligibility and shared my approval in WhatsApp." : action === "BOOK" ? "I checked completeness and approval, and completed the booking in PickMe." : "I have resolved/cancelled the existing booking in PickMe and informed the requester."}</label>}
      {action === "COMPLETE" && <><label className="check-label"><input type="checkbox" checked={route} onChange={(event) => setRoute(event.target.checked)} required />I verified the pickup location, route and destination.</label><label className="check-label"><input type="checkbox" checked={completion} onChange={(event) => setCompletion(event.target.checked)} required />I checked the trip completion message.</label></>}
      <div className="department-actions"><button className="primary">{busy ? "Saving…" : "Confirm action"}</button><button className="secondary" type="button" onClick={onClose}>Cancel action</button></div>
    </fieldset>
  </form>;
}

export function TransportPanel({ user, admin = false, refreshKey, section = "Transport Requests", onChanged = () => {}, onStats }) {
  const dashboardSection = section === "Dashboard" || section === "DASHBOARD";
  const base = admin ? "/super-admin/transport" : "/transport";
  const requestDialog = useRef(null);
  const [records, setRecords] = useState([]); const [approvers, setApprovers] = useState([]); const [departments, setDepartments] = useState([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all"); const [form, setForm] = useState(null); const [action, setAction] = useState(null); const [notice, setNotice] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const [data, people, teams] = await Promise.all([api(`${base}/requests`), api(`${base}/approvers`), api(`${base}/departments`)]); setRecords(data.requests); setApprovers(people.approvers.filter((person) => person.id !== user?.id)); setDepartments(teams.departments); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [refreshKey, base]);
  useEffect(() => {
    const dialog = requestDialog.current;
    if (!dialog) return;
    if (form && !dialog.open) dialog.showModal();
    else if (!form && dialog.open) dialog.close();
  }, [form]);
  useEffect(() => {
    const dialog = requestDialog.current;
    const viewport = window.visualViewport;
    if (!dialog || !form || !viewport) return;
    const syncToViewport = (event) => {
      dialog.style.setProperty("--request-vh", `${viewport.height}px`);
      dialog.style.setProperty("--request-vtop", `${viewport.offsetTop}px`);
      if (event?.type === "resize" && window.matchMedia("(max-width: 700px)").matches && dialog.contains(document.activeElement)) {
        document.activeElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    viewport.addEventListener("resize", syncToViewport);
    viewport.addEventListener("scroll", syncToViewport);
    syncToViewport();
    return () => {
      viewport.removeEventListener("resize", syncToViewport);
      viewport.removeEventListener("scroll", syncToViewport);
      dialog.style.removeProperty("--request-vh");
      dialog.style.removeProperty("--request-vtop");
    };
  }, [form]);
  useEffect(() => {
    if (onStats && !loading && !error) onStats({ total: records.length, pending: records.filter((record) => record.status === "PENDING_APPROVAL").length, active: records.filter((record) => ["APPROVED", "BOOKED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].includes(record.status)).length, completed: records.filter((record) => record.status === "COMPLETED").length });
  }, [records, loading, error, onStats]);
  function saved(record) { setRecords((items) => [record, ...items.filter((item) => item.id !== record.id)]); setNotice(`Request ${label(record.status)}.`); onChanged(); }
  const permissions = user?.permissions || { monitor: true };
  const requestBlockedReason = !permissions.request ? "Sign in with your staff account to create a request."
    : !user.sopAcknowledgedAt ? "Read guidelines and acknowledge the SOP to create a request." : "";
  const shown = records.filter((record) => {
    if (section === "Approval Management" || tab === "approvals") return record.status === "PENDING_APPROVAL" && (admin || reviewsRequest(record, user));
    if (section === "Booking Management" || tab === "bookings") return ["APPROVED", "BOOKED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].includes(record.status);
    return true;
  });
  if (["Reports", "Request History"].includes(section)) return <section className="transport-form page-enter" aria-label={section}><h2>{section}</h2>{error && <div className="error" role="alert">{error}</div>}{loading ? <p role="status">Loading requests...</p> : section === "Reports" ? <><p className="muted">Summary of requests your account is permitted to view.</p><div className="staff-overview">{[["Total requests", records.length], ["Awaiting approval", records.filter((record) => record.status === "PENDING_APPROVAL").length], ["Active trips", records.filter((record) => ["APPROVED", "BOOKED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].includes(record.status)).length], ["Completed", records.filter((record) => record.status === "COMPLETED").length]].map(([title, count]) => <article className="staff-stat" key={title}><div><span>{title}</span><strong>{count}</strong></div></article>)}</div></> : <><p className="muted">Activity on requests your account is permitted to view.</p>{records.length ? records.map((record) => <article className="request-card" key={record.id}><h3>{record.pickup} to {record.destination}</h3><p>{record.requesterDetails.fullName}</p><ol className="staff-history">{record.history.map((item, index) => <li key={index}><strong>{label(item.action)}</strong> &middot; {item.actorName} &middot; {displayDate(item.at)}<p>{item.note}</p></li>)}</ol></article>) : <p>No request activity yet.</p>}</>}</section>;
  return <section aria-label="Transport workflow">
    {!admin && !dashboardSection && !["Reports", "Request History"].includes(section) && (permissions.request || permissions.approve || permissions.book) && <div className="transport-toolbar">{(permissions.approve || permissions.book) && <div className="management-sections"><button aria-pressed={tab === "all"} onClick={() => setTab("all")}>Requests</button>{permissions.approve && <button aria-pressed={tab === "approvals"} onClick={() => setTab("approvals")}>Approvals</button>}{permissions.book && <button aria-pressed={tab === "bookings"} onClick={() => setTab("bookings")}>Bookings</button>}</div>}{permissions.request && <div className="staff-new-request"><button className="primary" disabled={!!requestBlockedReason} aria-describedby={requestBlockedReason ? "request-setup-help" : undefined} onClick={() => { setForm({}); setAction(null); }}>New request</button>{requestBlockedReason && <p id="request-setup-help">{requestBlockedReason}</p>}</div>}</div>}
    {admin && <p className="info">Monitoring view. Employees submit their own requests at <Link to="/login">Staff sign in</Link>. Approvers and the Administrative Assistant perform actions from their own accounts.</p>}
    {error && <div className="error" role="alert">{error}</div>}<p className="department-status" role="status">{notice}</p>
    <dialog ref={requestDialog} className="request-dialog" aria-label={form?.id ? "Edit transport request" : "New transport request"} onCancel={(event) => { event.preventDefault(); setForm(null); }} onFocusCapture={(event) => { if (window.matchMedia("(max-width: 700px)").matches) window.setTimeout(() => event.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250); }}>
      {form && <RequestForm key={form.id || "new"} record={form.id ? form : null} user={user} approvers={approvers} departments={departments} onClose={() => setForm(null)} onSaved={saved} />}
    </dialog>
    {!dashboardSection && (loading ? <p role="status">Loading requests…</p> : !shown.length ? <div className="empty-state staff-request-empty"><span className="staff-empty-icon"><WorkspaceIcon type="route" size={28} /></span><h2>No requests yet</h2><p className="muted">Once a request is submitted, its approval and trip updates will appear here.</p></div> : <div className="request-list"><div className="request-list-header"><span>Journey</span><span>Requester</span><span>Request details</span><span>Purpose</span><span>Trip information</span><span>Actions</span></div>{shown.map((record) => {
      const own = !admin && String(record.requester) === user.id && permissions.request;
      const assigned = !admin && reviewsRequest(record, user) && permissions.approve;
      const choices = [];
      if (assigned && record.status === "PENDING_APPROVAL") choices.push("APPROVE", "REJECT", "RETURN");
      if (!admin && permissions.book) {
        if (record.status === "APPROVED") choices.push("BOOK");
        if (["PENDING_APPROVAL", "APPROVED"].includes(record.status) && !choices.includes("RETURN")) choices.push("RETURN");
        if (record.status === "CANCELLATION_REQUESTED") choices.push("CONFIRM_CANCEL");
        if (record.status === "CHANGE_REQUESTED") choices.push("CONFIRM_CHANGE");
      }
      if (own) {
        if (record.status === "BOOKED") choices.push("COMPLETE", "REQUEST_CHANGE");
        if (["BOOKED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].includes(record.status)) choices.push("REPORT_ISSUE");
        if (!["COMPLETED", "CANCELLED", "CANCELLATION_REQUESTED"].includes(record.status)) choices.push("CANCEL");
      }
      return <article key={record.id} className="request-card request-card-modern" aria-label={`Request ${record.id}`}>
        <div className="request-heading"><div><span className="eyebrow accent">{label(record.service)} · {label(record.vehicle)}</span><h2>{record.pickup} → {record.destination}</h2></div><span className="badge">{label(record.status)}</span></div>
        <p><strong>{record.requesterDetails.fullName}</strong> · {record.requesterDetails.designation} · {record.requesterDetails.contact}</p>
        <p className="muted">{record.requesterDetails.department} · {record.requesterDetails.workLocation}<br />Pickup: {displayDate(record.pickupAt)} (Sri Lanka)<br />{record.approvalSharedAt ? "Approved by" : "Assigned approvers"}: {record.approverDetails.approvedBy || record.approverDetails.fullName}{record.approverDetails.designation ? ` · ${record.approverDetails.designation}` : ""}</p>
        <p className="request-copy"><strong>Official purpose / justification:</strong> {record.purpose || record.justification}</p>
        {record.stopover && <p className="muted">Stopover: {record.stopover}</p>}
        <p className="muted">{record.service === "RIDE" ? `Passengers (${record.passengers.length}): ${record.passengers.map((person) => `${person.name} (${person.designation})`).join(", ")}` : `Receiver: ${record.receiverName} · ${record.receiverContact}. Items/samples: ${record.itemDetails}`}</p>
        {record.bookingReference && <div className="info">PickMe reference: {record.bookingReference}<br />{record.driverDetails}</div>}
        <div className="department-actions">{own && ["PENDING_APPROVAL", "RETURNED", "REJECTED"].includes(record.status) && <button className="secondary" onClick={() => setForm(record)}>Edit request</button>}{choices.map((choice) => <button className="secondary" key={choice} onClick={() => { setAction({ id: record.id, value: choice }); setForm(null); }}>{label(choice)}</button>)}</div>
        {action?.id === record.id && <ActionForm key={`${record.id}-${action.value}`} record={record} action={action.value} base={base} onClose={() => setAction(null)} onSaved={saved} />}
      </article>;
    })}</div>)}
  </section>;
}
