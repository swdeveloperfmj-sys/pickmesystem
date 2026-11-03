export const factoryRequesters = ["Production Executive", "Quality Assurance Executive", "Engineering Executive", "D&D Executive", "HR Executive"];
export const officeRequesters = ["Accounts Executive", "Sales Coordinator", "Senior Audit Associate"];
export const approverDesignations = ["Sales Manager", "Finance Manager", "Head of HR", "Operations Manager", "Factory Manager", "Engineering Manager", "Quality Assurance Manager", "Executive Assistant to the Director"];
export const designations = [...factoryRequesters, ...officeRequesters, ...approverDesignations, "Administrative Assistant"];
export const sopConfig = {
  designations,
  locationTypes: ["FACTORY", "HEAD_OFFICE", "SHOWROOM"],
  categories: ["EXECUTIVE_OR_BELOW", "MANAGER"],
  vehicles: ["MOTORBIKE", "THREE_WHEELER", "CAR"],
  minimumNoticeMinutes: 30,
  documentStatus: "For management approval",
};
// Request details are collected per trip; only assigned account roles grant workflow authority.
export const canRequest = (user) => Boolean(user.role && user.role !== "SUPER_ADMIN");
export const canApprove = (user) => ["MANAGER", "ADMIN"].includes(user.role);
export const canBook = (user) => user.role === "OPERATOR";
export const transportPermissions = (user) => ({
  request: canRequest(user), approve: canApprove(user), book: canBook(user),
  monitor: user.role === "SUPER_ADMIN",
});
export function eligibleVehicles({ service, category, passengers, deliveryRoute, groupCarEligible }) {
  if (service === "FLASH" && ["BETWEEN_FACTORIES", "CUSTOMER_DELIVERY"].includes(deliveryRoute)) return ["MOTORBIKE"];
  if (category === "MANAGER" || (service === "RIDE" && passengers.length >= 3 && groupCarEligible)) return ["THREE_WHEELER", "CAR"];
  return ["THREE_WHEELER"];
}
