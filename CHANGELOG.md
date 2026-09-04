# PilotLog v10.2 — Core v1 activity identity

- Removed separate Roster and Logbook visibility/membership state from activity records.
- Roster and Logbook now read the same Core activity record through functional filters only.
- Planned roster flight completion updates that record to COMPLETED without creating or linking a second flight.
- Roster CSV, calendar, screenshot and AeroLINE imports now write through the single Core activity commit path.
- Legacy Roster, Logbook and Duty stores are read only once for migration and are never runtime authorities.
- Fixed the v10.1 startup/Roster freeze on large archives by replacing full archive pair-by-pair scans with indexed Core identity lookups.
- Published with new v10.2 asset names and offline-cache identity so browsers cannot reuse the defective v10.1 files.

# PilotLog v9.10.1 — Complete LogTen import identity fix

- Fixed complete LogTen migration verification where distinct LogTen rows could be merged against an existing activity by operational similarity.
- Every LogTen row with a stable `logtenUniqueId` is now preserved by that exact identity.
- No backup or migration package is modified.
- Simulator OUT / IN behavior from v9.10 is unchanged.

# PilotLog v9.10 — Simulator OUT / IN

- Simulator editor uses the same OUT and IN fields as flights.
- Removed the Simulator Start / Simulator End relabeling.
- Duty times remain separate from simulator OUT / IN.
- Complete LogTen migration maps existing simulator session times to OUT / IN without modifying the backup file.
- Simulator duration is read from OUT → IN. No Duty-to-Simulator time formula is used.

# PilotLog v9.9 — Roster home, profile photo, currency and experience totals

- Opens on Roster after every reload and keeps the graphical calendar first.
- Removes the duplicated large month heading; the native rotating month control remains.
- Adds an optional personal header photo with automatic PilotLog-logo fallback.
- Restores the Payroll Result split: authoritative MAD/DHM total plus a conversion total.
- Builds the aircraft breakdown from every aircraft actually flown and groups stored variants under ICAO type designators.
- Totals shows only time categories actually present for each aircraft type, with Simulator kept separate from Flight Time.
- Totals now consumes preserved LogTen approach records including quantity and previously omitted types such as VOR/DME.
- Manual saved values remain authoritative during re-import; approach supplementation cannot replace a manual selection or deletion.

# PilotLog v9.8 — Simulator Credit Hours manual override

- Fixed the Simulator editor so Credit Hours are no longer read-only.
- Simulator Credit Hours still default from Settings for entries without a manual override.
- Once the user saves a Simulator entry, the final Credit Hours value entered by the user is authoritative, including `0:00` for Trainee sessions.
- Totals, Payroll, Logbook statistics and all downstream Credit Hours consumers use the saved manual Simulator credit value.
- No flight Credit Hours formula, Simulator Time formula, roster logic, payroll rate, database key, import format, sync protocol or visual layout was changed.

# PilotLog v9.7 — Simulator entries in Logbook and Totals

## v9.7

- Shows every saved simulator entry in Logbook, including rostered future simulators.
- Includes simulator time in Totals, kept separate from flight time.
- Retains all v9.6 central database, Roster, Logbook loading and flight-reconciliation changes.

## v9.6

## v9.6

- Keeps the one operational database and central calculation engine as the only source for Roster, Logbook, Trips and Payroll.
- Roster shows the calendar first, uses the Payroll-style month/year selector and moves AeroLINE Sync/options after the agenda.
- Logbook entries open by touching the complete row; older rows load automatically before the end of the list.
- Reconciles a unique LogTen/AeroLINE flight centrally from date, route and scheduled UTC times (15-minute controlled tolerance); ambiguous cases remain separate and appear under Settings → Data Integrity Check → “Da controllare”.
- Leaves UTC editing, Roster swipe behavior and haptic feedback unchanged for the later phase.

- Replaced the release-only month gesture with an interactive swipe: the calendar follows the finger during horizontal movement.
- Added adjacent previous/current/next month panels so the incoming month is visible during the gesture.
- Added a 240 ms ease-out snap, distance/velocity completion and snap-back for incomplete swipes.
- Preserved vertical page scrolling and suppressed accidental day taps generated at the end of a swipe.
- No database, calculation engine, business rule or non-Roster page was changed.

