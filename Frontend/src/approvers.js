import { defaultAccess } from "./access.js";

export function matchingApprovers(users, form, userId) {
  return users.filter((user) => user.id !== userId && user.status === "ACTIVE" &&
    (user.sidebarAccess ?? defaultAccess(user.role)).includes("APPROVALS") &&
    (user.departmentIds || (user.departmentId ? [user.departmentId] : [])).some((id) => form.departmentIds.includes(id)) &&
    (user.companyIds || (user.companyId ? [user.companyId] : [])).some((id) => form.companyIds.includes(id)));
}

export function updateApproverSelection(users, previous, next, userId) {
  const previousMatches = new Set(matchingApprovers(users, previous, userId).map((user) => user.id));
  return matchingApprovers(users, next, userId)
    .filter((user) => previous.approverIds.includes(user.id) || !previousMatches.has(user.id))
    .map((user) => user.id);
}
