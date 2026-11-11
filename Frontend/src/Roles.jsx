import React, { useRef, useState } from "react";
import { api } from "./api";

const emptyForm = { name: "", description: "" };

export default function Roles({ roles, loading, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const editor = useRef(null);

  function openEditor(role) {
    setEditing(role?.value || null);
    setForm(role ? { name: role.name, description: role.description || "" } : emptyForm);
    setDialogError("");
    setError("");
    setMessage("");
    setDeleting(null);
    editor.current.showModal();
  }

  function closeEditor() {
    if (busy) return;
    editor.current.close();
    setEditing(null);
    setForm(emptyForm);
    setDialogError("");
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDialogError("");
    setError("");
    setMessage("");
    try {
      const { role } = await api(
        `/super-admin/roles${editing ? `/${editing.slice(7)}` : ""}`,
        form,
        editing ? "PUT" : "POST",
      );
      onChanged((items) => [
        ...items.filter((item) => item.value !== role.value),
        role,
      ].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? "Role updated." : "Role created.");
      editor.current.close();
      setEditing(null);
      setForm(emptyForm);
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(role) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/super-admin/roles/${role.value.slice(7)}`, undefined, "DELETE");
      onChanged((items) => items.filter((item) => item.value !== role.value));
      setDeleting(null);
      setMessage("Role deleted.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = roles.filter((role) =>
    `${role.name} ${role.description || ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="page-enter" aria-label="Manage roles">
      {error && <div className="error" role="alert">{error}</div>}
      <p role="status" className="department-status">{message}</p>
      <section className="department-list compact-departments" aria-busy={loading}>
        <div className="department-list-heading">
          <div className="department-title"><h2>Roles</h2><span className="badge">{roles.length} total</span></div>
          <button className="primary" type="button" disabled={busy || loading} onClick={() => openEditor(null)}>+ Create role</button>
        </div>
        <div className="department-toolbar">
          <input type="search" aria-label="Search roles" placeholder="Search roles…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {loading ? <p role="status" className="muted">Loading roles…</p>
          : roles.length === 0 ? <p className="muted">No roles yet. Create a role before adding users.</p>
          : filtered.length === 0 ? <p className="muted">No roles match your search.</p>
          : filtered.map((role) => (
            <article className="department-item department-row company-row" key={role.value} aria-label={role.name}>
              <div><h3>{role.name}</h3>{role.description && <p className="muted department-description">{role.description}</p>}</div>
              {deleting === role.value ? <div className="delete-confirmation department-row-confirmation">
                <p>Delete “{role.name}”? This cannot be undone.</p>
                <div className="department-actions">
                  <button className="danger" type="button" disabled={busy} onClick={() => remove(role)}>{busy ? "Deleting…" : "Confirm delete"}</button>
                  <button className="secondary" type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep role</button>
                </div>
              </div> : <div className="department-actions">
                <button className="secondary" type="button" disabled={busy} onClick={() => openEditor(role)}>Edit</button>
                <button className="danger" type="button" disabled={busy} onClick={() => setDeleting(role.value)}>Delete</button>
              </div>}
            </article>
          ))}
      </section>
      <dialog ref={editor} className="user-editor-dialog department-editor" aria-labelledby="role-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else { setEditing(null); setForm(emptyForm); } }}>
        <header className="user-dialog-heading">
          <h2 id="role-editor-title">{editing ? "Edit role" : "Create role"}</h2>
          <button type="button" className="user-dialog-close" aria-label="Close role form" disabled={busy} onClick={closeEditor}>&times;</button>
        </header>
        <p className="muted">Add a role name and an optional description. Assign access to users in their account settings.</p>
        {dialogError && <div className="error" role="alert">{dialogError}</div>}
        <form onSubmit={save}>
          <label htmlFor="role-name">Role name
            <input id="role-name" autoFocus required minLength={2} maxLength={100} value={form.name} disabled={busy} placeholder="e.g. Transport Coordinator" onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label htmlFor="role-description">Description (optional)
            <textarea id="role-description" maxLength={500} rows={3} value={form.description} disabled={busy} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <div className="department-actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create role"}</button>
            <button type="button" className="secondary" disabled={busy} onClick={closeEditor}>Cancel</button>
          </div>
        </form>
      </dialog>
      <p className="muted role-note">Custom roles identify users’ responsibilities. Grant workspace access when creating or editing a user. They do not grant Super Administrator access.</p>
    </section>
  );
}
