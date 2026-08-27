PilotLog v4.7

NEW
- Automatic Trip / Layover detection from DHD leaving Home Base until return to base
- Home Base setting (default CMN)
- Google Sheets cloud sync between iPhone and Mac
- Spreadsheet is created in the user's Google Drive on first sync
- Existing local data is preserved and merged during sync

GOOGLE SETUP REQUIRED ONCE
1. Create a Google Cloud project.
2. Enable Google Sheets API.
3. Configure OAuth consent screen.
4. Create OAuth Client ID: Web application.
5. Add Authorized JavaScript origin: https://baronsfly.github.io
6. Paste the Client ID into PilotLog > Settings.
7. Connect Google, then Sync now.

IMPORTANT
The OAuth Client ID is not a secret. Do NOT paste a client secret into PilotLog.