---

# PilotLog v9.4 — Roster calendar cache correction

- Corrected the broken Roster calendar layout seen on Safari/iPhone.
- Root cause: the v9.3 calendar CSS was published under the obsolete `pilotlog-8.3.0.css` filename, allowing an older cached stylesheet to be combined with the new calendar markup.
- Renamed the stylesheet to `pilotlog-9.4.css`, the script to `pilotlog-9.4.js`, and advanced the offline cache to v9.4 so the approved layout is fetched as a new asset.
- No application data, database schema, calculation engine, business rule or non-Roster page was changed.

---

# PilotLog v9.3 — Approved Roster calendar / unified projections

- Add Flight swipe right now saves the complete draft and always returns to Logbook.
- Preserved partial Add Flight data while navigating to any other page; drafts remain inside the single authoritative database state.
- Replaced the Roster list with the approved second graphical calendar: year selector, all-month strip, previous/next controls, horizontal month swipe, selectable/deselectable days and selected-day agenda.
- Made each complete Roster activity row clickable and removed separate Open/Edit controls from that agenda.
- Trips cards, View Duties and Payroll now consume the same live Trip projection from `PilotLogEngine`; obsolete stored Trip layover values no longer drive those pages.
- Completed Roster flights retain the final saved Flight Entry values in operational projections; planned Roster times apply only to activities not yet completed.
- Verified the agreed RBA 08/26 case from the supplied backup: 22:00 Trip, 8:02 Duty and 13:58 Layover everywhere.
- Restored the native Payroll month/year dropdown without redesigning Payroll.
- No changes to the database schema, stored entry fields, established Credit Hours, Payroll, Trip, Totals, Expiry, import, export or sync rules.

---

# PilotLog v9.2 — UI responsiveness / Logbook performance

- Removed a second large-backup bottleneck in Logbook rendering.
- Credit Hours for displayed Logbook rows now reuse a per-day context instead of re-reading and copying the full operational database for every row.
- Logbook statistics use one date index per render rather than repeatedly scanning the multi-year archive.
- Trips list rendering is lazy and no longer creates hidden DOM during app startup.
- Faster direct lookup when returning to a specific Logbook entry.
- Logbook DOM is bounded to 400 entries initially; older entries remain available in 400-entry batches while search/statistics continue to use the full database.
- No visual redesign and no changes to stored data, database schema, Payroll, Credit Hours rules, Roster, Trips calculations, Expiry, or sync behavior.

---

# PilotLog v9.1 — Large-backup restore performance fix

- Fixed the freeze/unresponsive state triggered after restoring a large v8.9 Full Backup into v9.0.
- Root cause: Trips rendering rebuilt the complete multi-year operational dataset once for every saved trip.
- Operational trip entries are now grouped once per render and reused.
- Saved-trip entry resolution now uses one indexed lookup and precomputed activity time windows.
- Verified with the supplied 8.9 MB backup: 7,928 Logbook entries, 48 Roster sectors, 17 duties, 168 Trips and 36 Expiry records migrate to 7,960 unique activities.
- Verified that the optimized operational Trip projection returns the same 7,940 records in the same order as v9.0 logic.
- Verified that all 168 displayed Trip names are identical to the v9.0 logic.
- No UI, Payroll, Credit Hours, Totals, Roster, Logbook, Expiry or calculation rule changes.

---

# PilotLog v9.0 — Single authoritative database and calculation engine

- Rebuilt the internal data layer directly from v8.9 without changing the established UI or CSS.
- Replaced the separate authoritative `flights`, `roster` and `duties` stores with one activity collection in one operational IndexedDB database.
- Added stable activity state/visibility flags so Roster and Logbook are filtered views of the same record.
- Completing a Roster flight now updates that same record and ID instead of creating a second linked Logbook entity.
- Removed the synthetic Roster-flight entity builder previously used by Payroll and Trips.
- Centralized entry metrics, Credit Hours, duty sessions, operational month selection, Trips, Payroll, Totals, Logbook statistics and Dashboard projections behind `PilotLogEngine`.
- Moved Trips, Expiry, settings, Payroll configuration, FX, drafts and sync ledger into the same authoritative database state.
- Full Backup v9.0 now exports one `database` object. Restore remains compatible with v8.9 sectioned backups and migrates them atomically.
- Cloud sync accepts legacy sectioned snapshots, migrates them to the unified model and publishes the unified database through verified chunks.
- Preserved v8.9 calculations: the provided backup was compared across 270 populated months with zero Payroll differences and zero Totals differences.
- Preserved the supplied data: 7,924 entries, 48 Roster sectors, 17 duties, 168 Trips and 36 Expiry records consolidate to 7,960 unique activities with no duplicate IDs.
- `pilotlog-8.3.0.css` remains byte-for-byte identical to v8.9; HTML structure and controls are unchanged.
- Added a non-UI `sw-8.9.js` upgrade bridge so an already cached v8.9 installation can replace its old offline cache with v9.0.

