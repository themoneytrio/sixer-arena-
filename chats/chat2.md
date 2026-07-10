# Cricket turf feature request

_Started 2026-07-09 09:04 UTC_

---

## User

bring some changes sucha as remove multiple sports and create only one cricket turf also keep it  such that the owner can add or remove different sports and different nummber of turf

## Assistant

_[tool: read_file]_

_[tool: read_file]_

I'll read the standalone file reference and then make the changes to both apps.

_[tool: update_todos]_

Starting with the customer app — reducing to a single cricket turf while keeping it config-driven.

_[tool: str_replace_edit]_

_[tool: grep]_

Customer app clean (remaining `sportIdx` is just a param name). Now the owner console — logic edits first.

_[tool: str_replace_edit]_

Now the owner `renderVals` — nav, dynamic courts, walk-in turf, analytics, and venue-setup view models.

_[tool: str_replace_edit]_

Now the owner template — dynamic calendar grid, the Venue setup section, and walk-in turf picker.

_[tool: str_replace_edit]_

_[tool: grep]_

Verifying the owner console renders (dashboard is default, no splash gate).

_[tool: show_html]_

_[tool: show_html]_

_[tool: get_webview_logs]_

Owner console clean. Checking the customer app loads without errors.

_[tool: show_html]_

_[tool: get_webview_logs]_

Both apps load cleanly. Let me mark progress and hand off for verification.

_[tool: update_todos]_

Done. Both apps now start from **one cricket turf** and are fully config-driven.

**Customer app** — the multi-sport picker is gone. It shows a single "Cricket Turf" card (full-width), then date → slots. If the owner later adds sports/turfs, a sport filter row and multiple turf cards appear automatically.

**Owner console** — new **Venue setup** section (sidebar) where the owner can:
- Add/remove sports, rename them, set ₹/hr, pick an emoji
- Add/remove turfs, name them, assign a sport, set surface
- Keeps at least one of each; changes save instantly and the dashboard slot-control, calendar columns, and walk-in modal all rebuild from the config.

The two share a config key, so what the owner sets up flows to the customer app (both default to the single cricket turf on a fresh load).

Two notes: the old `Sixer Arena (standalone).html` export still contains the previous multi-sport version — tell me if you want it refreshed. And since these are separate prototype files, the owner→customer sync happens on the customer app's next load, not live.

_[tool: ready_for_verification]_

I'll end my turn here — the verifier is checking the customer app in the background and will flag anything that needs fixing.

