import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Companies from "./Companies";
import Locations from "./Locations";

const emptyForm = { name: "", description: "", budget: 0 };

export default function Departments({ refreshKey, onChanged }) {
  const [section, setSection] = useState("departments");
  const [search, setSearch] = useState("");
  const [dialogError, setDialogError] = useState("");
  const editor = useRef(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [creditLimit, setCreditLimit] = useState(0);
  const [creditInput, setCreditInput] = useState("0");
  const [creditBusy, setCreditBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api("/super-admin/departments"), api("/super-admin/budget")])
      .then(([data, budget]) => { if (active) { setDepartments(data.departments); setCreditLimit(budget.creditLimit); setCreditInput(String(budget.creditLimit)); } })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  function reset() {
    setEditing(null);
    setForm(emptyForm);
    setDialogError("");
  }

  function closeEditor() { if (!busy) { editor.current.close(); reset(); } }
  function create() { reset(); editor.current.showModal(); }

  async function saveCreditLimit(event) {
    event.preventDefault();
    setCreditBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/super-admin/budget", { creditLimit: Number(creditInput) }, "PUT");
      setCreditLimit(result.creditLimit); setCreditInput(String(result.creditLimit)); setMessage("Overall weekly credit limit updated.");
    } catch (err) { setError(err.message); }
    finally { setCreditBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDialogError("");
    setError("");
    setMessage("");
    try {
      const result = await api(
        `/super-admin/departments${editing ? `/${editing}` : ""}`,
        form,
        editing ? "PUT" : "POST",
      );
      setDepartments((items) => [
        ...items.filter((item) => item.id !== result.department.id),
        result.department,
      ].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? "Department updated." : "Department created.");
      editor.current.close();
      reset();
      onChanged();
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/super-admin/departments/${id}`, undefined, "DELETE");
      setDepartments((items) => items.filter((item) => item.id !== id));
      if (editing === id) reset();
      setDeleting(null);
      setMessage("Department deleted.");
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function edit(department) {
    setEditing(department.id);
    setForm({ name: department.name, description: department.description, budget: department.budget || 0 });
    setDeleting(null);
    setError("");
    setMessage("");
    setDialogError("");
    editor.current.showModal();
    document.getElementById("department-name")?.focus();
  }

  const allocated = departments.reduce((sum, item) => sum + (item.budget || 0), 0);
  const money = (value) => value.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const filtered = departments.filter((item) => `${item.name} ${item.description || ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="departments" aria-label="Manage departments">
      <div className="management-sections" aria-label="Organization sections">
        <button type="button" aria-pressed={section === "departments"} onClick={() => setSection("departments")}>Departments</button>
        <button type="button" aria-pressed={section === "company"} onClick={() => setSection("company")}>Companies</button>
        <button type="button" aria-pressed={section === "locations"} onClick={() => setSection("locations")}>Location</button>
      </div>
      {error && <div role="alert" className="error">{error}</div>}
      <p role="status" className="department-status">{message}</p>
      <div hidden={section !== "company"}><Companies refreshKey={refreshKey} /></div>
      <div hidden={section !== "locations"}><Locations refreshKey={refreshKey} /></div>
      <section hidden={section !== "departments"} className="department-form-card company-budget" aria-label="Overall weekly transport credit limit">
        <span className="eyebrow accent">TRANSPORT BUDGET</span>
        <h2>Overall weekly credit limit</h2>
        <p className="muted">Set the total transport credit available each week. Department budgets are assigned from this LKR limit.</p>
        <form onSubmit={saveCreditLimit} className="company-budget-form">
          <label htmlFor="overall-credit-limit">Weekly credit limit (LKR)
            <input id="overall-credit-limit" type="number" min="0" step="0.01" required value={creditInput} onChange={(event) => setCreditInput(event.target.value)} disabled={creditBusy || loading} />
          </label>
          <button className="primary" type="submit" disabled={creditBusy || loading}>{creditBusy ? "Saving…" : "Save weekly limit"}</button>
        </form>
        <p className="muted">Weekly department allocation: LKR {departments.reduce((sum, item) => sum + (item.budget || 0), 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })} / LKR {creditLimit.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</p>
      </section>
      <div hidden={section !== "departments"}>
        <dialog ref={editor} className="user-editor-dialog department-editor" aria-labelledby="department-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else reset(); }}>
          <header className="user-dialog-heading"><h2 id="department-editor-title">{editing ? "Edit department" : "Create department"}</h2><button type="button" className="user-dialog-close" aria-label="Close department form" disabled={busy} onClick={closeEditor}>&times;</button></header>
          <p className="muted">Add a department name and an optional description.</p>
          {dialogError && <div className="error" role="alert">{dialogError}</div>}
          <form onSubmit={save}>
            <label htmlFor="department-name">Department name
              <input id="department-name" autoFocus required minLength={2} maxLength={100}
                placeholder="e.g. Human Resources" value={form.name} disabled={busy || loading}
                onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label htmlFor="department-description">Description (optional)
              <textarea id="department-description" maxLength={500} rows={4}
                placeholder="What does this department do?" value={form.description} disabled={busy || loading}
                onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label htmlFor="department-budget">Department weekly budget (LKR)
              <input id="department-budget" type="number" min="0" step="0.01" required value={form.budget} disabled={busy || loading}
                onChange={(event) => setForm({ ...form, budget: Number(event.target.value) })} />
            </label>
            <div className="department-actions">
              <button className="primary" disabled={busy || loading} type="submit">
                {busy ? "Saving…" : editing ? "Save changes" : "Create department"}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={closeEditor}>Cancel</button>
            </div>
          </form>
        </dialog>
        <section className="department-list compact-departments" aria-labelledby="department-list-heading" aria-busy={loading}>
          <div className="department-list-heading">
            <div className="department-title"><h2 id="department-list-heading">Departments</h2><span className="badge">{departments.length} total</span></div>
            <button type="button" className="primary" disabled={loading || busy} onClick={create}>+ Create department</button>
          </div>
          <div className="department-toolbar"><input type="search" aria-label="Search departments" placeholder="Search departments…" value={search} onChange={(event) => setSearch(event.target.value)} /><span className="muted">Weekly allocation <strong>LKR {money(allocated)}</strong></span></div>
          <div className="department-columns" aria-hidden="true"><span>Department</span><span>Weekly budget (LKR)</span><span>Actions</span></div>
          {loading ? <p role="status" className="muted">Loading departments…</p>
            : departments.length === 0 ? <p className="muted">No departments yet. Create your first department to get started.</p>
            : filtered.length === 0 ? <p className="muted">No departments match your search.</p>
            : filtered.map((department) => (
              <article className="department-item department-row" key={department.id} aria-label={department.name}>
                <div><h3>{department.name}</h3>
                {department.description && <p className="muted department-description">{department.description}</p>}</div>
                <p className="department-row-budget"><span className="sr-only">Weekly budget: LKR </span>{money(department.budget || 0)}</p>
                {deleting === department.id ? (
                  <div className="delete-confirmation department-row-confirmation">
                    <p>Delete “{department.name}”? This cannot be undone.</p>
                    <div className="department-actions">
                      <button type="button" className="danger" disabled={busy} onClick={() => remove(department.id)}>{busy ? "Deleting…" : "Confirm delete"}</button>
                      <button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep department</button>
                    </div>
                  </div>
                ) : (
                  <div className="department-actions">
                    <button type="button" className="secondary" disabled={busy || loading} onClick={() => edit(department)}>Edit</button>
                    <button type="button" className="danger" disabled={busy || loading} onClick={() => { setDeleting(department.id); setMessage(""); }}>Delete</button>
                  </div>
                )}
              </article>
            ))}
        </section>
      </div>
    </section>
  );
}
