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
            <p><strong>Important:</strong> Chrome cannot install the ZIP directly. Extract it first.</p>
            <details open><summary>Install in Chrome</summary><ol>
              <li>Download the ZIP, right-click it, and choose <strong>Extract All</strong> into a folder you will keep.</li>
              <li>Open <code>chrome://extensions</code> in Chrome and turn on Developer mode.</li>
              <li>Click <strong>Load unpacked</strong>. In the folder picker, select the extracted extension folder and click <strong>Select Folder</strong>. The picker only shows folders, so you will not see <code>manifest.json</code> there; do not select the ZIP file.</li>
              <li>Confirm <strong>CTMS PickMe Booking Helper</strong> appears in the extensions list, then refresh CTMS.</li>
              <li>Sign in to PickMe in the same Chrome profile, then click Book on an approved Ride request.</li>
            </ol><p>To show the extension button in Chrome's toolbar, open the Extensions menu and pin CTMS PickMe Booking Helper. Review locations, vehicle and pickup time in PickMe before booking. This version supports CTMS on localhost or 127.0.0.1, port 5173.</p></details>
          </div>
          <a className="secondary extension-download" href={`${import.meta.env.BASE_URL}downloads/ctms-pickme-booking.zip`} download="ctms-pickme-booking.zip">Download extension ZIP</a>
        </section>
    </div>
  </section>;
}
