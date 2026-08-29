# PilotLog Changelog

## v5.0.0
- Major v5 baseline: persistent cloud-login email, uppercase operational fields, daily duty grouping, sector count, EASA FTL checks, editable DHD credit, independent Simulator Time/Credit, Trips, Roster, airport DB, automatic night time and delete confirmation.

## v5.0.1–v5.0.3
- Refinements to simulator totals, LogTen import, payroll and trips.
- Morocco scheduled-departure +50% credit introduced.

## v5.0.4
- DHD entry simplified to Date, From, To, Start, End and Credit Hours.

## v5.0.5
- Ground Course simplified to Date, IATA location, Course Type and Credit Hours.

## v5.0.6
- DHD excluded from paid-layover duty subtraction.
- Trip duty inspector added.

## v5.0.7
- Only DHD leaving Home Base can open an automatic trip.

## v5.0.8
- LogTen mapping: 7 STBY, 2 Ground Course, 3 Simulator, blank Flight, 1 transfer/DHD when supported.

## v5.0.9
- Re-import repairs previously misclassified non-flight LogTen rows.

## v5.0.10
- DHD removed from operational duty boundaries and totals.

## v5.0.11
- Monthly separators in Entries.
- Ground Course start time.
- Roster 3O/MAC deduplication and 3O display.
- Future payroll uses latest provisional EUR/MAD until rate lock.

## v5.0.12
- Emergency Entries rendering fix.

## v5.0.13
- Morocco night premium extended to return sector.
- Roster summary shows outbound destination.

## v5.0.14
- Emergency fix for undefined Morocco helper.

## v5.0.15
- Morocco premium evaluated in Add/Edit before save.

## v5.0.16
- Morocco premium changed to independent sector pairs.

## v5.0.17
- Simplified pair logic: Morocco outbound evaluates itself; immediate return inherits it.

## v5.0.18
- Dashboard simplified to Today + next 6 days Duty view.

## v5.0.19
- Fixed stale Upcoming Roster reference that interrupted rendering.
- Entries rendering isolated from Dashboard, FTL and Roster errors.
- Added five rolling automatic local snapshots of the flight database.
- Added DOM-reference integrity checks before release.
- Added chronological CHANGELOG.md.

## v5.0.20
- Fixed Dashboard “Duty — Today + next 6 days” showing “temporarily unavailable”.
- Root cause: `DUTIES_KEY` typo; the real storage key constant is `DUTY_KEY`.
- Entries remain isolated from Dashboard failures and no reimport is required.
- Added static pre-release validation for undefined `*_KEY` identifiers.

## v5.0.21
- Dashboard: split Today Duty from Next Duties (next 6 days).
- Dashboard: removed PIC, Flight Instruction and Total Duty counters.
- Dashboard: retained EASA FTL status immediately above EASA FTL rolling limits.
- Navigation: hid the standalone Duty menu while keeping duty data and calculations internal.
- Totals: removed EASA FTL and Duty Breakdown.
- Totals: vertical professional statistics now show Total Flight Hours, A320 Total Hours, A320 PIC, A320 SIC, A320 Instruction Flight Time and A320 Instruction Simulator Time.
- A320 recognition normalizes historical labels such as A320, A320-211-CFM, A32O and Airbus A320.
- Added EASA-style professional logbook print/PDF export independent from Payroll.
- Export selection supports Last 1/2/3/5 flight pages, custom date range and all flight pages.
- Flight pages use 18 entries and include Brought Forward, Page Total and Total To Date.
- DHD, STBY and Ground Course are excluded from professional flight-logbook pages.
- Simulator experience is available as an optional separate appendix.
- Added professional-experience CSV and full PilotLog JSON backup export.

