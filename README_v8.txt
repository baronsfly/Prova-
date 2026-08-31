PilotLog v8.2.0
================

PURPOSE
-------
PilotLog v8.2.0 is a reliability release for rebuilding a large LogTen archive and then publishing it safely to the PilotLog central database.

LOCAL-FIRST REBUILD
-------------------
Large imports do not start Cloud Sync.

Recommended clean rebuild:
1. Sign in to PilotLog Cloud.
2. Use “Erase Old Database • Start Clean” once if the previous central database must be discarded.
3. Import the complete LogTen migration package.
4. PilotLog stores and verifies the normalized LogTen records locally first. The original SQLite database remains archived locally and is never sent to cloud.
5. Import the AeroLINE JSON files, also locally only.
6. Review Logbook, Roster, Expiry and Trips.
7. Press “Sync now” only when the local database is correct.

Fresh/reset devices start with Auto Sync disabled. Any bulk import (complete LogTen, LogTen Tab, AeroLINE JSON/direct import, Calendar or Roster CSV) also disables Auto Sync and leaves the data local until Sync now is pressed.

VERIFIED CLOUD GENERATIONS
--------------------------
v8.2 uses cloud protocol db8.

A cloud publish no longer deletes the active central database first. PilotLog:
1. builds a complete local snapshot,
2. uploads it into a new staging generation,
3. verifies that every expected cloud chunk exists,
4. activates the new generation only after verification,
5. then removes the previous generation when possible.

If an upload is interrupted, the previous verified central generation remains active. A second device downloads only the active verified generation and checks section counts/digests before replacing its local copy.

The first Sync now after a clean local rebuild asks for confirmation before creating the new central database.

LARGE LOGTEN ARCHIVES
---------------------
The complete LogTen migration is written to IndexedDB and verified locally before success is reported. Stable LogTen unique IDs are checked after the import. The expensive semantic duplicate pass is skipped for large complete LogTen archives that already carry stable source IDs, avoiding the O(n²) browser stall seen during large rebuilds.

The reference migration package used during this release contains 7,916 LogTen rows (30/03/1998–26/08/2026), 19 licences/validities and 164 trips.

ROSTER / LOGBOOK
----------------
- Roster remains the planning/payroll source.
- Logbook remains the completed operational record.
- Future AeroLINE simulator sessions stay in Roster/planning and do not appear in Logbook or simulator totals/experience exports until their scheduled simulator end time has passed.
- Completed flights remain linked to their Roster sectors.

DAY OFF PAID ASSIST
-------------------
AeroLINE “Thanks” memos are retained as a possible Day Off Paid signal on flight days. If PilotLog also remembers an earlier OFF for that date, the signal is strengthened to “OFF replaced by flight + Thanks memo”.

PilotLog does not silently mark Day Off Paid. When the linked roster flight is saved/locked into Logbook and “Called to work from a scheduled day off” is still unticked, PilotLog shows a confirmation popup. The user remains the final authority.

ADDITIONAL DEVICES
------------------
A newly reset additional device no longer relies on a device-local “database initialized” flag to decide whether the central database exists. After sign-in, Sync now checks the active db8 cloud metadata directly and downloads the verified central generation when available.

FILES
-----
- index.html
- pilotlog-8.2.0.js
- pilotlog-8.2.0.css
- sw-8.2.0.js
- manifest.webmanifest
- README_v8.txt
- CHANGELOG.md
