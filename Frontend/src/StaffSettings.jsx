import React from "react";

export default function StaffSettings({ Icon }) {
  return <section className="page-enter" aria-labelledby="staff-settings-title">
    <div className="page-heading"><h1 id="staff-settings-title">Settings</h1><p className="muted">Set up your browser for PickMe bookings.</p></div>
    <div className="staff-support-grid">
      <section className="staff-guidelines" aria-label="PickMe booking extension">
          <span className="staff-support-icon"><Icon type="trip" /></span>
          <div className="staff-support-copy">
            <div className="staff-support-title"><h2>PickMe booking extension</h2></div>
            <p>Download the Chrome extension to fill approved ride details in PickMe.</p>
            <details><summary>How to install</summary><ol>
              <li>Download and extract the ZIP into a folder you will keep.</li>
              <li>Open <code>chrome://extensions</code> in Chrome and turn on Developer mode.</li>
              <li>Click Load unpacked and select the extracted folder containing <code>manifest.json</code>.</li>
              <li>Refresh CTMS, sign in to PickMe in the same Chrome profile, then click Book.</li>
            </ol><p>Review locations, vehicle and pickup time in PickMe before booking. This version supports CTMS on localhost or 127.0.0.1, port 5173.</p></details>
          </div>
          <a className="secondary extension-download" href={`${import.meta.env.BASE_URL}downloads/ctms-pickme-booking.zip`} download="ctms-pickme-booking.zip">Download extension ZIP</a>
        </section>
    </div>
  </section>;
}