## v5.0.22
- Redesigned EASA-style PDF using the supplied traditional EASA logbook layout as the structural reference.
- PDF is now A4 portrait.
- Each printed page is self-contained: logbook rows plus all three summary lines remain on the same physical page.
- Summary lines are Total From This Page, Total From Previous Pages and Total To Date.
- Zero values are rendered as blank cells instead of 0 or 0:00.
- Remarks and Endorsements are left aligned.
- FSTD/Simulator sessions are integrated into the same EASA-style page structure instead of a separate simulator appendix.
- DHD, STBY and Ground Course remain excluded because the professional logbook is independent from Payroll.
- Logbook dates are displayed as dd/mm/yyyy.
- Reduced entries per page to 11 to preserve portrait-page integrity and prevent totals from being pushed onto a new page.

## v5.1.0
- Major version increment after the Dashboard, Totals, professional logbook and import/export redesigns.
- Added Import from Screenshot in Settings.
- Screenshot OCR runs in the browser using Tesseract.js loaded on demand.
- Supported screenshot profiles: Auto, Roster, LogTen / logbook and Generic flight / duty.
- Added editable OCR text so recognition errors can be corrected without leaving PilotLog.
- Added Review Import table before any data are saved.
- Review fields include target, date, duty type, flight number, From, To, start/end time and remarks/course.
- Each detected row can be edited or excluded before import.
- Screenshot imports can create Entries, planned Roster sectors or internal Duty rows.
- Roster-style duty screenshots can generate a duty window separately from the detected flight sectors, preventing duty start/end times from being incorrectly used as sector times.
- Duplicate detection is applied during reviewed screenshot import.
- An automatic local flight-history snapshot is made before screenshot import.
- Date presentation in the main UI is now European dd/mm/yyyy while ISO YYYY-MM-DD remains the internal storage/ordering format.
- Updated visible dates in Dashboard duties, Entries, Roster, FTL daily rows, Duty records, Trips, Trip inspector and FX display.
- Existing protected Entries rendering, storage-key validation and DOM-ID pre-release checks remain in place.

## v5.1.1
- Replaced browser `window.print()` EASA export with direct generation of a real PDF file.
- Fixes iPhone/Safari print-preview scaling that made the otherwise-correct browser layout too small on the physical A4 page.
- PDF MediaBox is fixed to real A4 portrait dimensions (595.28 x 841.89 pt).
- EASA information is split into two linked stacked blocks per page for physical readability: Flight/Aircraft/Landings and Conditions/Pilot Function/FSTD/Remarks.
- Rows use matching line numbers across both blocks.
- Eight experience rows per page; page totals, previous-page totals and total-to-date remain on the same PDF page.
- Zero values stay blank and Remarks remain left aligned.
- PDF generation has no external JavaScript dependency and does not rely on browser print CSS.

## v5.1.2
- Totals: Aircraft Breakdown now shows only one consolidated A320 group.
- Historical A320 variants such as A320, A320-211-CFM, A32O and equivalent A320 labels are merged into the same A320 group.
- Roster: upcoming duties are visually separated by month.
- The current month and following month now have distinct month headings rather than one continuous list.
- Existing roster cards, sector counts, local times and destination logic are preserved.
- Retains the true fixed-size A4 PDF generator from v5.1.1.

## v5.1.3
- Fixed Roster month separator displaying `[object Promise]`.
- Root cause: `rosterMonthLabel()` had accidentally been declared `async`, while its result was interpolated synchronously.
- `rosterMonthLabel()` is now a synchronous formatter and returns the month/year string directly.
- Added pre-release guard to reject async month-label formatting in the Roster.

## v5.1.4
- Reworked Supabase Cloud Sync to remove the runtime dependency on loading `@supabase/supabase-js` from jsDelivr.
- Authentication and data sync now use Supabase HTTP APIs directly.
- Added a 10-second timeout to every cloud request, so status can no longer remain indefinitely on “Checking cloud connection…”.
- Cloud Status immediately reports “Not signed in” when no local session exists.
- Passwords remain non-persistent; only the remembered email and cloud session tokens are stored.
- Existing cloud data merge format is preserved.

