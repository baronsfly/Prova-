PILOTLOG v9.0 — SINGLE AUTHORITATIVE OPERATIONAL DATABASE
=========================================================

BASE
----
Built directly from PilotLog v8.9. The established UI, calculations, AeroLINE import, LogTen migration, Expiry, Payroll, Trips, Totals and db8 cloud safety/ledger logic are preserved unless a change was required to make the operational data model single-source.

CORE ARCHITECTURE
-----------------
PilotLog v9.0 uses one authoritative IndexedDB database for operational data:

  pilotlog9-operational-data

Inside that one database:
- `activities` stores operational activities once, by unique `id`.
- `trips` stores Trip grouping/payment metadata and references the same activity IDs.

Every operational activity has a canonical `activityType`, including:
- FLIGHT
- SIM
- DHD
- DHP
- STBY
- GROUND
- DAY_OFF / DUTY where applicable to roster-duty records.

Roster, Logbook and Duty are no longer independently persisted operational databases. They are compatibility projections/views over the same in-memory authoritative operational state.

LOGBOOK
-------
Logbook is a filtered view of the central activity data. It displays only:
- completed FLIGHT activities;
- completed SIM activities.

Ground Course, DHD, DHP, STBY and other roster-only operational activities remain available to the modules that need them but are not rendered as Logbook rows.

ROSTER → LOGBOOK WITHOUT COPYING THE FLIGHT
-------------------------------------------
A planned Roster flight exists once in the central activity store.
When that flight is completed from Roster, PilotLog reuses the same activity `id` and adds the final saved operational/logbook values to that record. It does not create a second Logbook copy.

Therefore the same authoritative activity drives:
- Roster status;
- Logbook display;
- Payroll calculations;
- Totals;
- Trip inclusion/grouping;
- downstream duty/calculation logic.

The final value saved by the user in the activity remains authoritative. Imported/AeroLINE values can prefill defaults but do not create a second authoritative copy.

PERFORMANCE / STORAGE
---------------------
The central IndexedDB stores activities as individual keyed records rather than rewriting one giant database blob. Normal persistence compares record signatures and writes/deletes only changed activity/trip records.

Indexes are created for activity type, date, Logbook visibility and Roster-sector membership. The application keeps one operational cache in memory and modules filter/project from that cache instead of loading separate copies.

MIGRATION FROM v8.9
-------------------
Migration is automatic on first v9.0 launch:
1. Read existing v8.x Logbook/activity IndexedDB plus Roster, Duty and Trip data.
2. Match a Roster sector to its already completed Logbook flight using existing links, AeroLINE identity and semantic flight/date/route identity.
3. Merge the matched pair into one authoritative activity record.
4. Preserve planned Roster sectors as central activities that are not yet Logbook-visible.
5. Write the new v9 operational database.
6. Only after the new database write succeeds, remove the obsolete local operational stores/keys.

If IndexedDB is temporarily unavailable, PilotLog uses one single operational fallback object in localStorage and does not split data back into multiple operational stores.

BACKUP / RESTORE
----------------
New Full Backup and Weekly Backup payloads store a single `operational` section rather than separate Flight/Roster/Duty/Trip copies.

Restore remains backward-compatible with v8.x backups: old `flights`, `roster`, `duties` and `trips` sections are consolidated into the v9 operational model during restore.

CLOUD SYNC
----------
The verified db8 Supabase protocol is intentionally retained in v9.0 for multi-device safety and rollback compatibility. During cloud transport only, PilotLog exposes temporary compatibility projections (`flights`, `roster`, `duties`, `trips`). These are generated from the one authoritative local operational database and are consolidated back to one activity model when downloaded.

This transport compatibility is not a second local database and does not change which record is authoritative inside PilotLog.

FILES
-----
- index.html
- pilotlog-9.0.js
- pilotlog-8.3.0.css
- sw-9.0.js
- manifest.webmanifest
- README_v9.txt
- CHANGELOG.md
