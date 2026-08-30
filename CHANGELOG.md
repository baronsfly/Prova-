# PilotLog v6.0.7

- Added canonical source-backed identity engine: deterministic 128-bit IDs for AeroLINE/LogTen records and cryptographic UUIDs for manual records.
- Added Sync Protocol v3 namespace so a clean database cannot ingest stale rows written by v6.0.6 or older clients.
- Added Deep Reset • Cloud + This Device with double confirmation. It hard-deletes the signed-in user cloud rows first, then clears PilotLog localStorage/sessionStorage, IndexedDB databases, LogTen archive, weekly recovery backup and PilotLog caches.
- Added clean-start guard: v6.0.7 will not run Cloud Sync until a v6.0.7 reset has explicitly initialized the new sync generation.
- Added Reset This Device Only for additional devices after the master/cloud reset.
- Deep Reset fails safe: local data are not wiped if cloud deletion fails.
- Kept visual CSS unchanged from v6.0.6.

# PilotLog v6.0.6

- Added read-only Source in entry detail/editor only (not in Logbook list).
- Added AeroLINE Roster ↔ Logbook integrity check using date + flight number + route.
- Logbook-only manual/simulator/other-company activities are not treated as discrepancies.
- New entries created from an AeroLINE roster sector retain `source: aeroline`.
- No visual changes to the Logbook list.

# PilotLog Changelog

## v6.0.5 — Cloud Sync transport hardening
- Replaced the fixed 10-second Supabase timeout with operation-appropriate limits.
- Added retry with short backoff only for transient failures (timeout, network failure, HTTP 429 and HTTP 5xx).
- Added deterministic paginated cloud download (500 rows/page) to prevent silent truncation on large datasets.
- Added chunked cloud upload (100 records/request) with 60-second request timeout.
- Added clearer distinction between Supabase timeout and network reachability errors.
- Added visible upload progress during manual and automatic sync.
- Preserved v6.0.4 Sync Engine v2 remove-wins deletion semantics and all existing UI/features.

## v6.0.4 — Sync Engine v2 / remove-wins deletion
- Deletions are now durable remove-wins tombstones: an old or later-edited replica cannot silently resurrect a deleted entry.
- User deletions of AeroLINE/LogTen-backed entries also store their external source identity, preventing the same imported record from being recreated under a different local ID.
- AeroLINE imports use deterministic IDs for newly imported roster sectors, activities and OFF duties while preserving IDs of existing matched records.
- AeroLINE and complete LogTen imports respect persistent deletion tombstones.
- Semantic duplicate cleanup now tombstones discarded IDs instead of hard-deleting cloud rows, preventing stale offline devices from re-uploading them.
- Record revisions (_syncRev) are monotonic on stamped edits/import updates and are used before timestamps when resolving active-record conflicts.
- Manual Sync now and Auto Sync are unchanged.
- UI/layout remain unchanged from v6.0.3.


## v6.0.3 — Body & under-the-hood consolidation
- Restored the complete v5.11.0 visual stylesheet and navigation feel. No redesign.
- Kept all AeroLINE Connect controls for the future native-app path, plus manual JSON import fallback.
- Kept the v6 IndexedDB flight store so the complete LogTen archive no longer depends on localStorage quota.
- Improved responsiveness with lazy Logbook and Roster DOM rendering: large views are built only when opened.
- Avoided repeating the expensive semantic duplicate scan on every version upgrade.
- Legacy recovery-snapshot migration no longer blocks startup.
- Manual Sync now and Auto Sync remain unchanged.


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

## v5.7.0
- Removed the `Flight Time — Left Seat` statistic from Dashboard/Totals. Seat Position remains stored per entry and Right Seat hours remain available.
- Added `Call from Day OFF` checkbox to Add/Edit Entry, including DHD and Ground Course minimal forms.
- Call-from-Day-OFF flags are persisted, drafted, synced and exported. Logbook shows a `Day OFF call` badge.
- Payroll now counts Day OFF premium automatically from flagged entries, once per calendar date, using the existing `Day OFF premium DHM` setting.
- Payroll shows each Day OFF call date, duty/route, premium and an editable monthly Remark field for payment follow-up.
- Added full Expiry manager with multiple Licences, Medicals, Instructor Ratings and Recurrent Courses.
- Licence fields: licence/type, authority, number, last check, expiry and remarks.
- Medical fields: authority, certificate number, last check, expiry, issuer and remarks.
- Instructor Rating fields: rating, authority, number, last check, expiry and remarks.
- Course fields: editable course name, authority, course date, expiry, provider/issuer and remarks. Common suggestions include CRM, SMS, GRT, DGR, AVSEC, SEP, First Aid, UPRT and EBT/CBTA.
- Expiry rows are green above 30 days remaining, yellow from 30 days through expiry day, and red after expiry. Days remaining are shown automatically.
- Expiry records participate in Cloud Sync, deletion tombstones and the weekly backup.
- Roster UI now displays only the current month followed by the next month. Past months and months beyond the next are hidden from this page without deleting data.
- Roster automatically anchors to today / the first activity after today when opened.

