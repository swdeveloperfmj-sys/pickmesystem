import { test } from "node:test";
import assert from "node:assert/strict";
import { matchingApprovers, updateApproverSelection } from "../../Frontend/src/approvers.js";
import { assignedApproverAllowed } from "../src/access.js";

const person = (id, departments = ["d1"], companies = ["c1"], extra = {}) => ({ id, departmentIds: departments, companyIds: companies, departments, companies, status: "ACTIVE", isActive: true, role: "CUSTOM_test", sidebarAccess: ["APPROVALS"], ...extra });
const users = [person("a"), person("b"), person("c", ["d2"]), person("inactive", ["d1"], ["c1"], { status: "INACTIVE" }), person("other", ["d1"], ["c2"]), person("regular", ["d1"], ["c1"], { sidebarAccess: [] })];
test("approvers must match both company and department, be active, and not be the user", () => {
  assert.deepEqual(matchingApprovers(users, { departmentIds: ["d1"], companyIds: ["c1"] }, "a").map((u) => u.id), ["b"]);
  assert.deepEqual(matchingApprovers(users, { departmentIds: ["d1"], companyIds: [] }), []);
});
test("new matches default on, deselections survive, and obsolete matches are removed", () => {
  const initial = { departmentIds: ["d1"], companyIds: [], approverIds: [] };
  const selected = { ...initial, companyIds: ["c1"] };
  assert.deepEqual(updateApproverSelection(users, initial, selected), ["a", "b"]);
  const unchecked = { ...selected, approverIds: ["a"] };
  assert.deepEqual(updateApproverSelection(users, unchecked, { ...unchecked, departmentIds: ["d1", "d2"] }), ["a", "c"]);
  assert.deepEqual(updateApproverSelection(users, unchecked, { ...unchecked, companyIds: [] }), []);
});
test("request authorization respects deselected approvers, empty selection and changed assignments", () => {
  const user = { id: "requester", departments: ["d1"], companies: ["c1"], sidebarAccess: ["REQUESTS"], approvers: ["a"] };
  assert.equal(assignedApproverAllowed(user, users[0]), true);
  assert.equal(assignedApproverAllowed(user, users[1]), false);
  assert.equal(assignedApproverAllowed({ ...user, approvers: [] }, users[0]), false);
  assert.equal(assignedApproverAllowed({ ...user, approvers: undefined }, users[0]), false);
  assert.equal(assignedApproverAllowed({ ...user, sidebarAccess: ["APPROVALS"], approvers: [] }, users[0]), false);
  assert.equal(assignedApproverAllowed({ ...user, companies: ["c2"] }, users[0]), false);
});
