import React, { useState } from "react";

export default function UsersTable({ users, roles, departments, loading, busy, onCreate, onEdit, onDelete }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const names = Object.fromEntries(roles.map((item) => [item.value, item.name]));
  const filtered = users.filter((user) =>
    (!role || user.role === role) && (!status || user.status === status) &&
    (!department || (department === "unassigned" ? !user.departmentId : user.departmentId === department)) &&
    [user.fullName, user.username, user.contact, user.department?.name, names[user.role]].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * 10, current * 10);
  function clearFilters() { setSearch(""); setRole(""); setDepartment(""); setStatus(""); setPage(1); }

  return <section className="user-directory" aria-label="User list" aria-busy={loading}>
    <header className="user-directory-heading">
      <div><span className="eyebrow accent">PEOPLE & ACCESS</span><h2>User directory <span className="user-total">{users.length}</span></h2><p>Manage your team, roles and department assignments.</p></div>
      <button type="button" className="primary user-add" disabled={loading || busy} onClick={onCreate}><span aria-hidden="true">+</span> Add user</button>
    </header>
    <div className="user-table-toolbar">
      <label className="user-search" htmlFor="user-search">Search users
        <input id="user-search" type="search" placeholder="Search name, username or contact…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      </label>
      <div className="select-field"><label htmlFor="filter-role">Filter by role</label><select id="filter-role" value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="">All roles</option>{roles.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}</select></div>
      <div className="select-field"><label htmlFor="filter-department">Filter by department</label><select id="filter-department" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1); }}><option value="">All departments</option><option value="unassigned">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="select-field"><label htmlFor="filter-status">Filter by status</label><select id="filter-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
    </div>
    <p className="user-table-hint">Swipe or scroll horizontally to see all user details and actions.</p>
    <div className="user-table-scroll" role="region" aria-label="User directory table" tabIndex={0}>
      <table className="user-table">
        <caption className="sr-only">Users with contact, role, department, status and actions</caption>
        <thead><tr><th scope="col">User</th><th scope="col">Contact number</th><th scope="col">Role</th><th scope="col">Department</th><th scope="col">Status</th><th scope="col">SOP</th><th scope="col" className="user-actions-column">Actions</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={7} className="user-table-empty"><p role="status">Loading users…</p></td></tr> : visible.length === 0 ? <tr><td colSpan={7} className="user-table-empty"><strong>{users.length ? "No matching users" : "Your team starts here"}</strong><p>{users.length ? "Try another search or clear your filters." : "Add your first user to manage their access and department."}</p>{users.length > 0 && <button className="secondary" onClick={clearFilters}>Clear filters</button>}</td></tr> : visible.map((user) => (
            <tr key={user.id} aria-label={user.fullName}>
              <td><div className="user-identity"><span className="user-avatar" aria-hidden="true">{user.fullName.trim().split(/\s+/).slice(0, 2).map((name) => name[0]).join("").toUpperCase()}</span><div><strong title={user.fullName}>{user.fullName}</strong><span title={user.username}>@{user.username}</span></div></div></td>
              <td className="user-contact">{user.contact || <span className="user-cell-muted">Not added</span>}</td>
              <td><span className="user-role-chip">{names[user.role] || user.role}</span></td>
              <td>{user.department?.name || <span className="user-cell-muted">Unassigned</span>}</td>
              <td><span className={`user-status-chip ${user.status === "ACTIVE" ? "is-active" : "is-inactive"}`}><i aria-hidden="true" />{user.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
              <td><span className="user-sop" title={user.sopAcknowledgedAt ? new Date(user.sopAcknowledgedAt).toLocaleDateString("en-GB") : "SOP has not been acknowledged"}>{user.sopAcknowledgedAt ? "Acknowledged" : "Pending"}</span></td>
              <td><div className="user-row-actions"><button type="button" className="user-edit" disabled={busy} onClick={() => onEdit(user)}>Edit</button><button type="button" className="user-delete" disabled={busy} onClick={() => onDelete(user)}>Delete</button></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <footer className="user-table-footer"><p>{filtered.length ? `Showing ${(current - 1) * 10 + 1}–${Math.min(current * 10, filtered.length)} of ${filtered.length} users` : "0 users"}</p><div className="user-pagination"><button type="button" className="secondary" disabled={current === 1 || loading} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="secondary" disabled={current >= pages || loading} onClick={() => setPage(current + 1)}>Next</button></div></footer>
  </section>;
}