## v5.7.1
- Cleaned the Logbook screen by removing the redundant descriptive text, `Log entries` heading and explanatory card above the entries list.
- Improved the Logbook current-day anchor: opening Logbook now positions at today when present, otherwise at the exact boundary between future and past entries.
- The anchor is placed before the current-month separator so the current date area is visible immediately instead of landing too far down the list.
- No stored data or logbook ordering changed.

## v5.7.2
- Calendar roster import no longer ignores `OFF` / `DAY OFF` events; they are stored as explicit `Day OFF` duty records.
- Roster now renders every calendar date in the current month and following month.
- A date with an explicit OFF record is shown as `Day OFF`.
- A date with no flight, SIM, STBY, DHD, Ground Course or explicit Day OFF record is shown as `Blank day`.
- Fixed the Roster anchor on iPad/Safari: the generic navigation scroll-to-top no longer overrides the Roster anchor, and the anchor scroll is performed after two animation frames.
- Roster anchors exactly to today's calendar row.
- Logbook anchor changed from today/boundary to the next upcoming duty/activity. It uses the earliest upcoming operational/report start; if there is no future entry, it falls back to the most recent past entry.

## v5.7.3
- Renamed the visible Dashboard navigation item to `Totals`.
- Removed the EASA FTL `Current status` / `OK` / `CHECK` summary card.
- EASA FTL limits now use one consistent traffic-light rule based on remaining allowance:
  - green when more than 5:00 remains;
  - yellow when 5:00 or less remains, including exactly at the limit;
  - red only after the limit has been exceeded.
- The same 5-hour rule is applied to Current/Next/Last daily FDP and all 7/14/28-day and flight-time limits.
- FTL limit rows receive a light matching background as well as colored values for faster scanning.

## v5.7.4
- Rebuilt Screenshot Roster parsing for Air Arabia `Individual Crew Schedule Report`.
- OCR now requests positional Tesseract `blocks` and preserves word bounding boxes.
- The parser reconstructs dated calendar cells from X/Y coordinates instead of flattening the roster grid into linear text.
- Supports OFF/Day OFF, DHD, HSBY/STBY, GRT/CRM/SMS/SEP/DGR/AVSEC/ground courses and multiple 3O/MAC flight sectors in one day.
- Flights are reviewed/imported as Roster sectors; non-flight activities as Logbook entries; OFF as Day OFF.
- Where the screenshot does not print routes, PilotLog tries to infer route from previous Logbook/Roster history for the same flight number; otherwise fields remain blank for Review.
- Added Day OFF to Screenshot Review and fixed scheduled-block calculation precedence.

## v5.7.5
- Reworked Screenshot import as a tolerant review workflow instead of all-or-nothing parsing.
- PilotLog now pre-fills every field it can read and leaves uncertain/missing fields blank and highlighted yellow.
- Added `To complete`: a non-empty roster cell that cannot be safely classified is preserved as an editable review row rather than discarded.
- Original OCR cell text and parser notes are retained in Remarks so the user can see what PilotLog was trying to interpret.
- If the calendar grid cannot be reconstructed at all, recovered activity lines are returned as `To complete` rows instead of producing a misleading single import.
- Review displays a live `ready / to complete` count and states exactly which fields are missing.
- Selected incomplete rows are blocked from import; the user can complete the yellow fields or uncheck those rows and safely import the rest.
- Added type-specific completeness rules for Flight, DHD, STBY and Simulator rows.
- Added bounded image preprocessing for small roster text: upscaling up to 2.5× / about 12 MP, grayscale and mild contrast enhancement before OCR.

## v5.8.0
- Replaced Crew Schedule screenshot parsing with a two-pass Smart Cell Scan.
- Pass 1 reads the whole page only to locate the dated roster grid.
- Pass 2 crops every calendar day separately, excludes the daily-total strip, upscales the crop and OCRs that cell alone.
- Each day is then interpreted independently as Flight, Day OFF, DHD, STBY/HSBY, Simulator/FSTD or recurrent course.
- Partial text is never guessed: clipped times and unknown routes remain yellow fields to complete in Review.
- Unclassified but readable cells become `To complete` with the raw cell OCR retained.
- The v5.7.5 tolerant positional/full-page parsers remain as fallbacks if the Smart Cell grid cannot be reconstructed.

