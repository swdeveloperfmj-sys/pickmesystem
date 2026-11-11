import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Roles from "./Roles";
import UsersTable from "./UsersTable";
import { staffModules, defaultAccess } from "./access";
import { matchingApprovers, updateApproverSelection } from "./approvers.js";

const emptyForm = { fullName: "", username: "", designation: "", contact: "", password: "", role: "", status: "ACTIVE", sidebarAccess: defaultAccess("") };
const emptyAssignments = { departmentIds: [], companyIds: [], approverIds: [] };

export default function Users({ refreshKey, onChanged }) {
  const [section, setSection] = useState("users");
  const [availableRoles, setAvailableRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(() => ({ ...emptyForm, ...emptyAssignments }));
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
    Promise.all([
      api("/super-admin/users"),
      api("/super-admin/departments"),
      api("/super-admin/roles"),
      api("/super-admin/companies"),
    ])
      .then(([people, teams, roleData, companyData]) => {
        if (active) {
          setUsers(people.users);
          setDepartments(teams.departments);
          setAvailableRoles(roleData.roles);
          setCompanies(companyData.companies);
        }
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  function reset() { setEditing(null); setForm({ ...emptyForm, ...emptyAssignments }); setDialogError(""); }
  function closeEditor() { if (!busy) { editor.current.close(); reset(); } }
  function create(approver = false, assistant = false) {
    setError("");
    const role = "EMPLOYEE";
    setForm({
      ...emptyForm,
      ...emptyAssignments,
      role,
      designation: assistant ? "Administrative Assistant" : "",
      sidebarAccess: assistant ? ["DASHBOARD", "BOOKINGS", "HISTORY"] : [...new Set([
        ...defaultAccess(role),
        ...(approver ? ["APPROVALS"] : []),
      ])],
    });
    setEditing(null);
    setDialogError("");
    editor.current.showModal();
  }
  function confirmDelete(user) { setDeleting(user); setDialogError(""); deleteDialog.current.showModal(); }
  function closeDelete() { if (!busy) { deleteDialog.current.close(); setDeleting(null); setDialogError(""); } }
  function change(event) { const { name, value } = event.target; setForm((current) => ({ ...current, [name]: value })); }
  function toggleAssignment(field, id) {
    setForm((current) => {
      const next = {
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((item) => item !== id)
        : [...current[field], id],
      };
      next.approverIds = updateApproverSelection(users, current, next, editing);
      return next;
    });
  }
  function toggleAccess(key) { setForm((current) => ({ ...current, sidebarAccess: current.sidebarAccess.includes(key) ? current.sidebarAccess.filter((item) => item !== key) : [...current.sidebarAccess, key] })); }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setDialogError(""); setMessage("");
    const body = {
      ...form,
      approverIds: form.sidebarAccess.includes("APPROVALS") ? [] : form.approverIds,
      departmentId: form.departmentIds[0] || null,
    };
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
    setForm({
      fullName: user.fullName,
      username: user.username,
      designation: user.designation || "",
      contact: user.contact || "",
      password: "",
      role: user.role,
      status: user.status,
      departmentIds: user.departmentIds || (user.departmentId ? [user.departmentId] : []),
      companyIds: user.companyIds || (user.companyId ? [user.companyId] : []),
      approverIds: user.approverIds ?? matchingApprovers(users, {
        departmentIds: user.departmentIds || (user.departmentId ? [user.departmentId] : []),
        companyIds: user.companyIds || (user.companyId ? [user.companyId] : []),
      }, user.id).map((item) => item.id),
      sidebarAccess: user.sidebarAccess ?? defaultAccess(user.role),
    });
    setDeleting(null); setError(""); setMessage("");
    setDialogError(""); editor.current.showModal();
  }
  const approverUsers = users.filter((user) =>
    (user.sidebarAccess ?? defaultAccess(user.role)).includes("APPROVALS"),
  );
  const regularUsers = users.filter((user) =>
    !(user.sidebarAccess ?? defaultAccess(user.role)).some((access) => ["APPROVALS", "BOOKINGS"].includes(access)),
  );
  const assistantUsers = users.filter((user) =>
    (user.sidebarAccess ?? defaultAccess(user.role)).includes("BOOKINGS"),
  );
  const assignmentsRequired = form.sidebarAccess.includes("APPROVALS");
  const eligibleApprovers = matchingApprovers(users, form, editing);
  return (
    <section aria-label="Manage users">
      <div className="management-sections" aria-label="User Management sections">
        <button type="button" aria-pressed={section === "users"} disabled={busy} onClick={() => setSection("users")}>Users</button>
        <button type="button" aria-pressed={section === "approvers"} disabled={busy} onClick={() => setSection("approvers")}>Approver user</button>
        <button type="button" aria-pressed={section === "assistants"} disabled={busy} onClick={() => setSection("assistants")}>Booking assistants</button>
        <button type="button" aria-pressed={section === "roles"} disabled={busy} onClick={() => setSection("roles")}>Roles</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {section === "roles" && <Roles roles={availableRoles} loading={loading} onChanged={setAvailableRoles} />}
      <div className="page-enter" hidden={section === "roles"}>
      <p className="department-status" role="status">{message}</p>
      <UsersTable
        key={section}
        users={section === "assistants" ? assistantUsers : section === "approvers" ? approverUsers : regularUsers}
        departments={departments}
        companies={companies}
        organizeByCompany={section === "approvers"}
        loading={loading}
        busy={busy}
        onCreate={() => create(section === "approvers", section === "assistants")}
        onEdit={edit}
        onDelete={confirmDelete}
        heading={section === "assistants" ? "Booking assistants" : section === "approvers" ? "Approver users" : "Users"}
        description={section === "assistants" ? "Manage assistants who book approved requests in PickMe. All booking assistants share the approved request queue." : section === "approvers" ? "Users with approval access who can review assigned transport requests." : "Manage users, departments and assigned approvers."}
        addLabel={section === "assistants" ? "Add booking assistant" : section === "approvers" ? "Add approver user" : "Add user"}
        emptyTitle={section === "assistants" ? "No booking assistants yet" : section === "approvers" ? "No approver users yet" : undefined}
        emptyDescription={section === "assistants" ? "Add an assistant to handle approved transport requests." : section === "approvers" ? "Add an approver user to give them approval access." : undefined}
      />
      <dialog ref={editor} className="user-editor-dialog" aria-labelledby="user-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else reset(); }}>
        <header className="user-dialog-heading"><div><span className="eyebrow accent">PEOPLE & ACCESS</span><h2 id="user-editor-title">{editing ? "Edit user" : "Create user"}</h2></div><button type="button" className="user-dialog-close" aria-label="Close user form" disabled={busy} onClick={closeEditor}>&times;</button></header>
        <p className="muted">{editing ? "Update account details, organization and department assignment." : "Add a team member and choose their organization and access."}</p>
        {dialogError && <div className="error" role="alert">{dialogError}</div>}
          <form onSubmit={save}>
            <label htmlFor="user-full-name">Full name
              <input id="user-full-name" autoFocus name="fullName" value={form.fullName} onChange={change} required minLength={2} maxLength={100} disabled={busy || loading} />
            </label>
            <label htmlFor="user-username">Username
              <input id="user-username" name="username" value={form.username} onChange={change} required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]+" autoCapitalize="none" disabled={busy || loading} />
            </label>
            <label htmlFor="user-designation">Designation
              <input id="user-designation" name="designation" value={form.designation} onChange={change} required minLength={2} maxLength={100} placeholder="e.g. Production Executive" disabled={busy || loading} />
            </label>
            <label htmlFor="user-contact">Contact number
              <input id="user-contact" name="contact" type="tel" autoComplete="tel" value={form.contact} onChange={change} required minLength={7} maxLength={30} placeholder="e.g. 077 123 4567" disabled={busy || loading} />
            </label>
            <label htmlFor="user-password">{editing ? "New password (optional)" : "Password"}
              <input id="user-password" name="password" type="password" value={form.password} onChange={change} autoComplete="new-password" required={!editing} minLength={6} disabled={busy || loading} aria-describedby="user-password-help" />
            </label>
            <p className="muted" id="user-password-help">At least 6 characters, up to 72 UTF-8 bytes.{editing ? " Leave blank to keep the current password." : ""}</p>
            <div className="field-row">
              <div className="select-field"><label htmlFor="user-status">Status</label>
                <select id="user-status" name="status" value={form.status} onChange={change} disabled={busy || loading}>
                  <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>
            <fieldset className="user-assignment" disabled={busy || loading}>
              <legend>Departments{assignmentsRequired ? " *" : ""}</legend>
              <p className="muted">Select all departments this user belongs to. The first selected department is used as the primary department.</p>
              {departments.length ? <div className="assignment-options">
                {departments.map((department) => <label className="assignment-option" key={department.id}>
                  <input type="checkbox" checked={form.departmentIds.includes(department.id)} onChange={() => toggleAssignment("departmentIds", department.id)} />
                  <span>{department.name}</span>
                </label>)}
              </div> : <p className="muted">Create a department in Department Management first.</p>}
            </fieldset>
            <fieldset className="user-assignment" disabled={busy || loading}>
              <legend>Companies{assignmentsRequired ? " *" : ""}</legend>
              <p className="muted">{assignmentsRequired ? "Select all companies this user can approve requests for." : "Select the companies this user belongs to."}</p>
              {companies.length ? <div className="assignment-options">
                {companies.map((company) => <label className="assignment-option" key={company.id}>
                  <input type="checkbox" checked={form.companyIds.includes(company.id)} onChange={() => toggleAssignment("companyIds", company.id)} />
                  <span>{company.name}</span>
                </label>)}
              </div> : <p className="muted">Create a company in Department Management first.</p>}
            </fieldset>
            {assignmentsRequired && (!form.departmentIds.length || !form.companyIds.length) && <p className="info">Select at least one department and company for an approver user.</p>}
            {!assignmentsRequired && form.sidebarAccess.includes("REQUESTS") && <fieldset className="user-assignment" disabled={busy || loading}>
              <legend>Assigned approvers</legend>
              <p className="muted">Active approvers matching both the selected departments and companies are selected automatically. Uncheck anyone you do not want to assign.</p>
              {!form.departmentIds.length || !form.companyIds.length ? <p className="info">Select a department and company to see matching approvers.</p>
                : eligibleApprovers.length === 0 ? <p className="info">No active approvers match these departments and companies.</p>
                : <><div className="assignment-options">{eligibleApprovers.map((approver) => <label className="assignment-option" key={approver.id}>
                  <input type="checkbox" checked={form.approverIds.includes(approver.id)} onChange={() => setForm((current) => ({ ...current, approverIds: current.approverIds.includes(approver.id) ? current.approverIds.filter((id) => id !== approver.id) : [...current.approverIds, approver.id] }))} />
                  <span>{approver.fullName} (@{approver.username})</span>
                </label>)}</div><p className="muted">{eligibleApprovers.filter((user) => form.approverIds.includes(user.id)).length} approvers selected</p></>}
            </fieldset>}
            <fieldset className="user-access" disabled={busy || loading}>
              <legend>Sidebar access</legend>
              <p className="muted">Choose the sections this user can open. Approval and booking access also allow the actions described below.</p>
              <div className="access-options">{staffModules.map((module) => <label className="access-option" key={module.key}><input type="checkbox" checked={form.sidebarAccess.includes(module.key)} onChange={() => toggleAccess(module.key)} /><span><strong>{module.title}</strong><small>{module.description}</small></span></label>)}</div>
              <button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, sidebarAccess: section === "assistants" ? ["DASHBOARD", "BOOKINGS", "HISTORY"] : [...defaultAccess("EMPLOYEE"), ...(section === "approvers" ? ["APPROVALS"] : [])] }))}>Reset access</button>
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
