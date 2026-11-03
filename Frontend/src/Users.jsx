import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Roles from "./Roles";
import UsersTable from "./UsersTable";
import { staffModules, defaultAccess } from "./access";

const emptyForm = { fullName: "", username: "", contact: "", password: "", role: "EMPLOYEE", status: "ACTIVE", departmentId: "", sidebarAccess: defaultAccess("EMPLOYEE") };

export default function Users({ refreshKey, onChanged }) {
  const [section, setSection] = useState("users");
  const [availableRoles, setAvailableRoles] = useState([]);
  const roles = Object.fromEntries(availableRoles.map((role) => [role.value, role.name]));
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialogError, setDialogError] = useState("");
  const editor = useRef(null);
  const deleteDialog = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api("/super-admin/users"), api("/super-admin/departments"), api("/super-admin/roles")])
      .then(([people, teams, roleData]) => {
        if (active) { setUsers(people.users); setDepartments(teams.departments); setAvailableRoles(roleData.roles); }
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  function reset() { setEditing(null); setForm(emptyForm); setDialogError(""); }
  function closeEditor() { if (!busy) { editor.current.close(); reset(); } }
  function create() { reset(); editor.current.showModal(); }
  function confirmDelete(user) { setDeleting(user); setDialogError(""); deleteDialog.current.showModal(); }
  function closeDelete() { if (!busy) { deleteDialog.current.close(); setDeleting(null); setDialogError(""); } }
  function change(event) { const { name, value } = event.target; setForm((current) => ({ ...current, [name]: value })); }
  function toggleAccess(key) { setForm((current) => ({ ...current, sidebarAccess: current.sidebarAccess.includes(key) ? current.sidebarAccess.filter((item) => item !== key) : [...current.sidebarAccess, key] })); }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setDialogError(""); setMessage("");
    const body = { ...form, departmentId: form.departmentId || null };
    if (editing && !body.password) delete body.password;
    try {
      const { user } = await api(`/super-admin/users${editing ? `/${editing}` : ""}`, body, editing ? "PUT" : "POST");
      setUsers((items) => [...items.filter((item) => item.id !== user.id), user].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setMessage(editing ? "User updated." : "User created.");
      editor.current.close(); reset(); onChanged();
    } catch (err) { setDialogError(err.message); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    if (busy) return;
    setBusy(true); setDialogError(""); setMessage("");
    try {
      await api(`/super-admin/users/${id}`, undefined, "DELETE");
      setUsers((items) => items.filter((item) => item.id !== id));
      if (editing === id) reset();
      deleteDialog.current.close(); setDeleting(null); setMessage("User deleted."); onChanged();
    } catch (err) { setDialogError(err.message); }
    finally { setBusy(false); }
  }
  function edit(user) {
    setEditing(user.id);
    setForm({ fullName: user.fullName, username: user.username, contact: user.contact || "", password: "", role: user.role, status: user.status, departmentId: user.departmentId || "", sidebarAccess: user.sidebarAccess ?? defaultAccess(user.role) });
    setDeleting(null); setError(""); setMessage("");
    setDialogError(""); editor.current.showModal();
  }
  return (
    <section aria-label="Manage users">
      <div className="management-sections" aria-label="User Management sections">
        <button type="button" aria-pressed={section === "users"} disabled={busy} onClick={() => setSection("users")}>Users</button>
        <button type="button" aria-pressed={section === "roles"} disabled={busy} onClick={() => setSection("roles")}>Roles</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {section === "roles" && <Roles roles={availableRoles} loading={loading} onCreated={(role) => setAvailableRoles((items) => [...items, role])} />}
      <div className="page-enter" hidden={section !== "users"}>
      <p className="department-status" role="status">{message}</p>
      <UsersTable users={users} roles={availableRoles} departments={departments} loading={loading} busy={busy} onCreate={create} onEdit={edit} onDelete={confirmDelete} />
      <dialog ref={editor} className="user-editor-dialog" aria-labelledby="user-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else reset(); }}>
        <header className="user-dialog-heading"><div><span className="eyebrow accent">PEOPLE & ACCESS</span><h2 id="user-editor-title">{editing ? "Edit user" : "Create user"}</h2></div><button type="button" className="user-dialog-close" aria-label="Close user form" disabled={busy} onClick={closeEditor}>&times;</button></header>
        <p className="muted">{editing ? "Update account details and department assignment." : "Add a team member and choose their role and department."}</p>
        {dialogError && <div className="error" role="alert">{dialogError}</div>}
          <form onSubmit={save}>
            <label htmlFor="user-full-name">Full name
              <input id="user-full-name" autoFocus name="fullName" value={form.fullName} onChange={change} required minLength={2} maxLength={100} disabled={busy || loading} />
            </label>
            <label htmlFor="user-username">Username
              <input id="user-username" name="username" value={form.username} onChange={change} required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]+" autoCapitalize="none" disabled={busy || loading} />
            </label>
            <label htmlFor="user-contact">Contact number
              <input id="user-contact" name="contact" type="tel" autoComplete="tel" value={form.contact} onChange={change} required minLength={7} maxLength={30} placeholder="e.g. 077 123 4567" disabled={busy || loading} />
            </label>
            <label htmlFor="user-password">{editing ? "New password (optional)" : "Password"}
              <input id="user-password" name="password" type="password" value={form.password} onChange={change} autoComplete="new-password" required={!editing} minLength={6} disabled={busy || loading} aria-describedby="user-password-help" />
            </label>
            <p className="muted" id="user-password-help">At least 6 characters, up to 72 UTF-8 bytes.{editing ? " Leave blank to keep the current password." : ""}</p>
            <div className="field-row">
              <div className="select-field"><label htmlFor="user-role">Role</label>
                <select id="user-role" name="role" value={form.role} onChange={change} disabled={busy || loading}>
                  {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="select-field"><label htmlFor="user-status">Status</label>
                <select id="user-status" name="status" value={form.status} onChange={change} disabled={busy || loading}>
                  <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>
            <div className="select-field"><label htmlFor="user-department">Department</label>
              <select id="user-department" name="departmentId" value={form.departmentId} onChange={change} disabled={busy || loading}>
                <option value="">Unassigned</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </div>
            {!loading && departments.length === 0 && <p className="muted">Create a department in Department Management to assign users to it.</p>}
            <fieldset className="user-access" disabled={busy || loading}>
              <legend>Sidebar access</legend>
              <p className="muted">Choose the sections this user can open. Approval and booking access also allow the actions described below.</p>
              <div className="access-options">{staffModules.map((module) => <label className="access-option" key={module.key}><input type="checkbox" checked={form.sidebarAccess.includes(module.key)} onChange={() => toggleAccess(module.key)} /><span><strong>{module.title}</strong><small>{module.description}</small></span></label>)}</div>
              <button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, sidebarAccess: defaultAccess(current.role) }))}>Use role defaults</button>
              {!form.sidebarAccess.length && <p className="info">This user can sign in but has no workspace sections until you grant access.</p>}
            </fieldset>
            <div className="user-dialog-actions">
              <button type="submit" className="primary" disabled={busy || loading}>{busy ? "Saving…" : editing ? "Save changes" : "Create user"}</button>
              <button type="button" className="secondary" disabled={busy} onClick={closeEditor}>Cancel</button>
            </div>
          </form>
      </dialog>
      <dialog ref={deleteDialog} className="logout-dialog" aria-labelledby="delete-user-title" onCancel={(event) => { if (busy) event.preventDefault(); else { setDeleting(null); setDialogError(""); } }}>
        <span className="eyebrow accent">REMOVE USER</span><h2 id="delete-user-title">Delete user?</h2><p className="muted">Delete <strong>{deleting?.fullName}</strong>? This cannot be undone.</p>
        {dialogError && <div className="error" role="alert">{dialogError}</div>}
        <div className="logout-actions"><button type="button" className="secondary" autoFocus disabled={busy} onClick={closeDelete}>Keep user</button><button type="button" className="danger" disabled={busy} onClick={() => remove(deleting.id)}>{busy ? "Deleting…" : "Confirm delete"}</button></div>
      </dialog>
      </div>
    </section>
  );
}
