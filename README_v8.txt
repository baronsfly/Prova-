PilotLog v8.0.0
================

PURPOSE
-------
PilotLog v8.0.0 consolidates the AeroLINE monthly JSON workflow while preserving the existing v7.0.1 look & feel, LogTen migration/archive workflow, manual Sync now control and native-ready AeroLINE Connect components.

AEROLINE JSON IMPORT
--------------------
1. Open Roster.
2. Choose the roster month if needed.
3. Use Import AeroLINE JSON and select the monthly AeroLINE JSON file.
4. PilotLog checks crewName against the name stored in Settings. Reversed first/last-name order is accepted. If it does not match, PilotLog asks you to confirm the roster owner before importing.
5. Re-importing the month updates matching AeroLINE records instead of intentionally duplicating them.

ROSTER / LOGBOOK MAPPING
------------------------
- Normal sectors: flight number, From/To, scheduled times, A320/fleet type, registration when supplied, AeroLINE flight ID and crew schedule block ID are retained.
- The other operating crew member is prefilled as SIC and remains editable.
- LTG / Line Training: highlighted in Roster and prefilled as Flight Instruction; the PilotLog crew member is placed in Instructor.
- Explicit ALC / Annual Line Check: highlighted in Roster and the PilotLog crew member is placed in Instructor. PilotLog does not guess ALC from vague descriptions.
- RT / Recurrent Training: imported as Simulator. First joining pilot -> PIC; second joining pilot -> SIC. If the PilotLog crew member appears in trainerName, that name is placed in Instructor. When multiple trainer names are present, PilotLog only auto-fills the PilotLog crew member and leaves special cases for manual editing.
- GRT / GTS / MTG and other training: the complete AeroLINE activity/module name is preserved in Remarks and shown in Roster information.
- trainerType is stored as metadata only and is not used to calculate roles or pay.

POSITIONING / STANDBY
---------------------
- DHD and DHP are separate duty types.
- DHD always has 0:00 credit.
- DHP credit is editable and its credit minutes are deducted from paid layover time under the existing Trip calculation rules.
- DHD/DHP times from AeroLINE are imported when available. Routes can be completed manually when AeroLINE does not provide them.
- A positioning movement outside Morocco can carry a company cash-payment record in Trips: amount received, received currency and EUR conversion.
- HSBY/STBY imports with its AeroLINE start/end times.
- OFF remains visible as an AeroLINE Day OFF while it exists in the imported roster.

CLEAR / DELETE BEHAVIOUR
------------------------
- Clear Roster removes all roster-derived sectors, OFF, DHD, DHP, standby and training activities.
- Locked/confirmed Logbook entries are preserved. If they originated from AeroLINE, Clear Roster hides them from the Roster rather than deleting the real Logbook record.
- Delete in Roster is a real delete. PilotLog does not create a replacement OFF or Blank Day.
- Blank Day placeholder rows are no longer generated.

AEROLINE EXPIRY RULES
---------------------
Imported/kept:
CRM (first occurrence only), DGR, E-GRT, ESE, ELP, FCCA/TNR, GRT, LVC, MED, OPC, PLC, PPC, RHS, SMS, SEP, SEC, SAF.

Ignored:
CMC, A320/IR, JSIM, TRN, WP.

Update behaviour:
- No PilotLog expiry + valid AeroLINE date -> import directly.
- Same date -> no prompt.
- Different stored date -> English confirmation prompt before changing it.
- Blank/null AeroLINE date -> never erase the PilotLog value.

BACKUP / COMPATIBILITY
----------------------
- Full backup JSON includes Expiry data.
- The existing PilotLog v7 local storage namespace is intentionally preserved so users upgrading to v8 retain their existing local data.
- LogTen complete migration/archive remains available.

FILES
-----
- index.html
- pilotlog-8.0.0.js
- pilotlog-8.0.0.css
- sw-8.0.0.js
- manifest.webmanifest
- README_v8.txt
- CHANGELOG.md
