# CTMS PickMe Booking Helper

## Install in Chrome

Download **Download extension ZIP** from CTMS **Settings** (available to users with Booking Management access) and extract it into a permanent folder first.

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing manifest.json. Developers can select `C:\dev\pickmeReq\extensions\pickme-booking` directly.
4. Refresh the CTMS tab at `http://127.0.0.1:5173` or `http://localhost:5173`.
5. Sign in to PickMe Business in the same Chrome profile.
6. In CTMS Booking Management, click **Book** on an approved Ride request.

The extension opens a separate PickMe tab for each request and attempts to enter phone, passenger name, pickup, destination and an exactly matching department. A helper panel shows all trip details and offers individual Fill/Copy controls. If login redirects away from the booking screen, return to `https://business.pickme.lk/booknow/rides` in that same tab.

Select the correct address suggestions to resolve the map locations. Check the passenger name after phone lookup, select the vehicle and add any stopover. Set the requested pickup time using PickMe's scheduling control; the extension does not schedule or select a vehicle automatically. Review everything and click **BOOK NOW** yourself. Return to CTMS to enter the amount/reference and confirm the booking.

## Current limits

- Ride only. Flash remains manual.
- Live authenticated PickMe testing is still required. Selectors use visible labels/placeholders from the supplied screenshot, with common name/id fallbacks. PickMe may lock fields or change its markup. Entered address text does not mean a map location has been selected.
- The extension never clicks BOOK NOW or updates the CTMS booking status.
- If a value cannot be filled, use the panel's Copy controls. Retry filling after phone lookup unlocks the name.
- Only local CTMS on port 5173 is allowed. For deployment, explicitly add the exact HTTPS origin to `background.js`, `bridge.js`, and the CTMS content-script matches in `manifest.json`. Do not use a wildcard for all websites.
- Reload the extension and refresh CTMS/PickMe tabs after changing extension files.

## Data handling

Only the selected passenger/route details are transferred. Credentials and cookies are not read. No personal data is put into URLs. Details are isolated by PickMe tab in extension session storage, unavailable to unrelated tabs, and removed when the tab closes or **Close & clear** is clicked. Reads expire after 30 minutes; browser session storage also clears on browser restart. No external analytics or server is used.

## Checks

Run `node --test extensions/pickme-booking/background.test.cjs` from the repository root.
Run `npm run build` in Frontend.

After installation, test a Ride with a known pickup/drop-off without submitting BOOK NOW: verify the phone/name, resolve both map locations, check the helper's schedule and passenger count, and open a second request to check that the tabs keep separate details.

Chrome references: [message passing](https://developer.chrome.com/docs/extensions/reference/api/runtime), [session storage](https://developer.chrome.com/docs/extensions/reference/api/storage).
