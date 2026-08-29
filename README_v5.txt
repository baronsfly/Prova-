PilotLog v5.0.0
================

Files to upload to the root of the GitHub Pages repository:
- index.html
- app.js
- styles.css
- sw.js
- manifest.webmanifest

Main changes in v5:
- last cloud-login email remains stored locally after Sign out;
- uppercase normalization for operational text fields;
- daily duty grouping: On Duty only on first entry, Off Duty and Total Duty only on last entry;
- automatic sector count;
- EASA FTL rolling and daily FDP checks (basic acclimatised table, without extensions);
- DHD credit manually editable;
- simulator actual time is independent from pay credit; actual SIM = On Duty→Off Duty, while simulator credit always comes from Settings;
- Ground Course / STBY / DHD / Simulator retained in Entries;
- Trips show Paid Layover and Total Layover Allowance; Ground Course charged as fixed 5:00 duty;
- Roster grouped by duty and displayed in local airport time;
- airport IATA/ICAO + timezone database cached in IndexedDB after first online download;
- automatic night-time estimate using civil twilight and great-circle sampling;
- day/night take-offs and landings;
- confirmation before deleting an entry.

Important:
The daily EASA FDP check implemented here is the BASIC acclimatised table without planned extensions,
split duty, augmented crew, commander discretion, unknown acclimatisation or operator-specific FRM.
It is a warning/monitoring aid, not a replacement for the operator's approved FTL scheme.

- Simulator totals are split into Simulator Total, Simulator as Trainer, and Simulator as Trainee.
- Trainer is identified by Instruction = SFI/SFE Instruction Sim; all other simulator entries count as Trainee.

- Morocco scheduled-departure premium: Flight credit is first rounded up to the next 30 minutes, then increased by 50% when the scheduled departure airport is in Morocco and scheduled local departure is from 18:00 through 04:59.
  Example: base credit 3:00 -> paid credit 4:30.
- The supplied LogTen Pro standard Tab export does not contain a dedicated Locked field, so lock status cannot be imported reliably from that export format.

- DHD entry UI is simplified to Date, From, To, Start time, End time and editable Credit Hours only. All flight/simulator-specific fields are hidden.

- Ground Course entry UI is simplified to Date, Location (IATA), Course Type and editable Credit Hours.
- Ground Course credit defaults from Settings but remains manually editable.

- DHD is excluded from paid-layover duty subtraction.
- Automatic trip boundaries use the exact start time of the first out-of-base activity and the exact end time of the final return-to-base activity.
- Automatically generated trips store the IDs of included entries and expose a View duties inspector showing each included flight/duty, times, duration and whether it was deducted from layover.

- Only DHD entries can open an automatic trip. Normal operating flights can be included inside an already-open trip but can never generate a trip by themselves.

- LogTen import mapping updated: flight_type 7 = STBY, flight_type 2 = Ground Course, flight_type 3 = Simulator, blank = normal Flight. flight_type 1 is treated as transfer/DHD when transfer evidence is present or no operating flight number exists.

- v5.0.9 re-import repair: LogTen non-flight rows are matched independently of their previously stored dutyType. Re-importing can therefore convert old misclassified entries (for example flight_type 7 previously saved as Flight) into STBY instead of duplicating them.

- v5.0.10 duty fix: DHD never receives operational duty metadata and never defines duty boundaries. On days containing operating flights, On Duty is assigned to the first flight and Off Duty/Total Duty to the last flight. A DHD-only day has zero operational duty.

- v5.0.11: Entries are visually separated by month.
- Ground Course now includes a Start time (Zulu) used for chronological ordering with DHD/other entries.
- Roster deduplicates the same sector imported as both 3Oxxx and MACxxx, counts the physical sector once, and displays the roster flight designator as 3Oxxx.
- Future-month payroll uses the latest live EUR/MAD rate provisionally until the existing month-rate locking rule is satisfied.

- v5.0.12 emergency fix: restores the render() function accidentally removed in v5.0.11. Existing localStorage logbook entries were not deleted; the previous version failed to render them.

- v5.0.13 Morocco night credit: when the first operating sector of a duty departs a Moroccan airport between 18:00 and 04:59 local, the +50% credit applies to every operating flight sector in that same duty, including the return from abroad.
- Roster duty summary now shows Home Base -> outbound destination (for example CMN -> CDG) instead of CMN -> CMN on a return duty.

- v5.0.14 emergency fix: corrected a JavaScript runtime error introduced in v5.0.13 by an undefined isMoroccoAirport() call. Existing logbook history remains in localStorage and renders again without reimport.

- v5.0.15 Morocco night premium fix: Add/Edit now evaluates the current unsaved sector as well as saved sectors. If any flight sector in the duty/day departs Morocco between 18:00 and 04:59 local, all flight sectors of that duty receive +50% credit, including the return.

