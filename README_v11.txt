PILOTLOG v11.0
===============

This build keeps the supplied v10.9 files unchanged and uses separate v11.0 assets.

AUTHORITATIVE TIME FIELDS
-------------------------
- scheduleTotal: Schedule IN - Schedule OUT (displayed as Schedule Total, read-only).
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
- sfiSfe: final Simulator Time only with the combined INSTRUCTOR/EXAMINER checkbox.
- dualGiven: Block for Flight only with INSTRUCTION selected.
- dualReceived: Block when its Auto Sync option is selected.
- groundInstruction: Block for Ground Course.
- stbyTime: Block for STBY.
- credit: established Flight rules; explicit manual value always wins. Receiving Simulator credit is blank unless imported or manually entered. The combined INSTRUCTOR/EXAMINER role proposes editable 5:00.
- totalDuty: the single Total Duty field. Flight/Simulator/Ground/STBY use Off Duty - On Duty. DHD/DHP use End - Start.

SIMULATOR CARD
--------------
Duty Type, Source, Date, Location, SIM Registration, SIM Type, Schedule OUT,
Schedule IN, Schedule Total, On Duty, Off Duty, Total Duty, PIC Name, SIC Name,
Instructor Name, Examiner Name, Credit Hours, Simulator Time, SFI/SFE, the single
INSTRUCTOR/EXAMINER checkbox, Called From Day Off and Remarks.

LogTen instructor names are copied to Instructor Name. Importing a name never
selects INSTRUCTOR/EXAMINER and never infers Examiner from remarks.

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