## v5.1.5
- Fixed Cloud Sync creating duplicate flights when the same real-world flight existed on two devices with different internal PilotLog IDs.
- Cloud sync now performs semantic deduplication using date, duty type, route, normalized flight number and operational/scheduled times.
- Matched copies are merged, keeping the more complete record and filling missing fields from the other copy.
- Locked status is preserved if either copy was locked.
- Skeletal duplicates with no flight number/times are merged only when there is exactly one complete same-date/same-route candidate.
- Existing local duplicates are automatically cleaned on the next Cloud Sync.
- A local history snapshot is created before duplicate cleanup.
- Stale duplicate flight records are removed from Supabase after a successful merge so they do not return on another device.

## v5.1.6
- Flight entries now include PIC Name, SIC Name and SO Name (Second Officer).
- Crew-name fields are shown only for Flight entries.
- PIC/SIC/SO names are stored with each flight and restored when editing.
- Professional Experience CSV exports all three crew-name fields.
- EASA PDF populates the standard Name(s) PIC field from PIC Name.
- SIC and SO names are preserved in EASA Remarks/Endorsements when present.
- Added best-effort LogTen crew-name import aliases when those source fields exist.

## v5.1.7
- Added Instructor / Examiner Name to Flight entries.
- Corrected LogTen crew import using the actual TAB columns:
  - `flight_selectedCrewPIC` → PIC Name
  - `flight_selectedCrewSIC` → SIC Name
  - `flight_selectedCrewStudent` → SO Name
  - `flight_selectedCrewInstructor` → Instructor / Examiner Name
- When Role = Examiner, PilotLog displays a reminder to document the line-check/examiner role in Remarks.
- Instructor / Examiner Name is stored with the flight, restored during edit, included in Professional Experience CSV and preserved in EASA Remarks/Endorsements.

## v5.1.8
- Fixed another duplicate-entry case visible after updates/imports: identical skeletal Flight placeholders with the same date and route but no flight number or times are now merged.
- LogTen import now uses the same semantic operational matching as Cloud Sync before creating a new Flight entry.
- LogTen import prefers `sourceRowKey`, then operational identity, then a single unambiguous skeletal same-date/same-route placeholder.
- Existing entry + imported LogTen data are merged field-by-field rather than blindly overwriting the richer copy.
- Semantic duplicate cleanup now runs before every LogTen save.
- Existing duplicates are also cleaned once automatically when v5.1.8 first renders, with a local snapshot taken before cleanup.
- Repeated real sectors are preserved when flight numbers or times distinguish them.

## v5.1.9
- Added database-driven autocomplete for PIC Name, SIC Name, SO Name and Instructor / Examiner Name.
- Crew suggestions are built automatically from names already stored in PilotLog.
- Added Aircraft Type autocomplete using aircraft types already present in the PilotLog database.
- New Flight entries default to IFR = Yes.
- Added Return Flight button in Add Flight.
- Return Flight reverses From/To and increments the numeric flight number by one (for example MAC457 → MAC458).
- Return Flight preserves aircraft type, aircraft registration, role, PIC/SIC/SO/Instructor names, Instruction and IFR.
- If the outbound sector crosses midnight, the return flight date is advanced automatically by one day.
- Sector-specific times and calculated values remain blank for the new return sector.
- Return Flight uses the currently populated outbound form, or the most recent stored Flight if the form has no route.

## v5.2.0
- Add-entry form now persists locally while navigating; existing unlocked entries autosave edits.
- Removed redundant Save/Update Entry; final action is Lock/Unlock with 🔒/🔓.
- Lock keeps the screen on Add for review.
- Entries display 🔒 or 🔓 state.
- Added custom mobile autocomplete for crew names and Aircraft Type.
- Off Duty follows actual IN + 30 minutes; scheduled IN +30 is fallback only.
- Night time includes taxi-out and taxi-in when those portions occur at night.
- Added PF Yes/No. PF=Yes automatically credits one take-off and one landing in the correct Day/Night bucket.
- Added approach type and approach counts in Totals.
- Added Last 6 months to Periods.
- Corrected EASA ORO.FTL.205 Table 2 and added Maximum Daily FDP.
- Rebuilt EASA duty accumulation as operational duty sessions, including midnight crossing, to prevent inflated 7/14/28-day totals.
- Added offline PWA caching for core PilotLog files after first online load.

