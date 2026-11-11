export const staffModules = ["DASHBOARD", "REQUESTS", "APPROVALS", "BOOKINGS", "REPORTS", "HISTORY"];
export function defaultAccess(role) {
  return ["DASHBOARD", "REQUESTS", ...(["MANAGER", "ADMIN"].includes(role) ? ["APPROVALS"] : []), ...(role === "OPERATOR" ? ["BOOKINGS"] : [])];
}
export const sidebarAccess = (user) => user.role === "SUPER_ADMIN" ? [] : user.sidebarAccess ?? defaultAccess(user.role);
export const hasAccess = (user, module) => sidebarAccess(user).includes(module);
export function matchesApprover(approver, departmentIds, companyIds, userId) {
  const departments = approver.departments?.length ? approver.departments : approver.department ? [approver.department] : [];
  const companies = approver.companies?.length ? approver.companies : approver.company ? [approver.company] : [];
  return approver.id !== userId && approver.role !== "SUPER_ADMIN" && approver.isActive && approver.status === "ACTIVE" &&
    hasAccess(approver, "APPROVALS") && departments.some((id) => departmentIds.includes(String(id))) && companies.some((id) => companyIds.includes(String(id)));
}
export function assignedApproverAllowed(user, approver) {
  if (user.approvers === undefined || hasAccess(user, "APPROVALS") || user.role === "SUPER_ADMIN") return true;
  return user.approvers.some((id) => String(id) === approver.id) && matchesApprover(approver,
    (user.departments?.length ? user.departments : user.department ? [user.department] : []).map(String),
    (user.companies?.length ? user.companies : user.company ? [user.company] : []).map(String), user.id);
}
