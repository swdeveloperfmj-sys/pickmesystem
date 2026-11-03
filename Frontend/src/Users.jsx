import React, { useEffect, useState } from "react";
import { api } from "./api";
import Roles from "./Roles";

const emptyForm = { fullName: "", username: "", contact: "", password: "", role: "EMPLOYEE", status: "ACTIVE", departmentId: "" };

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
  const [search, setSearch] = useState("");

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

  function reset() { setEditing(null); setForm(emptyForm); }
  function change(event) { setForm((value) => ({ ...value, [event.target.name]: event.target.value })); }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    const body = { ...form, departmentId: form.departmentId || null };
    if (editing && !body.password) delete body.password;
    try {
      const { user } = await api(`/super-admin/users${editing ? `/${editing}` : ""}`, body, editing ? "PUT" : "POST");
      setUsers((items) => [...items.filter((item) => item.id !== user.id), user].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setMessage(editing ? "User updated." : "User created.");
      reset(); onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/super-admin/users/${id}`, undefined, "DELETE");
      setUsers((items) => items.filter((item) => item.id !== id));
      if (editing === id) reset();
      setDeleting(null); setMessage("User deleted."); onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function edit(user) {
    setEditing(user.id);
    setForm({ fullName: user.fullName, username: user.username, contact: user.contact || "", password: "", role: user.role, status: user.status, departmentId: user.departmentId || "" });
    setDeleting(null); setError(""); setMessage("");
    document.getElementById("user-full-name")?.focus();
  }
  const query = search.trim().toLowerCase();
  const filtered = users.filter((user) => [user.fullName, user.username, user.contact, user.department?.name, roles[user.role]].some((value) => value?.toLowerCase().includes(query)));
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
      <div className="department-layout">
        <section className="department-form-card">
          <span className="eyebrow accent">YOUR PEOPLE</span>
          <h2>{editing ? "Edit user" : "Create user"}</h2>
          <p className="muted">Manage user details, role, and department. The Super Administrator account is protected.</p>
          <form onSubmit={save}>
            <label htmlFor="user-full-name">Full name
              <input id="user-full-name" name="fullName" value={form.fullName} onChange={change} required minLength={2} maxLength={100} disabled={busy || loading} />
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
            <div className="department-actions">
              <button type="submit" className="primary" disabled={busy || loading}>{busy ? "Saving…" : editing ? "Save changes" : "Create user"}</button>
              {editing && <button type="button" className="secondary" disabled={busy} onClick={reset}>Cancel edit</button>}
            </div>
          </form>
        </section>
        <section className="department-list" aria-label="User list" aria-busy={loading}>
          <div className="department-list-heading"><h2>Users</h2><span className="badge">{users.length} total</span></div>
          <label htmlFor="user-search">Search users
            <input id="user-search" type="search" placeholder="Name, contact, role, or department" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {loading ? <p role="status" className="muted">Loading users…</p> : filtered.length === 0 ? <p className="muted">{users.length ? "No matching users." : "No users yet. Create your first user."}</p> : filtered.map((user) => (
            <article className="department-item" key={user.id} aria-label={user.fullName}>
              <h3>{user.fullName}</h3>
              <p className="muted">{user.username} · {user.contact || "No contact added"}</p>
              <p className="muted">{roles[user.role]} · {user.status === "ACTIVE" ? "Active" : "Inactive"} · {user.department?.name || "Unassigned"}</p>
              {deleting === user.id ? <div className="delete-confirmation">
                <p>Delete “{user.fullName}”? This cannot be undone.</p>
                <div className="department-actions">
                  <button type="button" className="danger" disabled={busy} onClick={() => remove(user.id)}>{busy ? "Deleting…" : "Confirm delete"}</button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep user</button>
                </div>
              </div> : <div className="department-actions">
                <button type="button" className="secondary" disabled={busy || loading} onClick={() => edit(user)}>Edit</button>
                <button type="button" className="danger" disabled={busy || loading} onClick={() => { setDeleting(user.id); setMessage(""); }}>Delete</button>
              </div>}
            </article>
          ))}
        </section>
      </div>
      </div>
    </section>
  );
}
