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
