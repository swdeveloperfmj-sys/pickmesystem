import React, { useState } from "react";

export default function UsersTable({
  users,
  departments,
  companies = [],
  organizeByCompany = false,
  loading,
  busy,
  onCreate,
  onEdit,
  onDelete,
  heading = "Users",
  description = "Manage your users and their access.",
  addLabel = "Add user",
  emptyTitle,
  emptyDescription,
}) {
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const filtered = users.filter((user) =>
    (!status || user.status === status) &&
    (!department || (department === "unassigned"
      ? !(user.departments?.length || user.departmentId)
      : (user.departmentIds || (user.departmentId ? [user.departmentId] : [])).includes(department))) &&
    (!company || (company === "unassigned"
      ? !(user.companies?.length || user.companyId)
      : (user.companyIds || (user.companyId ? [user.companyId] : [])).includes(company))) &&
    [user.fullName, user.username, user.contact, user.department?.name,
      ...(user.departments || []).map((item) => item.name),
      ...(user.companies || []).map((item) => item.name),
      user.company?.name].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * 10, current * 10);
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const renderPerson = (user) => <article className="tree-person" key={user.id}>
    <span className="user-avatar" aria-hidden="true">{initials(user.fullName)}</span>
    <div className="tree-person-details"><strong title={user.fullName}>{user.fullName}</strong><span>@{user.username} · {user.contact || "No contact added"}</span>{(user.departments?.length || user.department || user.companies?.length || user.company || user.locations?.length || user.location) && <span>{[...(user.departments || (user.department ? [user.department] : [])).map((item) => item.name), ...(user.companies || (user.company ? [user.company] : [])).map((item) => item.name), ...(user.locations || (user.location ? [user.location] : [])).map((item) => item.name)].join(" · ")}</span>}<div className="tree-person-tags"><span className={`user-status-chip ${user.status === "ACTIVE" ? "is-active" : "is-inactive"}`}><i aria-hidden="true" />{user.status === "ACTIVE" ? "Active" : "Inactive"}</span><span className="user-sop">SOP {user.sopAcknowledgedAt ? "acknowledged" : "pending"}</span></div></div>
    <div className="user-row-actions"><button type="button" className="user-edit" disabled={busy} onClick={() => onEdit(user)}>Edit</button><button type="button" className="user-delete" disabled={busy} onClick={() => onDelete(user)}>Delete</button></div>
  </article>;
  function clearFilters() { setSearch(""); setDepartment(""); setCompany(""); setStatus(""); setPage(1); }

  return <section className="user-directory" aria-label="User list" aria-busy={loading}>
    <header className="user-directory-heading">
      <div><span className="eyebrow accent">PEOPLE & ACCESS</span><h2>{heading} <span className="user-total">{users.length}</span></h2><p>{description}</p></div>
      <button type="button" className="primary user-add" disabled={loading || busy} onClick={onCreate}><span aria-hidden="true">+</span> {addLabel}</button>
    </header>
    <div className="user-table-toolbar">
      <label className="user-search" htmlFor="user-search">Search users
        <input id="user-search" type="search" placeholder="Search name, username or contact…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      </label>
      <div className="select-field"><label htmlFor="filter-department">Filter by department</label><select id="filter-department" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1); }}><option value="">All departments</option><option value="unassigned">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      {organizeByCompany && <div className="select-field"><label htmlFor="filter-company">Filter by company</label><select id="filter-company" value={company} onChange={(event) => { setCompany(event.target.value); setPage(1); }}><option value="">All companies</option><option value="unassigned">Unassigned</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
      <div className="select-field"><label htmlFor="filter-status">Filter by status</label><select id="filter-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
    </div>
    {organizeByCompany && <section className="approver-directory" aria-labelledby="approver-directory-title">
      <div className="approver-directory-heading">
        <div><h3 id="approver-directory-title">Approver directory <span className="user-total">{loading ? "…" : filtered.length}</span></h3><p>Each approver appears once here. Select a name to view or edit their details.</p></div>
      </div>
      {loading ? <p className="muted" role="status">Loading approvers…</p>
        : filtered.length === 0 ? <p className="muted">{users.length ? "No approvers match your filters." : "No approver users yet."}</p>
        : <ul className="approver-directory-list">{filtered.map((user) => <li key={user.id}>
          <button type="button" className="approver-directory-person" disabled={busy} onClick={() => onEdit(user)} aria-label={`View or edit approver ${user.fullName}`}>
            <span className="user-avatar" aria-hidden="true">{initials(user.fullName)}</span>
            <span className="approver-directory-details"><strong>{user.fullName}</strong><span>@{user.username}</span></span>
            <span className={`user-status-chip ${user.status === "ACTIVE" ? "is-active" : "is-inactive"}`}><i aria-hidden="true" />{user.status === "ACTIVE" ? "Active" : "Inactive"}</span>
          </button>
        </li>)}</ul>}
    </section>}
    {!organizeByCompany && <>
    <div className="user-tree" aria-label="Users">
      {loading ? <p className="user-tree-empty" role="status">Loading users…</p> : visible.length === 0 ? <div className="user-tree-empty"><strong>{users.length ? "No matching users" : emptyTitle || "Your team starts here"}</strong><p>{users.length ? "Try another search or clear your filters." : emptyDescription || "Add your first user to manage their access and department."}</p>{users.length > 0 && <button className="secondary" onClick={clearFilters}>Clear filters</button>}</div> : <>
        <div className="plain-user-list">{visible.map(renderPerson)}</div>
      </>}
    </div>
    <footer className="user-table-footer"><p>{filtered.length ? `Showing ${(current - 1) * 10 + 1}–${Math.min(current * 10, filtered.length)} of ${filtered.length} users` : "0 users"}</p><div className="user-pagination"><button type="button" className="secondary" disabled={current === 1 || loading} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="secondary" disabled={current >= pages || loading} onClick={() => setPage(current + 1)}>Next</button></div></footer>
    </>}
  </section>;
}
