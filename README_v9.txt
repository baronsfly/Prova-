PILOTLOG v10.2 — CORE v1
================================================

V9.9 UPDATE
-----------
- Reload opens Roster with the calendar first and only one month control.
- An optional personal photo replaces the round PilotLog mark; the logo remains when no photo is loaded.
- Payroll Result shows the authoritative DHM amount beside its conversion currency.
- Aircraft experience is grouped by ICAO type and displays only recorded categories.
- Approach totals accept preserved LogTen approach rows and quantities, including VOR/DME.
- A corrected complete LogTen migration package can supplement the two approach rows found in the original SQLite archive without overwriting manually saved data.

BASE
----
Built directly from PilotLog v9.8. Database, fields, navigation, imports, exports and established business rules are unchanged except for the v9.9 changes listed above.

ARCHITECTURE
------------
1. PilotLog now has one authoritative operational IndexedDB database: pilotlog9-authoritative-data.
2. Every operational activity is stored once with one stable ID, its activity type and lifecycle state: PLANNED, OPEN or COMPLETED.
3. A planned Roster flight and its completed Logbook flight are the same record. Completing it changes the state of that record; it does not create a linked copy.
4. Roster and Logbook have no writable membership or visibility flags. They read the same activity record and differ only by functional view filters.
5. Trips, Expiry, settings, payroll configuration, FX data, drafts and the sync ledger are stored in the same authoritative database state.
6. Device/session credentials and safety backups remain separate from operational data and are not alternative authoritative sources.

V10.2 PERFORMANCE CORRECTION
----------------------------
- Core migration, flight reconciliation, Roster cleanup and the Data Integrity check use indexed identity buckets.
- Opening PilotLog or the Roster no longer compares every archived flight with every other flight.
- The activity identity, lifecycle and functional Roster/Logbook filters are unchanged.

CALCULATION ENGINE
------------------
- PilotLogEngine is the only calculation service used by the UI.
- Entry metrics, Credit Hours, duty sessions, operational monthly views, trip duty/layover, Payroll, Totals, Logbook statistics and Dashboard duty projections are produced centrally.
- Pages format and display engine projections; they do not own separate business-rule formulas.
- No v8.9 Credit Hours, Payroll, Training Sector, Simulator, Day OFF, layover, Trip, Expiry, currency or Totals formula was intentionally changed.

MIGRATION / COMPATIBILITY
-------------------------
- Existing v8.9 Full Backup JSON files are accepted and migrated in one operation.
- Legacy flights, roster sectors and duties are merged into unique activity records without losing their original IDs/source references.
- A v9.1 Full Backup contains the single authoritative database rather than separate module datasets.
- Existing cloud snapshots with the prior section layout are accepted and migrated before merge; new snapshots transport the one database in verified chunks.
- Weekly backup and recovery functions are retained as non-authoritative safety copies.

VERIFICATION WITH THE PROVIDED BACKUP
-------------------------------------
- 7,928 Logbook/activity entries preserved.
- 48 Roster sectors preserved.
- 17 duty records preserved.
- 168 Trips preserved.
- 36 Expiry records preserved.
- 7,960 unique operational activity records after consolidation.
- Zero duplicate activity IDs.
- Payroll compared with v8.9 across 270 populated months: zero differences.
- Totals compared with v8.9: zero differences.

VISUAL PRESERVATION
-------------------
- The established PilotLog interface remains unchanged outside the Roster calendar requested for v9.3.
- Roster uses the approved graphical month calendar: year selector, month strip, month swipe, selectable/deselectable days and the selected day's agenda below.
- Each Roster activity row is directly clickable; separate Edit/Open buttons are not used in that agenda.
- Payroll keeps its existing layout and restores the native month/year dropdown control without redesign.
- Service-worker bridges replace older offline caches on devices already running an earlier version.

FILES
-----
- index.html
- pilotlog-10.2.js
- pilotlog-10.2.css
- sw-10.2.js
- manifest.webmanifest
- README_v9.txt
- CHANGELOG.md


v9.1 RESTORE PERFORMANCE FIX
----------------------------
- Fixes a severe Trips rendering slowdown after restoring a large v8.9 backup.
- Trip operational entries are built once and reused while rendering the Trips list instead of rebuilding the full multi-year operational history for every saved trip.
- Added indexed trip-entry lookup for saved trip contents.
- No UI, payroll, credit-hour, roster, logbook, trip, expiry, sync, or business-rule formula was changed.


v9.2 UI PERFORMANCE FIX
-----------------------
- Logbook Credit display no longer rebuilds the complete 7,000+ entry archive for every visible row.
- Logbook statistics now group entries by date once, preserving the same Credit Hours rules while avoiding repeated full-database scans.
- Trips DOM is rendered only when the Trips page is opened, instead of being built invisibly during startup.
- Logbook anchor lookup no longer scans every rendered row.
- Logbook initially renders 400 entries at a time, with an explicit Load older entries control; search still runs against the full authoritative database and statistics still cover all matches.
- No data schema, business rule, Payroll formula, Credit Hours rule, Roster logic, Trips formula, Expiry logic or visual layout was changed.


v9.5 FLUID ROSTER SWIPE
-------------------------
- The Roster calendar now follows the finger continuously while swiping.
- Previous/current/next month panels slide with a 240 ms iOS-style snap animation.
- Short swipes snap back; distance and velocity can complete the month change.
- Vertical page scrolling remains available and accidental day selection after a swipe is suppressed.
- No database, calculation, entry, Payroll, Trips, Logbook, Expiry, import, export or sync logic was changed.


v9.4 ROSTER CALENDAR CACHE FIX
------------------------------
- Fixed the broken Roster layout on Safari/iPhone caused by reusing the old CSS filename.
- The versioned pilotlog-9.4.css forces browsers and service workers to load the approved calendar rules.
- No database, calculation, entry, Payroll, Trips, Logbook, Expiry, import, export or sync logic was changed.


v9.3 CHECKLIST UPDATE
---------------------
- Swipe right from Add Flight always returns to Logbook and saves the current draft first.
- Entry drafts remain in the authoritative local database while navigating through Roster, Payroll, Trips or any other page.
- Roster now uses the approved second graphical calendar with all months, year selection, swipe navigation, day selection/deselection and a detailed agenda below.
- Complete Roster flight/activity rows are clickable; separate action buttons were removed from the agenda.
- Trips cards, View Duties and Payroll read the same live Trip projection from PilotLogEngine; stored legacy layover values are not used as an independent calculation source.
- Completed Roster flights use their final saved Flight Entry duty fields; planned Roster times are used only until completion.
- Verified RBA 08/26 from the supplied backup: Trip 22:00, Duty 8:02 (482 minutes), Paid Layover 13:58 (838 minutes) in Trips, View Duties and Payroll.
- Payroll uses PilotLogEngine projections and its native month/year dropdown is visible again without changing the surrounding design.
