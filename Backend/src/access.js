export const staffModules = ["DASHBOARD", "REQUESTS", "APPROVALS", "BOOKINGS", "REPORTS", "HISTORY"];
export function defaultAccess(role) {
  return ["DASHBOARD", "REQUESTS", ...(["MANAGER", "ADMIN"].includes(role) ? ["APPROVALS"] : []), ...(role === "OPERATOR" ? ["BOOKINGS"] : [])];
}
export const sidebarAccess = (user) => user.role === "SUPER_ADMIN" ? [] : user.sidebarAccess ?? defaultAccess(user.role);
export const hasAccess = (user, module) => sidebarAccess(user).includes(module);