---

# PilotLog v8.9 — Trip cash, global currency, Expiry dedupe, Training authority

- Trip `Cash Received > 0` now forces Layover Pay to zero while preserving the informational layover duration.
- Added one global **Currency** in Settings, shared by Payroll and Trips. Payroll contract/rate inputs remain canonically stored in MAD/DHM.
- Trip Cash currency now uses a selector with quick USD / TRY / EUR choices plus the broader ISO currency list.
- Replaced the separate Trip EUR converter and Payroll EUR converter paths with one shared FX engine, using jsDelivr first and the documented Cloudflare Pages endpoint as fallback.
- Trip Cash FX is resolved from the Trip Start date and the rate/date are stored with the trip; reopening the same trip/date/currency pair reuses the frozen value.
- Payroll now displays one selected global currency instead of separate DHM and indicative EUR totals.
- Existing Expiry duplicates are consolidated semantically across LogTen/AeroLINE/manual sources. A validation such as SMS with the same identity is kept as one record.
- AeroLINE validation re-import now finds equivalent cross-source records instead of matching only prior AeroLINE records.
- Training Sector pay is no longer generated from an unsaved AeroLINE training flag. AeroLINE may prefill Flight Instruction, but only the final saved Logbook entry is authoritative.
- Saved Flight Instruction earns the configured Training Sector allowance (500 MAD/DHM by default); saved No/blank earns zero.
- Explicit user saves mark operational records as manual overrides so later source imports preserve the final saved calculation-relevant values.
- No db8 cloud sync protocol, storage-key or Credit Hours formula change was introduced.

---

# PilotLog v8.8 — Ground Course credit + NF CH info

- Ground Course Credit Hours are editable per activity.
- AeroLINE `trainerType=GI` defaults Ground Course credit to the configured Ground Course Credit Hours value; `trainerType=TNE` defaults it to `0:00`. Manual override remains available.
- Manual Ground Course credit overrides are preserved when the same AeroLINE roster period is imported again.
- Payroll Breakdown adds `NF CH` immediately below `Credit H`: the middle column is the count of non-flight activities with positive credit and the right column is their total credit hours.
- `NF CH` is informational only and is already included in `Credit H`; it does not increment Credit Hours or payroll.
- No sync protocol, storage keys, flight Credit H formula, totals, layover formula or other business rules were changed.

---

# PilotLog v8.7 — Roster activity direct editing

- Fixed Roster activity handling for Simulator, Ground Course, DHD, DHP and STBY.
- Locked Roster activities can now be edited and deleted directly from Roster; no Logbook unlock is required.
- Saving a locked Roster activity preserves its existing locked state instead of changing the Logbook lock workflow.
- Roster activity editor now shows **Save changes** and hides flight-only **Return Flight** / **Clear** actions.
- No cloud sync, ledger, tombstone, merge, revision or calculation logic changed in this release.

---

# PilotLog v8.6 — Central snapshot integrity compatibility

- Fixed false central-database integrity failures caused by PostgreSQL/Supabase `jsonb` reordering object keys after upload.
- Central section digests now use canonical recursive JSON key ordering (`canonical-json-v1`).
- Legacy db8 generations created before v8.6 are accepted only after strict generation/chunk/count structural verification when their old order-sensitive digest cannot survive `jsonb` normalization.
- Newly uploaded generations are fetched back and content-verified before the active generation is switched.
- No changes to merge policy, record identity, deletion ledger/tombstones, revision semantics, Sync now, Auto Sync, payroll, roster, logbook, trips, expiry, or business rules.

