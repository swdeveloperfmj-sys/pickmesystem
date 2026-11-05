import React, { useEffect, useState } from "react";
import { api } from "./api";

const emptyForm = { name: "", description: "", budget: 0 };

export default function Departments({ refreshKey, onChanged }) {
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
  }

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
      reset();
      onChanged();
    } catch (err) {
      setError(err.message);
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
    document.getElementById("department-name")?.focus();
  }

  return (
    <section className="departments" aria-label="Manage departments">
      {error && <div role="alert" className="error">{error}</div>}
      <p role="status" className="department-status">{message}</p>
      <section className="department-form-card" aria-label="Overall weekly transport credit limit">
        <span className="eyebrow accent">TRANSPORT BUDGET</span>
        <h2>Overall weekly credit limit</h2>
        <p className="muted">Set the total transport credit available each week. Department budgets are assigned from this LKR limit.</p>
        <form onSubmit={saveCreditLimit} className="department-actions">
          <label htmlFor="overall-credit-limit">Weekly credit limit (LKR)
            <input id="overall-credit-limit" type="number" min="0" step="0.01" required value={creditInput} onChange={(event) => setCreditInput(event.target.value)} disabled={creditBusy || loading} />
          </label>
          <button className="primary" type="submit" disabled={creditBusy || loading}>{creditBusy ? "Saving…" : "Save weekly limit"}</button>
        </form>
        <p className="muted">Weekly department allocation: LKR {departments.reduce((sum, item) => sum + (item.budget || 0), 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })} / LKR {creditLimit.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</p>
      </section>
      <div className="department-layout">
        <section className="department-form-card">
          <span className="eyebrow accent">ORGANIZE YOUR WORKSPACE</span>
          <h2>{editing ? "Edit department" : "Create department"}</h2>
          <p className="muted">Add a department name and an optional description.</p>
          <form onSubmit={save}>
            <label htmlFor="department-name">Department name
              <input id="department-name" required minLength={2} maxLength={100}
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
              {editing && <button type="button" className="secondary" disabled={busy} onClick={reset}>Cancel edit</button>}
            </div>
          </form>
        </section>
        <section className="department-list" aria-labelledby="department-list-heading" aria-busy={loading}>
          <div className="department-list-heading">
            <h2 id="department-list-heading">Departments</h2>
            <span className="badge">{departments.length} total</span>
          </div>
          {loading ? <p role="status" className="muted">Loading departments…</p>
            : departments.length === 0 ? <p className="muted">No departments yet. Create your first department to get started.</p>
            : departments.map((department) => (
              <article className="department-item" key={department.id} aria-label={department.name}>
                <h3>{department.name}</h3>
                <p className="muted department-description">{department.description || "No description added."}</p>
                <p><strong>Weekly budget:</strong> LKR {(department.budget || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}</p>
                {deleting === department.id ? (
                  <div className="delete-confirmation">
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
