# PickMe SOP implementation reference

Source: `C:/Users/sabry/Downloads/PickMe SOP Simplified.pdf`, four pages, headed FMJ Holdings / Corporate Transport. The source is labelled "For management approval"; it does not establish that management has already approved it.

## Current implementation requested by the user

The user explicitly removed the account-level **Transport profile (SOP)** on 3 November 2026. The document rules below are source context; they do not override this later instruction.

- Active staff accounts submit their own requests without a preconfigured designation or location, including accounts without an assigned department.
- Each request collects designation, contact, an existing department, work location and approver designation. Requester and approver names come from their selected accounts. These are historical request snapshots, not account profile updates.
- Manager and Admin accounts may approve requests assigned to them. Operator accounts perform Administrative Assistant booking actions. Custom role names and typed designations do not grant approval or booking permissions.
- The requester name remains bound to the signed-in account. Ride passenger counts must match the passenger list; Flash requires receiver name/contact and item/sample details.
- SOP acknowledgement, official-purpose confirmations, notice periods, vehicle rules, version checks and external WhatsApp/PickMe confirmations remain in place. Manager vehicle eligibility follows the trusted Manager/Admin account role.

## Business rules from the document

- Official employee travel and item/sample deliveries only. Personal travel, including commuting, is prohibited.
- Requests must be submitted by the requester, not by another employee.
- Authorized requester designations at factories: Production Executive, Quality Assurance Executive, Engineering Executive, D&D Executive, HR Executive.
- Authorized requester designations at Head Office: Accounts Executive, Sales Coordinator, Senior Audit Associate.
- Authorized approvers: Sales Manager, Finance Manager, Head of HR, Operations Manager, Factory Manager, Engineering Manager, Quality Assurance Manager, Executive Assistant to the Director.
- Both request and approval must be shared at least 30 minutes before pickup.
- Administrative Assistant checks completeness and approval, returns incomplete/unapproved requests for correction, and records the external PickMe booking.
- Requester coordinates with the driver, verifies pickup/route/destination, tracks completion, and reports delays, changes and cancellations immediately.
- HR explains the SOP to recruits and keeps acknowledgement in their personal file.

## Annexure B and C

- Ride is for passengers; Flash is for item/sample delivery.
- Motorbike applies to inter-factory/customer item or sample deliveries.
- Otherwise executives and below use a three-wheeler; managers may use a car or three-wheeler.
- Three or more executives/below travelling together may use a car with approval.
- Every request includes requester name/designation/contact, department/location, approver name/designation, pickup date/time/location, optional stopover, destination, vehicle, official purpose and justification.
- Ride additionally includes passenger names/designations and passenger count.
- Flash additionally includes receiver name/contact and item/sample details.

## Integration boundaries

- Preserve the existing Super Administrator setup, user/role/department management, themes and responsive navigation.
- Do not send WhatsApp messages or create/amend/cancel a real PickMe booking automatically. No service credentials, API contract or explicit instruction to send messages has been supplied.
- Prepared WhatsApp text and staff-recorded external references are appropriate; distinguish these from verified integration events.
- The source does not list showroom requester designations; the user's later instruction replaces account-level Annexure A request gating with per-request information.
- Custom role labels alone must not grant Super Administrator access.