## v5.2.1
- Fixed EASA FTL rolling-duty totals incorrectly including future planned duties.
- Duty 7/14/28-day totals now include only duty sessions whose report time is at or before the current time.
- Removed legacy/manual Duty-table additions from rolling FTL totals to prevent double counting against reconstructed operational duty sessions.
- Flight-time 28-day, calendar-year and 12-calendar-month counters now explicitly exclude future-dated flight records.
- Maximum daily FDP no longer selects the farthest future duty. It shows today's duty when available, otherwise the nearest next planned FDP; accrued-limit status remains based on past/current duties only.
- Added a dashboard note clarifying that future roster duties are excluded from rolling limits.

## v5.2.2
- Replaced EASA rolling-duty calculation again, removing `buildDutySessions()` from 7/14/28-day duty totals.
- Rolling duty now uses the saved `totalDuty` value from the final entry of each operational duty — the same value displayed in Entries such as `Duty 9:35`.
- Multiple duplicated entries on the same duty no longer multiply duty hours; only one valid duty total is counted.
- If an old day has no saved `totalDuty`, PilotLog reconstructs that single day's duty from first report/start to final Off Duty, with Actual IN + 30 minutes taking priority.
- External/manual Duty records are added only when Entries do not already provide a duty for that date, preventing double counting.
- Future dates are excluded from accrued rolling-duty totals.
- Maximum/Next daily FDP now obtains future planned duties from Roster, never from future logbook Entries.
- Added safeguards rejecting impossible reconstructed duty values over 24 hours.

## v5.3.0
- Maintenance/refactor release with no intended changes to PilotLog rules, calculations, data format or cloud schema.
- Removed eight obsolete functions that had no runtime references after previous revisions.
- Added a concise source map to `app.js`.
- Added `/src` maintenance fragments grouped by Core, Flight, Duty/FTL, Roster/Trips, Imports, Exports, Payroll, Cloud and UI.
- Production still loads one `app.js`, avoiding runtime module/load-order regressions.
- Added `build_app.py` to rebuild the production `app.js` deterministically from the organized source fragments.
- Updated Service Worker cache/version registration to v5.3.0.

## v5.3.1
- Rebuilt the EASA duty engine from the operational sequence rather than stored/reconciled daily totals.
- Flight duty starts at scheduled OUT minus 60 minutes and ends at actual IN plus 30 minutes; scheduled IN plus 30 is used only until actual IN exists.
- Cross-midnight duties are handled with absolute UTC datetimes.
- Sectors are joined into one duty only when the operational gap is at most 5 hours and the resulting duty remains within a sanity ceiling of 18 hours; corrupt windows are ignored rather than inflating rolling totals.
- Rolling 7/14/28-day duty totals count only the portion actually accrued up to the current time; future duty minutes are excluded.
- Current/next daily FDP selects the earliest real duty from Entries and Roster instead of an arbitrary later future date.
- Reconciliation no longer changes every entry timestamp on each render; only entries whose derived duty metadata actually changes are stamped.
- Fixed stale-code updates on Safari/iPad: runtime CSS/JS/Service Worker now use version-specific filenames.
- New Service Worker uses network-first exact cache matching and deletes older PilotLog caches, eliminating the old `ignoreSearch` behavior that could keep serving an obsolete app.js after an update.

## v5.3.2
- Entries now opens at the current-day position instead of at the newest future entry.
- Chronology remains descending: future entries are above the anchor and past entries are below it.
- If today has entries, the anchor is placed immediately before today's first entry.
- If today has no entries, the anchor sits at the boundary between future and past.
- No data migration or database changes.

