import React, { useEffect, useState } from "react";
import { staffModules } from "./access";
import usePendingApprovals from "./usePendingApprovals";

export default function StaffSidebar({ user, Brand, section, onSelect, onLogout, Icon, collapsed, setCollapsed }) {
  const [open, setOpen] = useState(false);
  const pendingApprovals = usePendingApprovals(user);
  useEffect(() => {
    if (!open) return;
    const escape = (event) => { if (event.key === "Escape") { setOpen(false); document.querySelector(".menu-toggle")?.focus(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return <>
    <aside className="sidebar">
      <div className="sidebar-heading">
        <Brand onLogoClick={collapsed ? () => setCollapsed(false) : undefined} />
        <button type="button" className="sidebar-toggle" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded={!collapsed} aria-controls="staff-navigation" onClick={() => setCollapsed(true)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m7-11-3 3 3 3" /></svg></button>
        <button type="button" className="menu-toggle" aria-label="Navigation menu" aria-expanded={open} aria-controls="staff-navigation" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      </div>
      <div className={`sidebar-menu${open ? " is-open" : ""}`} id="staff-navigation">
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav aria-label="Staff workspace">{staffModules.filter((module) => user.sidebarAccess.includes(module.key)).map((module) => {
          const pending = module.key === "APPROVALS" ? pendingApprovals : 0;
          const accessibleTitle = pending ? `${module.title}, ${pending} pending ${pending === 1 ? "request" : "requests"}` : module.title;
          return <button key={module.key} type="button" title={accessibleTitle} aria-label={accessibleTitle} aria-current={section === module.key ? "page" : undefined} className={`${section === module.key ? "active" : ""}${pending ? " has-pending-approvals" : ""}`} onClick={() => { onSelect(module.key); setCollapsed(false); setOpen(false); }}><span aria-hidden="true"><Icon type={module.icon} size={19} /></span><span className="nav-text">{module.title}</span>{pending > 0 && <span className="approval-notification" aria-hidden="true">{pending > 99 ? "99+" : pending}</span>}</button>;
        })}</nav>
        <div className="sidebar-bottom"><span className="avatar">{user.fullName[0]}</span><div><strong>{user.fullName}</strong><small>Staff workspace</small></div><button type="button" title="Logout" aria-label="Log out of workspace" onClick={onLogout}><Icon type="logout" size={18} /></button></div>
      </div>
    </aside>
    {open && <button type="button" className="menu-backdrop" aria-label="Close navigation menu" onClick={() => setOpen(false)} />}
  </>;
}
