import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Companies from "./Companies";

const emptyForm = { name: "", description: "" };

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
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api("/super-admin/departments")
      .then((data) => { if (active) setDepartments(data.departments); })
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
    setForm({ name: department.name, description: department.description });
    setDeleting(null);
    setError("");
    setMessage("");
    setDialogError("");
    editor.current.showModal();
    document.getElementById("department-name")?.focus();
  }

  const filtered = departments.filter((item) => `${item.name} ${item.description || ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="departments" aria-label="Manage departments">
      <div className="management-sections" aria-label="Organization sections">
        <button type="button" aria-pressed={section === "departments"} onClick={() => setSection("departments")}>Departments</button>
        <button type="button" aria-pressed={section === "company"} onClick={() => setSection("company")}>Companies</button>
      </div>
      {error && <div role="alert" className="error">{error}</div>}
      <p role="status" className="department-status">{message}</p>
      <div hidden={section !== "company"}><Companies refreshKey={refreshKey} /></div>
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
          <div className="department-toolbar"><input type="search" aria-label="Search departments" placeholder="Search departments…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          {loading ? <p role="status" className="muted">Loading departments…</p>
            : departments.length === 0 ? <p className="muted">No departments yet. Create your first department to get started.</p>
            : filtered.length === 0 ? <p className="muted">No departments match your search.</p>
            : filtered.map((department) => (
              <article className="department-item department-row" key={department.id} aria-label={department.name}>
                <div><h3>{department.name}</h3>
                {department.description && <p className="muted department-description">{department.description}</p>}</div>
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