## v5.4.0
- Fixed the Add/Edit Credit Hours display for a return sector receiving the Morocco night +50% premium. The edit form now identifies the saved sector by ID/flight number, so its displayed credit matches Entries and Payroll.
- PIC time is now credited only when Entry Role = PIC. Instructor and Examiner roles no longer automatically populate PIC hours.
- Roster workflow now carries stable data from the previous saved sector in the same roster duty into the next sector: Aircraft ID, Aircraft Type, Role, PIC/SIC/SO/Instructor names, Instruction, IFR and Seat Position. PF automatically alternates Yes ↔ No.
- Roster matching now normalizes 3O/MAC flight-number formats to reduce duplicate/new-entry mismatches.
- Added user profile settings: Your name and Your role (Captain, First Officer, Senior Cabin Crew, Cabin Crew).
- Captain profile defaults new Flight entries to Role PIC and places the user's name in PIC Name. First Officer defaults to Role SIC and places the user's name in SIC Name. Crew-name fields remain editable.
- Header is personalized as `PilotLog of <Role> <Name>` and subtitle is `PilotLog — your personal LogBook`.
- Added Seat Position (Left / Right) to Flight entries, drafts, edits, return-flight copies and CSV exports.
- Totals now includes Flight Time — Left Seat and Flight Time — Right Seat.
- Added an explanatory note for Clear roster / Delete all entries. No alarm feature is included yet; native AlarmKit integration is intentionally deferred until PilotLog is packaged as a native iOS/iPadOS app.

## v5.4.1
- Fixed deleted records returning after Cloud Sync on another device.
- Added timestamped cloud deletion tombstones for Flights, Roster, Duties and Trips.
- Individual deletion now wins over older copies on other devices and is propagated at the next sync.
- Clear Roster and Delete All Entries use collection-level tombstones, suppressing all older cloud records in that collection, including records not currently present on the deleting device.
- Offline deletions are retained locally and synchronized later.
- Conflict resolution is last-operation-wins by timestamp; genuinely newer records created/edited after a deletion are allowed.

## v5.5.0
- Added Auto Sync for signed-in users, enabled by default and switchable in Settings.
- Auto Sync is debounced after entry saves/locks/edits, deletions, imports, roster/trip/settings/payroll changes, sign-in, connectivity return and app foregrounding. It also checks periodically while PilotLog is open.
- Added exactly one rotating weekly local backup stored in IndexedDB.
- Every 7 days, before the next eligible Cloud Sync, PilotLog writes a fresh snapshot to the same `weekly` slot, overwriting the previous backup.
- The first eligible sync creates the first backup.
- Backup contains Entries, Roster, Duties, Trips, Payroll settings/month data, FX, App Settings and cloud deletion tombstones.
- Passwords and Supabase session/access/refresh tokens are excluded.
- Settings displays the backup date/version and provides Backup now and Restore weekly backup.
- Restore replaces local working data and intentionally does not immediately auto-sync, allowing the restored state to be reviewed first.

## v5.5.1
- Fixed Roster being flight-only.
- Roster now displays Simulator, STBY, DHD and Ground Course activities from Entries in chronological order together with grouped flight duties.
- Standalone non-flight calendar duties stored only in Duties are also displayed when no equivalent Entry exists.
- DHD shows its route/flight number when available; Simulator and Ground Course show location/details.
- Entry-backed non-flight activities can be opened directly from the Roster page.
- EASA daily/next FDP selection now explicitly considers only duty sessions containing flight sectors; SIM/STBY/DHD/Ground Course remain duty activities but cannot be mistaken for an FDP.

## v5.6.0
- Reorganized the main navigation in the requested workflow order: Roster, Logbook, Payroll, Expiry, Trips, Dashboard, Settings.
- Renamed Entries to Logbook.
- Removed Add from the main navigation; Logbook now has a prominent `+ Add entry` button for Flight, Simulator, DHD, Ground Course and STBY entries.
- Dashboard and Totals are now presented as one combined Dashboard view while preserving the existing calculation/render functions internally.
- Added a dedicated Expiry section scaffold, intentionally separate from Settings, ready for licence/medical/visa/training validity tracking.
- Added lighter navigation/view transitions and a scrollable menu for a smoother interface without changing stored data.
- No database/storage migration is required.
