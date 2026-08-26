PilotLog v4.1

Fixes:
- Rewritten bottom navigation using delegated click handling.
- All app setup waits for DOMContentLoaded.
- Old PilotLog service workers are automatically unregistered.
- Old PilotLog caches are automatically deleted.
- Visible v4.1 badge added to the header.
- Existing locally saved flights/roster/duty remain in localStorage.

GitHub Pages update:
Upload and replace index.html, app.js, styles.css, manifest.webmanifest and sw.js in the repository root, then commit.
Open https://baronsfly.github.io/Prova-/ in Safari. You should see v4.1 at the top.
