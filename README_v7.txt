PilotLog 7.0.1 — CENTRAL DATABASE EDITION

ARCHITECTURE
PilotLog 7 uses Supabase/PostgreSQL as the single authoritative external database.
Each device keeps only a local cache/offline working copy. Legacy v5/v6 local stores are never loaded by PilotLog 7.

FIRST CLEAN START
1. Install/open PilotLog 7.0.1 on the device chosen to initialize the new database.
2. Sign in under Settings > PilotLog Central Database.
3. Press “Erase Old Database • Start Clean”.
4. Confirm and type RESET PILOTLOG.
5. PilotLog permanently deletes every existing PilotLog record for that Supabase user, then deeply formats both old and new PilotLog local stores on that device.
6. Sign in again. The central database is blank.
7. Import the complete LogTen migration and then AeroLINE JSON as required.
8. Use Sync now. This writes revision 1 of the new authoritative database.
9. On every other device, install PilotLog 7.0.1, use “Reset Local Cache Only”, sign in, and Sync now. With no local pending changes, the device downloads the central database and replaces its cache.

CONFLICT SAFETY
PilotLog 7 stores a central database revision. A device can upload only if its local base revision matches the server revision. If another device changed the database while this device was offline, PilotLog blocks the upload rather than overwriting or resurrecting stale data.

IDENTITY
Imported AeroLINE and LogTen entries retain deterministic/stable source-derived identities where available. Manual entries use cryptographically random UUID-based identifiers.

BACKUP
The existing local weekly backup remains. External backup/export workflows remain available. The LogTen original SQLite archive remains local and is not uploaded to the central database.

IMPORTANT
PilotLog 7 uses the existing Supabase project/account but starts from a completely purged PilotLog dataset after the clean-start action. It does not require the legacy cloud records and does not query them during normal v7 operation.


7.0.1 LOGTEN COMPLETE IMPORT
- Complete LogTen migration now imports original LogTen certificates/validities into Expiry.
- Imports original LogTen Trips into Trips.
- Stable LogTen IDs prevent duplicates on re-import; matching records are updated.
- The original SQLite database remains archived byte-for-byte locally.
