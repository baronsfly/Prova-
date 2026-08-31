
V8.4.1 CREDIT HOURS HARD FIX
----------------------------
- Flight Credit Hours now read Scheduled Block ONLY from Schedule OUT -> Schedule IN.
- A stored/imported `schedBlock` value can no longer override the scheduled times.
- If a Flight has no Schedule OUT or Schedule IN, PilotLog returns 0 derivable flight credit instead of falling back to a stale saved duration.
- Complete LogTen imports normalize `schedBlock` from the two scheduled times on import.
- Actual OUT/IN remains operational Logbook data only and is never used for Flight Credit Hours.

PilotLog v8.4.1
================

PURPOSE
-------
PilotLog v8.4.1 is the v8.3.1 baseline with one isolated correction to imported LogTen Credit Hours. The v8.2 cloud-sync engine and all other Payroll formulas/workflows are unchanged.

UPGRADE SAFETY
--------------
- PilotLog keeps the existing stable local storage keys and IndexedDB database used by v8.2.0.
- Updating the app on the same site/origin does not intentionally reset Logbook, Roster, Trips, Expiry, settings or payroll data.
- Do not use browser “Clear site data” while local-only work has not been independently backed up.
- The v8.2 cloud-sync functions are retained unchanged.
- Flight Credit Hours are ALWAYS based on Scheduled Block Hours (Schedule OUT to Schedule IN), never Actual Block. Imported LogTen Custom Time 9 no longer overrides the formula.
- 30-minute upward rounding and the existing Morocco scheduled-departure +50% premium remain in place.

MANUAL FLIGHT / DRAFTS
----------------------
- PilotLog associates the configured profile name with the selected operational Role. Captain/PIC places the profile name in PIC Name; First Officer/SIC places it in SIC Name. Instructor/Examiner roles use the corresponding name field.
- For Flight entries, entering Schedule OUT automatically sets On Duty to Schedule OUT minus 1 hour.
- Unsaved manual entries are stored as lightweight local drafts instead of rewriting the complete flight database while typing.
- Leaving Add Flight and returning restores the active draft.
- Return Flight preserves the unsaved outbound draft and creates a separate return draft.
- The draft shelf lets the user reopen or discard unsaved manual drafts.
- Drafts are not part of Logbook, Totals, Payroll or Cloud Sync until Save/Lock creates a real entry.

DELAY REASON
------------
When actual OUT is later than Schedule OUT, PilotLog calculates the delay and requests a Reason of Delay. The reason and delay minutes are stored as dedicated statistical metadata on the flight and do not alter operational time or Credit Hours calculations.

SIMULATOR
---------
Simulator entries now use a simplified simulator-specific form:
- Aircraft ID is presented as Sim registration.
- From / To are replaced by Location.
- AeroLINE training location is imported when available.
- Simulator start and Simulator end replace flight OUT/OFF/ON/IN fields.
- Schedule OUT is generated automatically as Simulator start minus 1:30.
- Schedule IN is generated automatically as Simulator end plus 0:30.
- Night, IFR, seat position, takeoffs, landings, PIC/SIC time and flight Block are not calculated for Simulator entries.
- Simulator time remains separate from Flight Time in totals/aircraft presentation.

AEROLINE TRAINER / OPERATIONAL ROLE
-----------------------------------
AeroLINE trainer metadata is kept separate from the operational cockpit Role.
- With a Captain profile and exactly one other pilot, the PilotLog user is PIC and the other pilot is SIC, even when AeroLINE also identifies the user as TRI/TRE/TNE.
- Line Training remains marked as Flight Instruction without replacing the operational PIC assignment with Instructor.
- When AeroLINE supplies more than one other cockpit/training crew member, PilotLog does not blindly guess SIC/SO placement; those crew-role fields remain editable for review.

FULL BACKUP RESTORE
-------------------
Settings > Logbook/Experience now includes Restore Full Backup JSON.

Recommended clean-device test:
1. On the working device, use Export Full Backup JSON and keep the downloaded .json file.
2. Open PilotLog v8.4.1 on the clean/new device.
3. Choose Restore Full Backup JSON.
4. PilotLog validates the file and shows the record counts before replacing local data.
5. Review Logbook, Roster, Totals, Trips and Expiry on the new device.
6. Auto Sync remains OFF after restore. Press Sync now only after the restored database has been verified.

The Full Backup JSON restores normalized PilotLog data. The original raw archived LogTen SQLite/database file is a separate archive and is not embedded inside this JSON.

PERFORMANCE
-----------
Typing in Add Flight now writes only the lightweight local draft. It no longer writes the complete flight array, reconciles every duty, refreshes all crew suggestions and schedules cloud sync for every keystroke. Full operational persistence/reconciliation occurs on Save/Lock.

FILES
-----
- index.html
- pilotlog-8.4.1.js
- pilotlog-8.3.0.css
- sw-8.4.1.js
- manifest.webmanifest
- README_v8.txt
- CHANGELOG.md


V8.4.0 AGREED CHANGES
---------------------
- Logbook global search: flight number, airport/code/city, route, aircraft and crew names.
- Dynamic search statistics: matching entries, sectors, Block, Credit and simulator count.
- One-command “Lock all entries” with explicit confirmation and count; only lock state changes.
- Locked Ground Course activities can be edited directly from Roster; they remain locked after save.
- Complete LogTen import shows an on-screen progress modal with percentage and processed row count.
- Flight Credit H is formula-driven from Scheduled Block Hours only. Actual OUT/IN never determines Credit H.
- Credit-Hours-only LogTen patch packages are rejected because imported Custom Time no longer drives Credit H.