---

# PilotLog v8.5.0 — Eight-point Roster / central-rule consolidation

- Started directly from v8.4.3; no unrelated redesign or storage/protocol migration was introduced.
- Removed the generic Roster activity editor. Roster now routes each activity to the established activity workflow with type-specific fields.
- Locked non-flight Roster activities can be edited from Roster without Logbook unlocking and retain their locked state after save; normal Logbook lock protection remains unchanged.
- Unified Ground Training, Ground Course and GRT under the canonical Ground Course type/rule path.
- Added dedicated DHD/DHP layouts: DHD Credit is forced to zero; DHP Credit remains editable.
- Kept Simulator actual time separate from Simulator Credit and from all Flight/PIC/SIC/A320 Flight totals; simulator instruction remains separate.
- Reworked Totals to consume a central Flight-vs-Simulator classification model.
- Added a permanent sync change ledger with record/source identity, revision, device, timestamp and delete/collection tombstones. The ledger travels in verified cloud snapshots and v8.5 full/weekly backups.
- When local and remote revisions diverge, Sync now merges records plus ledger/tombstones before publishing a new verified generation, preventing deleted source-backed records from being silently resurrected.
- Centralized activity aliases, Credit Hours, trip charging and totals classification in one rule registry/calculation path; consuming modules use the calculated result rather than parallel rule copies.
- Flight Credit Hours formula remains unchanged from v8.4.3: scheduled OUT→IN only, 30-minute upward rounding, existing Morocco +50% premium; actual OUT/IN never affects Credit Hours.

# PilotLog v8.4.3 — Shared calculation engine / lighter modules

- Centralized Credit Hours in one shared calculation engine used by Add Flight, Logbook, Payroll, Roster planning, Calendar import, AeroLINE import, LogTen import and screenshot import.
- Removed Payroll-, entry- and import-specific Credit H wrappers/formulas; modules now render the result of the same shared calculation instead of maintaining their own copies.
- Centralized clock-span calculations in one shared helper for scheduled block, actual block, airborne time, simulator time and duty spans, preserving the existing overnight logic.
- Consolidated the Morocco night-premium lookup into one function that accepts an optional entry set instead of maintaining separate Logbook and Payroll variants.
- Flight Credit H rule is unchanged: Schedule OUT → Schedule IN only, round upward to 30 minutes, then apply the existing Morocco +50% premium when applicable. Actual OUT/IN never enters Credit H.
- Removed unused/dead Credit-Hours compatibility helpers. No storage keys, cloud-sync protocol, UI workflow or historical data were changed.

# PilotLog v8.4.2 — Payroll Credit H unification

- Fixed the remaining Payroll-specific Credit H path. Payroll no longer maintains a separate Flight credit formula.
- For completed/linked Roster sectors, Payroll uses the preserved Logbook Schedule OUT / Schedule IN instead of allowing later Roster times to replace the original schedule used for Credit H.
- Future/uncompleted sectors continue to use Roster scheduled times, preserving Roster as the primary planning/payroll source.
- Flight Credit H is calculated by one shared engine everywhere: Scheduled Block only, 30-minute upward rounding, then the existing Morocco +50% rule. Actual OUT/IN never enters Credit H.
- No historical Credit H totals are imported or forced.

# PilotLog v8.4.1 — Credit Hours source hardening

- Fixed the remaining Credit Hours source defect: `schedBlock` stored/imported in an entry can no longer override Schedule OUT → Schedule IN.
- Flight Credit Hours are now derived only from Schedule OUT and Schedule IN. If either scheduled time is missing, no flight credit is derived from a stale duration field.
- Complete LogTen migration normalizes each Flight `schedBlock` from its scheduled times.
- Actual OUT/IN is never used for Flight Credit Hours.
- All v8.4.0 agreed workflow changes remain unchanged.
- Corrected README baseline wording: v8.4.x is built from v8.3.1.

# PilotLog v8.4.0 — Scheduled Credit H / agreed workflow updates