## v5.9.0
- Professional visual redesign only; operational logic and stored data are unchanged.
- New restrained light airline-tool visual language: navy/white palette, sharper typography, quieter cards, borders and shadows.
- Added a simple line-art PilotLog brand mark in the app header without external assets.
- Reworked primary navigation with consistent monochrome line icons.
- On phones and smaller iPad widths, navigation is now a native-style bottom tab bar; wide layouts retain a compact navigation rail.
- Refined forms, focus states, buttons, roster rows, Totals, Payroll, Expiry and FTL presentation for a more professional cockpit/operations feel.
- Kept all existing views, IDs, storage keys, sync controls, Smart Cell Scan, manual Sync now, imports and exports unchanged.

## v5.10.0
- EXPIRY text and free-text values are now stored/displayed in uppercase.
- Added MEDICAL CLASS selector with CLASS 1 and CLASS 2.
- Added AIRCRAFT ENDORSED as a dedicated expiry category.
- AIRCRAFT ENDORSED includes ENDORSED BY with autocomplete from the same crew-name database used by flight entries.
- AIRCRAFT ENDORSED supports an optional image attachment. On iPhone/iPad the normal image picker can offer Camera, Photo Library and Files. The image is never shown inline; it appears only after pressing VIEW.
- Attached images are resized/compressed before being stored and remain part of the normal Expiry cloud sync/weekly backup payload.
- Added LOCK / UNLOCK to every Expiry record. Locked records cannot be edited or deleted until explicitly unlocked.
- Replaced all separate Expiry Add buttons with one ADD button at the end and a type-selection action sheet.
- Added LPC ENGLISH with DATE PERFORMED, LEVEL 4/5/6 and editable EXPIRY DATE.
- EASA FCL.055 defaults: Level 4 = 4 years, Level 5 = 6 years, Level 6 = no required reassessment. The calculated expiry remains editable for other authorities.
- Payroll month control is now visually reduced to a clean top/bottom-line treatment instead of a boxed field.
- Removed the redundant Call from Day OFF count field and the four separate Payroll metric cards.
- Payroll BREAKDOWN is now an app-style three-column zebra grid: ITEM / HOURS-COUNT / DHM, with no horizontal divider lines.
- Renamed “Credit hours pay” to “Credit H” and placed the actual credit hours in the new middle column.

## v5.10.1
- Trips screen reordered: Saved trips now appears first.
- Auto Detect is now a compact standalone button without the explanatory text block.
- Trip cards are renamed automatically using only the destination of the first DHD followed by the reference month and year (for example: NAP AUGUST 2026).
- Version strings and service worker cache updated to v5.10.1.

## v5.10.2
- Roster now performs persistent semantic duplicate cleanup. Duplicate planned sectors and duplicate non-flight roster activities are merged, keeping the more complete record and preserving cloud tombstones so removed copies do not return after sync.
- Duplicate activity cleanup is conservative: two fully timed activities with different times remain separate; an untimed/partial copy of the same DHD, Simulator, STBY or Ground Course is merged into the more complete record.
- Added Edit controls for individual roster sectors, non-flight roster activities and duty-only rows.
- Added a dedicated Roster Activity editor for date, type, flight number, aircraft, route, start/end and remarks/course.
- Logbook View/Edit Entry now has a Back button. When an entry was opened from Logbook, Back returns to Logbook anchored exactly on that entry.
- Opening Logbook from the main navigation still uses the existing next-upcoming-duty anchor logic.
- When an entry is opened from Roster, Back returns to Roster.

## v5.10.3
- Added native AeroLINE JSON import directly in the Roster screen.
- Reads the structured AeroLINE `mainCrewScheduleInfoList` rather than OCR.
- Imports flight sectors into Roster using `flightLegId` / `crewScheduleBlockId` metadata and updates the same sector on re-import instead of duplicating it.
- Imports unique OFF, DHD, HSBY/STBY and structured training activities; repeated event data attached to multiple flight rows is collapsed to one activity.
- AeroLINE flight imports never create planned Flight entries in the operational Logbook, so actual Logbook data are not overwritten.
- Re-importing a full AeroLINE period removes stale AeroLINE-only planned records that disappeared from the new roster, while preserving locked/manual records.
- Manual edits made from the Roster are marked as overrides and are preserved on later AeroLINE imports.
- DHD activities with no route in the AeroLINE data remain route-incomplete instead of being displayed as a fabricated Home Base → Home Base sector.
- Training metadata from `trainingCrewScheduleInfoList` is retained on matching roster sectors for future use.

