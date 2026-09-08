PILOTLOG v11.9
===============

This build keeps the supplied v10.9 files unchanged and uses separate v11.9 assets.

AUTHORITATIVE TIME FIELDS
-------------------------
- schedBlock: Schedule IN - Schedule OUT (displayed as Schedule Block, read-only).
- block: IN - OUT for Flight, editable.
- totalFlightTime: Block for Flight only.
- multiPilot: Block for a multicrew aircraft Flight; never Simulator.
- pic: Block when the user role is PIC.
- picUS: Block when its Auto Sync option is selected.
- sic: Block when the user role is SIC.
- ifrTime: Block when its Auto Sync option is selected.
- airTime: ON - OFF for Flight.
- night: OUT - IN using airport positions and solar ephemerides.
- picNight: final Night when the user role is PIC.
- simulatorTime: final Simulator Time; normally Schedule IN - Schedule OUT, but an imported or manually entered value is preserved unless the user selects Auto Sync.
- sfiSfe: final Simulator Time only when the user selects INSTRUCTOR or EXAMINER for their own role.
- dualGiven: Block whenever Flight INSTRUCTION is selected; a manual saved override remains authoritative.
- dualReceived: Block when its Auto Sync option is selected.
- groundInstruction: Block for Ground Course.
- stbyTime: activity duration from Start/End (On Duty/Off Duty) for STBY.
- credit: established Flight rules; explicit manual value always wins. Receiving Simulator credit is blank unless imported or manually entered. Simulator INSTRUCTOR or EXAMINER proposes editable 5:00.
- totalDuty: the single Total Duty field. Flight/Simulator/Ground/STBY use Off Duty - On Duty. DHD/DHP use End - Start.

SIMULATOR CARD
--------------
Duty Type, Source, Date, Location, SIM Registration, SIM Type, Schedule OUT,
Schedule IN, Schedule Block, On Duty, Off Duty, Total Duty, PIC Name, SIC Name,
Instructor Name, Examiner Name, Credit Hours, Simulator Time, SFI/SFE, separate
INSTRUCTOR and EXAMINER checkboxes, Called From Day Off and Remarks.

LogTen instructor names are copied to Instructor Name. Importing a name never
selects INSTRUCTOR or EXAMINER and never infers Examiner from remarks.

TIME GROUP SETTINGS
-------------------
Every Show on Total, Show on Card and Auto Sync option starts OFF. Auto Sync is
calculated retroactively for past records. A manually saved value, including
0:00, always has priority.

ROSTER
------
TOT SCHEDULE, TOT DUTY and TOT CREDIT show the complete selected-month totals,
independently of the selected day. A multisector duty is counted once.

DATA SAFETY
-----------
No field substitutes for another when the required value is absent. In
particular there is no Simulator Time -> Block, Block -> Flight Time, or
type-specific Duty fallback. The updated LogTen SQL backup will be handled only
after the user supplies it; this build does not modify the user's SQL file.

v11.4 compliance corrections after v11.2 audit:
- separate Simulator Instructor and Examiner selections;
- source-authoritative LogTen SFI/SFE preservation;
- native iOS time pickers for editable duration fields;
- one Air Time field (`airTime`), no stored legacy `flight` duplicate;
- removed legacy `instructionType`, stored `trainingSector`, and `instructorFlightTime` fields.


v11.4 final compliance notes:
- Multi Pilot automatic calculation reads Aircraft Type only; legacy multiCrew is discarded and is not a calculation source.
- Ground Course GI proposes exactly 5:00 Credit Hours; TNE proposes 0:00; no generic Ground Course credit fallback is used.
- INSTRUCTION on a Flight sets Dual Given = Block independently of the Auto Sync toggle unless Dual Given has a manual saved override.


DATA AUTHORITY v11.4
- Authority is field-by-field, never whole-record.
- Manual takeover of one field protects only that field.
- Source data may update other non-manual fields.
- Calculated fallback never becomes manual merely because the activity is saved.
- On Duty: manual > source > Schedule OUT - 1:00.
- Off Duty: manual > source > Schedule IN + 0:30.


v11.9 DATA AUTHORITY / LOGTEN STATUS
- LogTen closed records remain locked and COMPLETED.
- LogTen unclosed records remain OPEN; their imported values are still trusted source values and remain included in Logbook, Totals, Payroll, exports and calculations.
- Imported LogTen fields are preserved as imported and are not replaced by AeroLINE or calculated fallbacks.
- Manual authority is field-by-field. A manual field overrides source/calculated values without turning every field in the record into manual data.
- 0 and 0:00 are real values, never treated as blank.
- SIC auto value requires the activity role to be explicitly SIC.
- Ground Instruction has no Block fallback: use a source value when available, otherwise leave it open for manual entry.
- LogTen locked/open state is never an inclusion filter. The lock is only an editing-protection flag; source values remain usable in either state.


PilotLog v11.9 — AeroLINE Simulator reporting / trainer rule
- Simulator On Duty fallback only when AeroLINE has no explicit reporting time: Simulator Start - 1:30.
- Simulator Off Duty fallback remains Simulator End + 0:30, unchanged from the existing release rule.
- When AeroLINE trainerName contains the user among multiple trainers, store only the user name in Instructor Name and select Simulator Instructor. Other trainer names are not copied into the same Instructor field.
