import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api";

const label = (value = "") => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const dateTime = (value) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }) : "—";
const money = (value) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(value);
function exportCsv(name, rows) {
  const cell = (value) => {
    const text = String(value ?? "");
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Pager({ page, total, size = 25, onChange }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="insight-pagination"><span role="status">{total.toLocaleString()} results · Page {page} of {pages}</span><div><button className="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button><button className="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div></div>;
}
function Dates({ filters, update }) {
  return <><label>From date<input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update("from", e.target.value)} /></label><label>To date<input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update("to", e.target.value)} /></label></>;
}
const emptyReport = { search: "", status: "", service: "", department: "", from: "", to: "" };
export function Reports() {
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState(emptyReport);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api("/super-admin/transport/requests").then((data) => { if (active) { setRecords(data.requests); setPage(1); } }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const update = (key, value) => { setFilters((old) => ({ ...old, [key]: value })); setPage(1); };
  const shown = useMemo(() => records.filter((r) => {
    const at = new Date(r.pickupAt).getTime();
    return (!filters.status || r.status === filters.status) && (!filters.service || r.service === filters.service)
      && (!filters.department || r.requesterDetails.department === filters.department)
      && (!filters.from || at >= new Date(`${filters.from}T00:00:00+05:30`).getTime())
      && (!filters.to || at < new Date(`${filters.to}T00:00:00+05:30`).getTime() + 86400000)
      && [r.id, r.requesterDetails.fullName, r.pickup, r.destination, r.bookingReference].join(" ").toLowerCase().includes(filters.search.trim().toLowerCase());
  }), [records, filters]);
  const departments = [...new Set(records.map((r) => r.requesterDetails.department).filter(Boolean))].sort();
  const booked = shown.filter((r) => ["BOOKED", "COMPLETED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].includes(r.status));
  const totalAmount = booked.reduce((total, r) => total + Math.round((r.bookingAmount || 0) * 100), 0) / 100;
  const exportRows = () => exportCsv("transport-report.csv", [["Request ID", "Requester", "Department", "Pickup (Sri Lanka)", "From", "Destination", "Service", "Status", "Booking reference", "Recorded amount (LKR)"], ...shown.map((r) => [r.id, r.requesterDetails.fullName, r.requesterDetails.department, dateTime(r.pickupAt), r.pickup, r.destination, r.service, r.status, r.bookingReference, r.bookingAmount])]);
  return <section className="insights" aria-label="Transport reports">
    <header className="insight-heading"><div><span className="eyebrow accent">TRANSPORT INSIGHTS</span><h2>Reports</h2><p className="muted">Explore transport activity and recorded booking amounts.</p></div><div className="insight-actions"><button className="secondary" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>Refresh</button><button className="primary" disabled={loading || !!error || !shown.length} onClick={exportRows}>Export CSV</button></div></header>
    <div className="insight-filters"><label className="insight-search">Search requests<input type="search" placeholder="Name, route, request ID or booking reference" value={filters.search} onChange={(e) => update("search", e.target.value)} /></label><label>Status<select aria-label="Status" value={filters.status} onChange={(e) => update("status", e.target.value)}><option value="">All statuses</option>{["PENDING_APPROVAL", "APPROVED", "REJECTED", "RETURNED", "BOOKED", "COMPLETED", "CANCELLED", "CHANGE_REQUESTED", "CANCELLATION_REQUESTED"].map((s) => <option key={s}>{s}</option>)}</select></label><label>Service<select aria-label="Service" value={filters.service} onChange={(e) => update("service", e.target.value)}><option value="">All services</option><option value="RIDE">Ride</option><option value="FLASH">Flash</option></select></label><label>Department<select aria-label="Department" value={filters.department} onChange={(e) => update("department", e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select></label><Dates filters={filters} update={update} /><button className="secondary" onClick={() => { setFilters(emptyReport); setPage(1); }}>Clear filters</button></div>
    <p className="muted insight-caption">Dates filter pickup time in Sri Lanka. All totals and exports reflect the selected filters.</p>
    {error ? <div className="error" role="alert">{error} Use Refresh to try again.</div> : loading ? <p role="status">Loading reports…</p> : <>
      <div className="insight-metrics">{[["Total requests", shown.length], ["Awaiting approval", shown.filter((r) => r.status === "PENDING_APPROVAL").length], ["Completed trips", shown.filter((r) => r.status === "COMPLETED").length], ["Recorded booking amount", money(totalAmount)]].map(([title, value]) => <article className="metric" key={title}><span>{title}</span><strong>{value}</strong></article>)}</div>
      <p className="muted insight-caption">Booking amount includes active and completed bookings; excludes cancelled and returned requests. This is recorded booking value, not settled expenditure.</p>
      <div className="insight-table" tabIndex={0} role="region" aria-label="Transport report results"><table><thead><tr>{["Requester / department", "Route", "Pickup · Sri Lanka", "Service", "Status", "Amount"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{shown.slice((page - 1) * 25, page * 25).map((r) => <tr key={r.id}><td><strong>{r.requesterDetails.fullName}</strong><small>{r.requesterDetails.department || "Unassigned"}</small><small>{r.id}</small></td><td>{r.pickup}<small>to {r.destination}</small></td><td>{dateTime(r.pickupAt)}</td><td>{label(r.service)}</td><td><span className="badge">{label(r.status)}</span></td><td>{r.bookingAmount == null ? "—" : money(r.bookingAmount)}</td></tr>)}</tbody></table>{!shown.length && <div className="insight-empty"><h3>No matching requests</h3><p className="muted">Try changing the filters, or check back after a request is submitted.</p></div>}</div>
      <Pager page={page} total={shown.length} onChange={setPage} />
    </>}
  </section>;
}

const emptyAudit = { search: "", source: "", from: "", to: "" };
export function AuditLogs() {
  const [draft, setDraft] = useState(emptyAudit);
  const [filters, setFilters] = useState(emptyAudit);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState({ logs: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const params = new URLSearchParams({ page, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
    api(`/super-admin/audit-logs?${params}`).then((result) => { if (active) setData(result); }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page, refresh]);
  const update = (key, value) => setDraft((old) => ({ ...old, [key]: value }));
  return <section className="insights" aria-label="Audit logs"><header className="insight-heading"><div><span className="eyebrow accent">ACTIVITY & ACCOUNTABILITY</span><h2>Audit Logs</h2><p className="muted">Review recorded system events and transport request history.</p></div><div className="insight-actions"><button className="secondary" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>Refresh</button><button className="primary" disabled={loading || !!error || !data.logs.length} onClick={() => exportCsv(`audit-logs-page-${page}.csv`, [["Time (Sri Lanka)", "Source", "Event", "Actor", "Reference", "IP", "Note"], ...data.logs.map((r) => [dateTime(r.at), r.source, r.event, r.actorName, r.reference, r.ip, r.note])])}>Export this page</button></div></header>
    <form className="insight-filters" onSubmit={(e) => { e.preventDefault(); setFilters({ ...draft }); setPage(1); }}><label className="insight-search">Search activity<input type="search" maxLength={100} placeholder="Event code, person, reference, IP or note" value={draft.search} onChange={(e) => update("search", e.target.value)} /></label><label>Source<select aria-label="Source" value={draft.source} onChange={(e) => update("source", e.target.value)}><option value="">All sources</option><option value="SYSTEM">System</option><option value="TRANSPORT">Transport</option></select></label><Dates filters={draft} update={update} /><button className="primary" type="submit">Apply filters</button><button className="secondary" type="button" onClick={() => { setDraft(emptyAudit); setFilters(emptyAudit); setPage(1); }}>Clear</button></form>
    <p className="muted insight-caption">Times and date filters use Sri Lanka time. Includes stored setup / administrator sign-in events and transport history; not a complete record of every system change.</p>
    {error ? <div className="error" role="alert">{error} Use Refresh to try again.</div> : loading ? <p role="status">Loading audit logs…</p> : <><div className="insight-table audit-table" tabIndex={0} role="region" aria-label="Audit log results"><table><thead><tr>{["Time · Sri Lanka", "Event / source", "Actor", "Details"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.logs.map((r) => <tr key={r._id}><td>{dateTime(r.at)}</td><td><div className="audit-event"><strong>{label(r.event)}</strong><span className="badge">{label(r.source)}</span></div><small>{r.event}</small></td><td>{r.actorName || "Unknown"}{r.ip && <small>IP: {r.ip}</small>}</td><td>{r.note || "—"}<small>Reference: {r.reference}</small></td></tr>)}</tbody></table>{!data.logs.length && <div className="insight-empty"><h3>No matching activity</h3><p className="muted">Change your filters to search more recorded events.</p></div>}</div><Pager page={page} total={data.total} onChange={setPage} /></>}
  </section>;
}
