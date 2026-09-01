PILOTLOG v8.9 — TRIP CASH / GLOBAL CURRENCY / EXPIRY DEDUPE / TRAINING PAY
============================================================================

BASE
----
Built directly from PilotLog v8.8. Existing storage keys, db8 cloud sync protocol, roster/logbook architecture, Credit Hours engine and established UI are preserved. This release changes only the agreed monetary, Expiry duplicate and Training Sector/manual-authority rules.

WHAT CHANGED
------------
1. Trip Cash Received > 0 suppresses Layover Pay for that trip. Layover time is still shown, but the monetary layover allowance is zero.
2. Settings now contains one global Currency used by Payroll and Trips. MAD/DHM remains the canonical payroll contract currency underneath.
3. Cash Received currency is selected per trip. Quick choices are USD, TRY and EUR; the selector also exposes the wider ISO currency list.
4. Trip cash FX is taken from the Trip Start date. The resolved source/target rate and FX date are stored in the trip and reused; it is not refreshed later for the same trip/date/currency pair.
5. The same centralized FX source/functions are used for Trips and Payroll instead of separate conversion implementations.
6. Payroll result and monetary breakdown use the single Currency selected in Settings. The previous separate DHM + indicative EUR result has been removed.
7. Existing Expiry duplicates are semantically consolidated at startup when they represent the same qualification/course, including cross-source LogTen/AeroLINE records such as SMS.
8. AeroLINE validation re-import matches an existing equivalent LogTen/manual/AeroLINE validation and updates/attaches source metadata instead of creating a second record.
9. Training Sector allowance remains 500 DHM per sector by default, but AeroLINE training is only a prefill. A planned AeroLINE sector does not earn Training Sector pay until a Logbook entry has been saved.
10. For a saved roster sector, the final saved Logbook value is authoritative. Saved Flight Instruction = training pay; saved No/blank = no training pay.
11. Explicit user saves set manualOverride on operational entries/activities so later imports cannot silently replace the final saved calculation-relevant value.

CURRENCY / FX RULES
-------------------
- Global Currency is stored in Settings. Default: MAD (displayed as DHM).
- Payroll contract/rate inputs remain stored in MAD/DHM to preserve existing salary configuration and history.
- Payroll output is converted to the selected Currency through the shared FX engine.
- Trip cash can be received in a different source currency from the global Currency.
- Trip cash conversion uses the Trip Start date (or the nearest prior available market-rate date returned by the online source).
- Once a rate is stored for the same Trip Start date + source currency + selected target currency, reopening/editing the trip reuses the frozen stored rate.
- Changing the global Currency creates/uses a historical conversion for the same original Trip Start date; it does not replace the previously stored currency-pair rate.

TRAINING SECTOR PAY
-------------------
- Default Training Sector rate: 500 MAD/DHM per sector (editable in Payroll Settings as before).
- AeroLINE may prefill Flight Instruction in the editor.
- Uncompleted/planned AeroLINE training alone does not generate Training Sector pay.
- Saving the individual flight entry with Flight Instruction generates the allowance.
- Saving the individual flight entry with No/blank removes the allowance from Payroll.

EXPIRY DEDUPLICATION
--------------------
- Recurrent-course identity is normalized across source wording/aliases.
- Equivalent LogTen/AeroLINE/manual records are represented by one active Expiry item.
- Existing same-qualification duplicates are consolidated without duplicating data on the next AeroLINE import.
- Locked/manual records remain protected from automatic expiry replacement; source identity metadata can still be attached so future imports recognize the record.

SYNC / STORAGE
--------------
- No cloud protocol redesign was introduced in v8.9.
- Existing db8 sync generation, ledger/tombstones, IndexedDB flight storage, backup schema and storage keys are retained.
- New Currency/FX and manual-authority fields travel naturally inside the existing settings/trip/entry records.

FILES
-----
- index.html
- pilotlog-8.9.js
- pilotlog-8.3.0.css
- sw-8.9.js
- manifest.webmanifest
- README_v8.txt
- CHANGELOG.md
