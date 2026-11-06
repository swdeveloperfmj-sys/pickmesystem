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
  const grouped = departments.map((team) => ({
    ...team,
    people: visible.filter((user) => user.departmentId === team.id),
  })).filter((team) => team.people.length);
  const unassigned = visible.filter((user) => !user.departmentId);
  const roleGroups = (people) => roles.map((item) => ({
    ...item,
    people: people.filter((user) => user.role === item.value),
  })).filter((group) => group.people.length);
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const renderPerson = (user) => <article className="tree-person" key={user.id}>
    <span className="user-avatar" aria-hidden="true">{initials(user.fullName)}</span>
    <div className="tree-person-details"><strong title={user.fullName}>{user.fullName}</strong><span>@{user.username} · {user.contact || "No contact added"}</span><div className="tree-person-tags"><span className={`user-status-chip ${user.status === "ACTIVE" ? "is-active" : "is-inactive"}`}><i aria-hidden="true" />{user.status === "ACTIVE" ? "Active" : "Inactive"}</span><span className="user-sop">SOP {user.sopAcknowledgedAt ? "acknowledged" : "pending"}</span></div></div>
    <div className="user-row-actions"><button type="button" className="user-edit" disabled={busy} onClick={() => onEdit(user)}>Edit</button><button type="button" className="user-delete" disabled={busy} onClick={() => onDelete(user)}>Delete</button></div>
  </article>;
  function clearFilters() { setSearch(""); setRole(""); setDepartment(""); setStatus(""); setPage(1); }

  return <section className="user-directory" aria-label="User list" aria-busy={loading}>
    <header className="user-directory-heading">
      <div><span className="eyebrow accent">PEOPLE & ACCESS</span><h2>Team tree <span className="user-total">{users.length}</span></h2><p>Explore your team by department and role.</p></div>
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
    <div className="user-tree" aria-label="Users grouped by department">
      {loading ? <p className="user-tree-empty" role="status">Loading users…</p> : visible.length === 0 ? <div className="user-tree-empty"><strong>{users.length ? "No matching users" : "Your team starts here"}</strong><p>{users.length ? "Try another search or clear your filters." : "Add your first user to manage their access and department."}</p>{users.length > 0 && <button className="secondary" onClick={clearFilters}>Clear filters</button>}</div> : <>
        <div className="tree-root"><span aria-hidden="true">✦</span><div><strong>Organization</strong><small>{visible.length} {visible.length === 1 ? "team member" : "team members"}</small></div></div>
        <div className="tree-branches">{grouped.map((team) => <section className="tree-branch" key={team.id}>
          <div className="tree-department"><span className="tree-node-icon" aria-hidden="true">▦</span><div><strong>{team.name}</strong><small>{team.people.length} {team.people.length === 1 ? "member" : "members"}</small></div></div>
          <div className="tree-role-list">{roleGroups(team.people).map((group) => <section className="tree-role" key={group.value}><div className="tree-role-heading"><span className="tree-role-dot" /><strong>{group.name || names[group.value] || group.value}</strong><span>{group.people.length}</span></div><div className="tree-people">{group.people.map(renderPerson)}</div></section>)}</div>
        </section>)}
        {unassigned.length > 0 && <section className="tree-branch"><div className="tree-department is-unassigned"><span className="tree-node-icon" aria-hidden="true">◌</span><div><strong>Unassigned</strong><small>{unassigned.length} {unassigned.length === 1 ? "member" : "members"}</small></div></div><div className="tree-role-list">{roleGroups(unassigned).map((group) => <section className="tree-role" key={group.value}><div className="tree-role-heading"><span className="tree-role-dot" /><strong>{group.name || names[group.value] || group.value}</strong><span>{group.people.length}</span></div><div className="tree-people">{group.people.map(renderPerson)}</div></section>)}</div></section>}
        </div>
      </>}
    </div>
    <footer className="user-table-footer"><p>{filtered.length ? `Showing ${(current - 1) * 10 + 1}–${Math.min(current * 10, filtered.length)} of ${filtered.length} users` : "0 users"}</p><div className="user-pagination"><button type="button" className="secondary" disabled={current === 1 || loading} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="secondary" disabled={current >= pages || loading} onClick={() => setPage(current + 1)}>Next</button></div></footer>
  </section>;
}
