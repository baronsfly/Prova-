PILOTLOG v8.5.1 — FX INTEGRITY HOTFIX
=========================================================


HOTFIX v8.5.1
-------------
- Fixes the central snapshot download stopping on the non-authoritative FX cache section.
- If only the FX cache digest is inconsistent, PilotLog discards that cache and rebuilds EUR/MAD locally instead of blocking verified Logbook/Roster data.
- Integrity failures in flights, roster, duties, trips, expiry, sync ledger, payroll settings/month data and app settings remain blocking exactly as before.
- No sync protocol, record IDs, ledger/tombstone rules, merge rules, cloud revision logic or business calculations were changed.

BASE
----
Built directly from PilotLog v8.4.3. Existing storage keys, verified db8 cloud-generation protocol, import/export formats and the established v8.4.3 UI are preserved unless required by the eight-point update below.

EIGHT-POINT UPDATE
------------------
1. Roster activities now open the correct activity workflow instead of the old generic Roster editor.
2. Locked non-flight Roster activities can be edited directly from Roster and remain locked after save; normal locked Logbook protection remains in place.
3. Ground Training / Ground Course / GRT are normalized to one Ground Course activity type and one rule path.
4. DHD and DHP use dedicated reduced field layouts: DHD Credit is always 0; DHP Credit remains individually editable.
5. Simulator uses its dedicated layout with Simulator Time calculated separately from Simulator Credit; Simulator Credit is read from Settings.
6. Totals keep Flight Time and Simulator Time separate. Simulator time cannot increase Flight, A320 Flight, PIC or SIC totals; simulator instruction remains separate.
7. Sync now includes a permanent per-record change ledger for edit/create/lock/unlock/completion/delete events and collection tombstones. The ledger is included in verified cloud snapshots and v8.5 backups so deletions can be respected across devices and later imports.
8. Activity classification, Credit Hours, trip charging and Flight-vs-Simulator totals now consume one central rule source. Modules render/consume the calculated results instead of maintaining parallel business-rule copies.

CENTRAL CALCULATION RULES
-------------------------
- Flight Credit Hours: Schedule OUT -> Schedule IN only; round upward to the next 30 minutes; then apply the existing Morocco +50% night premium when applicable. Actual OUT/IN never determines Flight Credit Hours.
- DHD Credit: always 0.
- DHP Credit: editable per activity.
- Ground Course Credit: Settings value.
- Simulator Credit: Settings value.
- Ground Course trip duty subtraction remains fixed at 5:00.
- Simulator actual time is independent from Flight Time.

SYNC SAFETY
-----------
The existing verified-generation db8 publish/download protocol is retained. When another device has advanced the central revision while this device also has local changes, v8.5.1 retains the v8.5.0 record-revision merge and plus the permanent ledger before publishing the next verified generation. Collection-wide maintenance events do not cancel specific delete tombstones.

FILES
-----
- index.html
- pilotlog-8.5.1.js
- pilotlog-8.3.0.css
- sw-8.5.1.js
- manifest.webmanifest
- README_v8.txt
- CHANGELOG.md