## v5.11.0
- Added a complete LogTen migration workflow for the original `LogTenCoreDataStore.sql` database.
- Complete migration packages carry normalized PilotLog entries plus the untouched original SQLite database in one file.
- PilotLog stores the original LogTen SQLite database byte-for-byte in a dedicated IndexedDB archive; it is not uploaded through Cloud Sync.
- Added `Export archived LogTen database` so the exact archived SQLite file can be recovered from PilotLog later.
- Stable LogTen `ZLOGTEN_UNIQUEID` values are retained on imported entries and used for safe re-import/update matching.
- Complete database mapping handles LogTen flight types 0 Flight, 1 DHD, 2 Ground Course, 3 Simulator and 7 STBY.
- Imports currently supported operational fields including dates/times, route, aircraft/type, PIC/SIC role, crew names, instruction, night, IFR, PF, approaches, take-offs/landings, remarks and lock state.
- Fields and relationships not yet surfaced by PilotLog remain preserved in the embedded original SQLite archive for future implementation.
- Existing LogTen Tab import remains available as a secondary compatibility import.
- Existing PilotLog storage keys and cloud-sync schema are unchanged; a new local-only LogTen archive metadata key was added.

## v6.0.0
- Built from the complete v5.11.0 baseline, retaining the complete LogTen migration/archive workflow.
- Added AeroLINE Connect controls in Roster: month selector, official AeroLINE login shortcut and direct Sync AeroLINE test.
- AeroLINE crew ID/profile ID can be learned from a normal AeroLINE JSON import and are stored only on the device; AeroLINE passwords, cookies and Auth-Token values are not stored by PilotLog.
- Direct sync requests the structured `TrackingService/getCrewSchedule` endpoint for the selected month and feeds the response through the existing v5.10.3 AeroLINE roster importer.
- Existing Import AeroLINE JSON remains available as the reliable fallback while browser cross-origin/session behavior is validated on each device.
- Existing PilotLog Auto Sync and manual Sync now are unchanged.

## v6.0.1
- Stability/lean release; no operational data-schema migration.
- Production deployment ZIP now contains only the files required by GitHub Pages plus README/CHANGELOG; source/build material is distributed separately.
- Removed the full-flight-database snapshot previously attempted on every render.
- Rolling recovery snapshots are now capped at three and stored in IndexedDB instead of duplicating the logbook repeatedly in localStorage.
- Legacy `pilotlog_flights_backup_v1` snapshots are migrated to IndexedDB when possible and then removed.
- Critical `save()` writes recover from localStorage quota pressure by deleting only the obsolete legacy snapshot cache and retrying the requested write.
- Service Worker uses cache-first for immutable versioned JS/CSS/manifest assets and network-first for navigation, with offline fallback.
- Existing PilotLog storage keys, Supabase schema, complete LogTen archive, AeroLINE JSON importer, Auto Sync and manual Sync now behavior remain unchanged.

## v6.0.2
- Storage stability fix for large complete LogTen migrations. The normalized PilotLog logbook is now stored in IndexedDB instead of the browser's small localStorage quota.
- Existing `pilotlog_flights_v1` localStorage data are migrated automatically to IndexedDB on first launch and removed only after the IndexedDB write succeeds.
- The app keeps its existing synchronous in-memory data model, so roster, payroll, totals, FTL, cloud sync and LogTen logic continue using the same flight records and IDs.
- Complete LogTen migration now waits for a durable IndexedDB write before reporting success; the original byte-for-byte LogTen SQLite archive remains stored separately in IndexedDB.
- Recovery snapshots now read from the canonical IndexedDB-backed logbook rather than assuming a localStorage copy exists.
- Weekly backup restore writes the flight database durably to IndexedDB before completing.
- Routine logbook writes are coalesced before IndexedDB persistence to avoid repeatedly rewriting the full history while typing; pending data are flushed when the app is hidden or closed.
- PilotLog requests persistent browser storage when supported to reduce eviction risk.
- Versioned assets and Service Worker cache updated to v6.0.2.

## 7.0.0 — Central Database architecture
- Replaced peer/full-state multi-device synchronization with a single authoritative Supabase database model.
- The cloud database is now the source of truth; device data is a local cache/offline working copy only.
- Introduced a new isolated v7 local-storage and IndexedDB namespace. PilotLog 7 never loads legacy v5/v6 local datasets.
- Introduced new cloud namespace `db7`; normal v7 reads never query legacy cloud records.
- Added destructive clean-start action **Erase Old Database • Start Clean**. It deletes every PilotLog row belonging to the signed-in Supabase user, then deeply formats both legacy and v7 local PilotLog stores/caches on the current device.
- Added database generation/revision guard. A device may publish changes only if it is based on the current central database revision. If another device has already changed the server, upload is stopped instead of overwriting/resurrecting data.
- Clean devices with no pending local changes download and replace their cache from the central database; they do not upload stale cached copies.
- Deletes are represented by absence in the authoritative snapshot. No replicated tombstone history is required by v7 central-database operation.
- Manual **Sync now** remains available. Auto Sync remains independently configurable.
- Kept PilotLog v5.11 visual baseline; no UI restyling.
