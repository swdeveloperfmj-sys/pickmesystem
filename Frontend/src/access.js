export const staffModules = [
  { key: "DASHBOARD", title: "Dashboard", icon: "trip", description: "View personal transport totals and guidelines" },
  { key: "REQUESTS", title: "Transport Requests", icon: "route", description: "Create and manage own transport requests" },
  { key: "APPROVALS", title: "Approval Management", icon: "check", description: "Approve, reject or return requests assigned to this user" },
  { key: "BOOKINGS", title: "Booking Management", icon: "trip", description: "View all requests and record or manage PickMe bookings" },
  { key: "REPORTS", title: "Reports", icon: "book", description: "View a summary of requests this user can access" },
  { key: "HISTORY", title: "Request History", icon: "clock", description: "View activity on requests this user can access" },
];
export const defaultAccess = (role) => ["DASHBOARD", "REQUESTS", ...(["MANAGER", "ADMIN"].includes(role) ? ["APPROVALS"] : []), ...(role === "OPERATOR" ? ["BOOKINGS"] : [])];

// Booking setup follows booking access; it is not a separate workflow permission.
export const staffNavigation = (user) => [
  ...staffModules.filter((module) => user.sidebarAccess.includes(module.key)),
  ...(user.sidebarAccess.includes("BOOKINGS") ? [{ key: "SETTINGS", title: "Settings", icon: "settings" }] : []),
];