- Flight Credit Hours are now explicitly formula-driven from **Scheduled Block Hours (Schedule OUT → Schedule IN) only**. Actual OUT/IN Block never determines Credit H.
- Removed the v8.3.1 LogTen Custom Time 9 entry/month override. Credit-Hours-only LogTen patch packages are no longer applied.
- Existing 30-minute upward rounding and Morocco scheduled-departure +50% premium are retained.
- Added Logbook global search by flight number, airport/code/city, route, aircraft and crew names, with dynamic matching statistics.
- Added “Lock all entries” with explicit confirmation and affected-entry count; it changes only lock state.
- Locked Ground Course activities can be edited directly from Roster and remain locked after save.
- Added visible progress modal with percentage and processed-row count during complete LogTen migration.
- Started from v8.3.1 and preserved its local draft, simulator, backup, AeroLINE role and sync behavior.

# PilotLog v8.3.1 — Credit Hours correction only

- LogTen Custom Time 9 is authoritative for imported historical Credit Hours when supplied by the complete migration package.
- Historical monthly Credit H uses the original LogTen Custom Time 9 monthly total when available; all other Credit Hours / Payroll rules remain unchanged.
- No other PilotLog logic, workflow, UI, sync, roster, duty, simulator, trip or night-credit rule was changed.
- Added a Credit-Hours-only LogTen patch import path that updates only Custom Time 9 credit metadata on already existing LogTen IDs.

# PilotLog v8.3.0 — Local entry reliability / Simulator workflow

- Credit Hours and Payroll formulas are unchanged from v8.2.0.
- Cloud sync core functions are unchanged from v8.2.0.
- Manual Flight now associates the configured user name with the selected operational Role.
- Flight Schedule OUT now fills On Duty automatically at Schedule OUT minus 1 hour.
- Reworked unsaved Manual Flight handling into persistent local drafts; leaving/re-entering Add Flight restores work in progress.
- Return Flight preserves an unsaved outbound sector and creates a separate return draft instead of destroying the first form.
- Removed full database write/duty reconciliation/crew rescan from every Add Flight keystroke to reduce browser stalls on large LogTen archives.
- Added Reason of Delay metadata when actual OUT is later than Schedule OUT; delay data is statistical and does not affect operational/Credit calculations.
- Simplified Simulator form: Sim registration, Location, Simulator start/end, automatic report/end-duty schedule times, and no flight-only PIC/SIC/Block/IFR/seat/takeoff/landing/night calculations.
- Simulator time is kept separate from Flight Time totals.
- AeroLINE trainer metadata no longer overrides the operational cockpit Role on normal flights; two-pilot Captain-profile sectors map self to PIC and the other pilot to SIC. Ambiguous multi-crew training sectors are left for manual crew-role review rather than guessed.
- Added Restore Full Backup JSON with validation/count confirmation. Restored data remains local with Auto Sync disabled until explicitly reviewed and synced.
- Existing v7/v8 local storage/IndexedDB keys are retained so an app update does not intentionally discard current local work.
- Reinstated the semantic duplicate helper functions referenced by the v8.2 renderer/import path, preventing a pre-existing runtime error during large restore/import rendering.

# PilotLog v8.2.0 — Local-first verified cloud rebuild

- Large imports are now local-only first. Complete LogTen, LogTen Tab, AeroLINE JSON/direct import, Calendar and Roster CSV do not automatically publish to cloud.
- Fresh/reset devices default Auto Sync to disabled; bulk imports also disable Auto Sync until the user deliberately re-enables it.
- Added local verification after complete LogTen migration: every stable LogTen unique ID from the migration package must exist in the local database before the import is reported successful.
- Large complete LogTen archives skip the expensive O(n²) semantic duplicate scan when stable LogTen identities are present, preventing the browser stall seen with 7k+ rows.
- Introduced cloud protocol **db8** with verified generations. The active central database is never deleted before a replacement upload is complete.
- Cloud publish now uploads a new staging generation, verifies all expected chunks, activates it atomically via active metadata, and only then attempts cleanup of the previous generation.
- Cloud download reconstructs only the active generation and verifies section counts and digests before replacing local data.
- Additional devices determine central-database availability from cloud metadata rather than a device-local initialization flag.
- Future simulator sessions are excluded from Logbook, simulator totals and experience exports until their scheduled simulator end time has passed; they remain available in Roster/planning.
- Added possible Day Off Paid assistance: a “Thanks” memo on a flight day creates a confirmation signal; if the date was previously an OFF, the signal is strengthened to “OFF replaced by flight + Thanks memo”. PilotLog never ticks the Day Off box silently and asks the user when saving/locking the linked Logbook flight.
- Manual **Sync now** remains the explicit safety control.