- v5.0.16 Morocco night premium pairing logic: each flight sector departing Morocco is evaluated independently by scheduled local departure time. Its result (day or +50% night) also applies only to the immediately following return sector. Example: CMN-BCN 14:00 + BCN-CMN = day; CMN-AGP 18:10 + AGP-CMN = night +50%.

- v5.0.17 Morocco night premium simplified and hardened: a sector departing Morocco is evaluated directly from its own scheduled local departure time. A sector departing abroad inherits day/night status only from the immediately preceding operating sector when that preceding sector departed Morocco. This supports independent sector pairs in 4-sector duties and works correctly during Add/Edit before saving.

- v5.0.18 Dashboard simplified: Recent Entries and Upcoming Roster removed from Dashboard.
- Added Duty — Today + next 6 days, showing a compact seven-day operational view with actual entries first, then planned roster/duty data, and OFF / No duty for empty days.

- v5.0.19 stability hardening: Entries is rendered independently before Dashboard/Roster/FTL; stale Upcoming Roster reference removed; five rolling local flight-data snapshots are kept automatically.
- CHANGELOG.md now records changes chronologically by version.

- v5.0.20: fixed Dashboard 7-day duty view storage-key typo; no data migration required.

- v5.0.21: separated Professional Experience from Payroll, simplified Dashboard/Totals, hid Duty navigation, and added EASA-style logbook print/PDF plus experience/backup exports.

- v5.0.22: EASA-style export redesigned for A4 portrait. Each page keeps its entries and page/previous/to-date summaries together; zero values are blank, remarks are left aligned, dates are dd/mm/yyyy, and FSTD sessions use the standard-style FSTD columns.

- v5.1.0: added autonomous screenshot OCR import with editable review/confirmation and European dd/mm/yyyy date presentation across the main interface. No screenshot data are saved before explicit review confirmation.

- v5.1.1: EASA export now generates a true fixed-size A4 PDF rather than an HTML print page, avoiding Safari/iPhone automatic scaling during printing.

- v5.1.2: consolidated Aircraft Breakdown to A320 only and added clear month separators to Upcoming Roster while preserving the existing roster duty cards.

- v5.1.3: fixed the Roster month header `[object Promise]` regression. Month labels are now rendered synchronously.

- v5.1.4: Cloud Sync now uses direct Supabase API calls with explicit timeouts, eliminating the external Supabase JS CDN dependency that could hang on iPhone.

- v5.1.5: Cloud Sync now identifies and merges the same operational flight across devices even when internal IDs differ, backs up before cleanup, and removes stale cloud duplicates.

- v5.1.6: Flight entries store PIC Name, SIC Name and SO Name. PIC Name feeds the EASA Name(s) PIC column; SIC/SO names remain available for professional exports.

- v5.1.7: added Instructor/Examiner Name, mapped LogTen Student→SO and Instructor→Instructor/Examiner correctly, and added an Examiner-role reminder for Remarks.

- v5.1.8: duplicate prevention now applies to LogTen import and one-time startup cleanup, including identical date/route placeholder rows with no flight number or times.

- v5.1.9: added crew-name and aircraft-type autocomplete, IFR=Yes default for new flights, and a Return Flight shortcut that reverses the route, increments the flight number and preserves persistent crew/aircraft parameters.

- v5.2.0: persistent Add draft/autosave, lock-only workflow, mobile autocomplete, actual IN+30 duty end, taxi-inclusive Night, PF/approach tracking, corrected EASA duty/FDP, Last 6 months, and offline caching.

- v5.2.1: fixed EASA rolling FTL counters counting future roster duties and double-counting legacy Duty records.

- v5.2.2: EASA rolling duty now counts one saved operational duty total per day instead of rebuilding multi-day sessions. Future FDP selection comes from Roster.

- v5.3.0: internal cleanup/refactor. Production remains a single app.js for reliability, while maintainable source is organized under /src and can be rebuilt with build_app.py. No database migration.

- v5.3.1: FTL/duty engine rebuilt and stale Service Worker cache issue fixed. The runtime now uses versioned filenames so a newly deployed build cannot silently execute an older cached app.js.

- v5.3.2: Entries automatically opens at today/the today boundary; scroll up for future entries and down for past entries.

- v5.4.0: fixes return-flight credit display; PIC hours only for Role=PIC; automatic same-duty roster carry-forward with alternating PF; user name/role profile and personalized header; Left/Right seat tracking and totals. Native wake alarms are not yet implemented in the PWA.

- v5.4.1: cross-device deletions are now synchronized with tombstones. Deleted flights/roster/duties/trips do not reappear from older cloud copies.

- v5.5.0: Auto Sync plus one rotating weekly IndexedDB backup. Storage remains bounded because the weekly snapshot always overwrites the previous one.
