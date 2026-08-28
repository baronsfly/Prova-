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
