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
