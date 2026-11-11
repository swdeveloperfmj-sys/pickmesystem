import React from "react";

const label = (value = "") => value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
const date = (value) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
function Icon({ type }) {
  const paths = {
    trip: "m5 10 2-6h10l2 6M4 10h16v9H4zM7 14h1m8 0h1M7 19v2m10-2v2",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
    details: "M9 4H5v17h14V4h-4M9 3h6v4H9zM8 11h8m-8 4h8",
    flag: "M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0",
    clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    check: "m5 12 4 4L19 6",
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type] || paths.details} /></svg>;
}
function Column({ title, icon, children }) {
  return <section className="ride-column"><h3><Icon type={icon} />{title}</h3>{children}</section>;
}
export default function RequestDetailsCard({ record, actions, children }) {
  const decision = ["REJECTED", "RETURNED"].includes(record.status) ? [...(record.history || [])].reverse().find((item) => item.action === (record.status === "REJECTED" ? "REJECT" : "RETURN")) : null;
  return <article className="ride-details-card" aria-label={`Request ${record.id}`}>
    <header className="ride-card-header"><h2><span className="ride-title-icon"><Icon type="trip" /></span>{record.service === "RIDE" ? "Ride" : "Delivery"} Request Details</h2><span className={`ride-status status-${record.status.toLowerCase()}`}><Icon type={ ["APPROVED", "BOOKED", "COMPLETED"].includes(record.status) ? "check" : "clock"} />{label(record.status)}</span></header>
    <div className="ride-card-grid">
      <Column title="Journey" icon="trip">
        <p className="ride-service">{label(record.service)} - {label(record.vehicle)}</p>
        <div className="ride-route"><div className="ride-stop pickup"><span>Pickup</span><strong>{record.pickup}</strong></div>{record.stopover && <div className="ride-stop stopover"><span>Stopover</span><strong>{record.stopover}</strong></div>}<div className="ride-stop destination"><span>Destination</span><strong>{record.destination}</strong></div></div>
      </Column>
      <Column title="Requester" icon="user">
        <div className="ride-person"><span className="ride-avatar"><Icon type="user" /></span><div><strong>{record.requesterDetails.fullName}</strong><p>{record.requesterDetails.designation}</p><p>{record.requesterDetails.contact}</p></div></div>
        {!!record.history?.length && <details className="ride-history"><summary>Activity History ({record.history.length})</summary><ol>{record.history.map((item, index) => <li key={index}><strong>{label(item.action)}</strong><p>{item.actorName} · {date(item.at)}</p>{item.note && <p>{item.note}</p>}</li>)}</ol></details>}
      </Column>
      <Column title="Request Details" icon="details"><dl className="ride-facts"><dt>Department</dt><dd>{record.requesterDetails.department || "—"}</dd>{record.requesterDetails.workLocation && <><dt>Work location</dt><dd>{record.requesterDetails.workLocation}</dd></>}<dt>Pickup date &amp; time</dt><dd>{date(record.pickupAt)}<small>(Sri Lanka)</small></dd><dt>{record.approvalSharedAt ? "Approved by" : "Assigned approvers"}</dt><dd>{record.approverDetails.approvedBy || record.approverDetails.fullName}{record.approverDetails.designation && <small>{record.approverDetails.designation}</small>}</dd></dl></Column>
      <Column title="Purpose" icon="flag"><p className="ride-caption">Official purpose / justification</p><div className="ride-inset">{record.purpose || record.justification}</div>{decision?.note && <div className="ride-decision"><strong>{record.status === "REJECTED" ? "Rejection" : "Return"} reason</strong><p>{decision.note}</p></div>}</Column>
      <Column title="Trip Information" icon="user"><div className="ride-inset">{record.service === "RIDE" ? <><h4>Passengers ({record.passengers.length})</h4><ul className="ride-passengers">{record.passengers.map((person, index) => <li key={index}>{person.name}{person.designation && ` (${person.designation})`}</li>)}</ul></> : <><h4>Receiver</h4><p>{record.receiverName}</p><p>{record.receiverContact}</p><p>{record.itemDetails}</p></>}</div>{(record.bookingReference || record.bookingAmount != null) && <div className="ride-inset ride-booking">{record.bookingReference && <p><strong>PickMe reference</strong><br />{record.bookingReference}</p>}{record.bookingAmount != null && <p><strong>Booking amount</strong><br />{new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(record.bookingAmount)}</p>}</div>}</Column>
      <Column title="Actions" icon="details"><div className="ride-actions">{actions}</div></Column>
    </div>
    {children && <div className="ride-action-form">{children}</div>}
  </article>;
}