# PilotLog v8.1.0 — Roster completion workflow

- Kept the v8.0.0 AeroLINE importer and Roster structure unchanged.
- Roster flight tap now opens the full existing Add Flight editor with all consolidated fields/rules.
- Added explicit **Save to Logbook**. A roster sector is marked completed only after a real Logbook save/lock.
- Completed roster sectors remain in Roster and are highlighted green; deleting the linked Logbook flight returns the sector to planned state.
- Added stable Roster ↔ Logbook link metadata while retaining semantic matching for older entries.
- Logbook UI now lists only Flights and Simulator entries. DHD/DHP/STBY/Ground remain operational data for Roster, Trips and Payroll.
- Today/Next Duties now uses Roster as the primary source for roster months and LogTen/Logbook only as fallback for months without a roster.
- Payroll now uses Roster as primary source for roster months; if no roster exists, imported LogTen Pro records are preferred as the historical fallback. Sources are not automatically mixed in a roster month.
- Trip duty/layover calculations can use planned roster flight sectors without creating fake Logbook flights.

# PilotLog Changelog

## v8.0.0 — AeroLINE roster intelligence
- Rebuilt AeroLINE JSON import around the complete monthly roster instead of flight-only display logic.
- Crew identity is checked against the PilotLog Settings name, accepting reversed first/last-name order; mismatches require explicit confirmation.
- Normal AeroLINE sectors now retain crew, fleet, registration when supplied, stable AeroLINE IDs and crew schedule block IDs.
- AeroLINE colleague is prefilled as SIC and remains editable.
- LTG / Line Training sectors are highlighted in Roster and prefilled as Flight Instruction with the PilotLog crew member as Instructor.
- Explicit ALC / Annual Line Check sectors are highlighted and prefill the PilotLog crew member in Instructor.
- RT activities import as Simulator training; first joining pilot is PIC, second joining pilot is SIC, and the PilotLog crew member is Instructor when present in trainerName.
- Full training activity names are retained in Remarks and Roster information for RT, GRT, GTS, MTG and other supported training.
- trainerType is retained as AeroLINE metadata but is not used for role/pay logic.
- DHD and DHP are separate positioning types: DHD has zero credit; DHP has editable credit and DHP credit is deducted from layover-pay time.
- Positioning outside Morocco can be recorded in Trips with company cash amount, received currency and EUR conversion.
- HSBY/STBY and AeroLINE OFF records keep their published times/status in Roster.
- Clear Roster now removes every roster-derived item (sectors, OFF, DHD/DHP, standby and training) while preserving locked Logbook entries; preserved locked entries are hidden from Roster until re-imported.
- Deleting a Roster item now removes it completely instead of creating an OFF/Blank Day replacement; Blank Day rows are no longer generated.
- AeroLINE validation import keeps CRM (first occurrence only), DGR, E-GRT, ESE, ELP, FCCA/TNR, GRT, LVC, MED, OPC, PLC, PPC, RHS, SMS, SEP, SEC and SAF; CMC, A320/IR, JSIM, TRN and WP are ignored.
- A new AeroLINE expiry is imported automatically when PilotLog has no value. If a stored expiry differs, PilotLog asks in English before updating. Blank/null AeroLINE expiry values never erase a stored PilotLog date.
- Full PilotLog backup now includes Expiry data.
- Existing PilotLog v7 storage namespace is retained intentionally so upgrading to v8 does not discard current local data.

## 7.0.1 — Complete LogTen licences + Trips import
- Complete LogTen migration now imports certificates/validities into Expiry.
- Imports original LogTen Trips using stable LogTen unique IDs.
- Re-import updates matching LogTen expiry/trip records instead of duplicating them.
- Original LogTen SQLite archive behavior is unchanged.

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

## v5.10.4
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
- Direct sync requests the structured `TrackingService/getCrewSchedule` endpoint for the selected month and feeds the response through the existing v5.10.4 AeroLINE roster importer.
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
