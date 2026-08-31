PILOTLOG v8.8 — NON-FLIGHT CREDIT DETAIL
=========================================================

BASE
----
Built directly from PilotLog v8.7. Existing storage keys, verified db8 cloud-generation protocol, import/export formats and the established UI are preserved; only the Ground Course credit and Payroll NF CH changes described below were added.

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
- Ground Course Credit: editable per activity. AeroLINE GI defaults to the Ground Course Settings value; AeroLINE TNE defaults to 0:00. The value can always be overridden manually.
- Simulator Credit: Settings value.
- Ground Course trip duty subtraction remains fixed at 5:00.
- Simulator actual time is independent from Flight Time.

SYNC SAFETY
-----------
The existing verified-generation db8 publish/download protocol is retained. When another device has advanced the central revision while this device also has local changes, v8.6 merges record revisions plus the permanent ledger before publishing the next verified generation. Collection-wide maintenance events do not cancel specific delete tombstones.

FILES
-----
- index.html
- pilotlog-8.8.js
- pilotlog-8.3.0.css
- sw-8.8.js
- manifest.webmanifest
- README_v8.txt
- CHANGELOG.md


v8.8 NON-FLIGHT CREDIT DETAIL
---------------------------------------
- Ground Course Credit Hours are now editable per individual activity.
- AeroLINE Ground Course defaults are inferred centrally from trainerType: GI uses the Ground Course Settings value; TNE defaults to 0:00. The JSON does not provide a direct paid-credit field.
- A manually edited Ground Course credit is preserved on later AeroLINE re-imports.
- Payroll Breakdown now shows an informational `NF CH` row directly under `Credit H`: middle value = number of non-flight activities with credit; right value = their combined credit hours.
- `NF CH` is a subset of `Credit H` only. It never adds hours and never changes payroll totals.


v8.7 ROSTER ACTIVITY DIRECT EDIT FIX
---------------------------------------
- Simulator, Ground Course, DHD, DHP and STBY opened from Roster remain editable directly from Roster even when their stored record is locked.
- Delete activity works directly from Roster and no longer asks for a Logbook unlock.
- Saving a Roster activity preserves the pre-existing locked flag.
- The Roster activity action bar uses Save changes and removes flight-only Return Flight / Clear actions.
- No sync engine, central database, ledger/tombstone, merge/revision, payroll or calculation rules were changed for this release.

v8.6 CENTRAL SNAPSHOT INTEGRITY FIX
- Snapshot content digests now use recursive canonical JSON key ordering, so Supabase/PostgreSQL jsonb key reordering cannot create false integrity failures (for example fx or trips).
- Existing pre-v8.6 db8 generations remain readable through a one-time legacy compatibility path only after strict generation, chunk-index, chunk-count and section-count validation.
- New generations are read back from Supabase and content-verified before activation.
- Merge rules, record IDs, sync ledger/tombstones, revisions, Sync now and Auto Sync behavior are otherwise unchanged.
