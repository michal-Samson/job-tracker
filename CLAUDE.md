# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Chrome extension (Manifest V3) for tracking job applications, with a Hebrew, RTL UI. It's plain HTML/CSS/JS with no build step, package manager, bundler, linter or tests. All UI strings, status labels and the message template are in Hebrew. Keep new UI text in Hebrew and keep pages `dir="rtl"`.

## Running

- Load it in Chrome: open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose this folder.
- After changing code, click the reload (🔄) button on the extension's card at `chrome://extensions`, then reopen the popup or tracker tab.
- Debugging: right-click the popup and choose Inspect. `tracker.html` opens as a normal tab, so use DevTools there.

## Architecture

There are two pages. Each loads `shared.js` with a plain `<script>` tag, followed by its own script. There are no modules: everything in `shared.js` is a global.

- **`shared.js`**: the data layer and helpers that both pages use.
  - `Store` wraps `chrome.storage.local` with three keys: `jobs` (array, newest first), `connections` (imported LinkedIn contacts) and `template` (the outreach message). All storage access is supposed to go through `Store`, so the backend can later be swapped for Google Sheets sync. Don't call `chrome.storage` directly from the pages.
  - `STATUSES` is the ordered list of status ids, labels and colors. The order also controls status sorting in the table. `WAITING_STATUSES` and `FOLLOWUP_DAYS` drive the follow-up highlight (`needsFollowup`). `IN_PROCESS_STATUSES` feeds the stats.
  - `statusChanges()` encodes two rules: moving to `applied` sets `submitDate` to today if it is empty, and moving back to `saved` clears `submitDate`. The popup form and the tracker's edit dialog repeat both rules in their status `change` handlers. The "submitted in the last 7 days" stat counts only jobs where `wasSubmitted()` is true.
  - Page parsing: `cleanUrl` normalizes LinkedIn job URLs and strips tracking params, which is what duplicate detection relies on (it compares `link`). `guessFromTitle` pulls the company and role out of the tab title. `detectSource` maps a hostname to a source name.
  - LinkedIn: `parseLinkedInConnections` reads LinkedIn's exported `Connections.csv`, skipping the "Notes" lines above the header. `findConnections` does fuzzy company matching through `normalizeCompany`.
  - `esc()` must wrap any user or imported data that is interpolated into `innerHTML`. Rendering is done with template strings throughout.
- **`popup.html` / `popup.js`**: the toolbar action. Prefills a new job from the active tab (needs the `activeTab` permission), warns if the link is already saved, and shows matching connections.
- **`tracker.html` / `tracker.js`**: the full table, also registered as the `options_page`. It handles filtering and sorting, inline status changes, add/edit dialogs, the connections dialog with the copy-message template (placeholders `{שם}`, `{חברה}`, `{תפקיד}`, `{לינק}`), LinkedIn CSV import, CSV export (with a BOM so Excel reads the Hebrew) and JSON backup/restore (`{ version: 1, jobs, template }`). It re-renders on `chrome.storage.onChanged`, so changes made in the popup show up live.
- **`background.js`**: a service worker that loads `shared.js` with `importScripts`. It sets the toolbar badge to the number of jobs where `needsAction()` is true (a follow-up is due, or `nextDate` is today or past). It recounts whenever `jobs` changes and once an hour through `chrome.alarms`, because the count changes as days pass. Anything in `shared.js` must therefore work without a DOM.
- **Status history:** `Store.updateJob` updates `job.history` through `historyWithStatus()` whenever the status changes, and `addJob` creates the first entry. Changing to a new status adds `{ status, date }`. The exception is going back to a one-time status that is already in the history (anything outside `REPEATABLE_STATUSES`: phone, interview, assignment). That is treated as undoing a mistake, so the history is cut back to that earlier entry. Jobs saved before history existed have no `history`. `statusHistory()` fills in a single entry for them, and `daysToResponse()` ignores them. The statistics dialog in `tracker.js` is built from `reached()` and `daysToResponse()`.
- CSS: `style.css` holds the shared base styles and the design tokens (`:root` variables, including the `--accent` gradient). It also loads the bundled Rubik font from `fonts/`, so the extension makes no network requests for fonts. Status colors come from `STATUSES` and are passed to the CSS as `--c`, which `.status-select` and `.status-pill` tint with `color-mix`. `popup.css` and `tracker.css` hold page-specific styles.

## Data notes

- A job's fields are `JOB_FIELDS` plus `id` (from `crypto.randomUUID`), `status`, `foundDate` and `lastUpdate`. Dates are stored as `YYYY-MM-DD` local strings (`today()`) and shown as `DD/MM/YYYY` (`formatDate`). If you add a job field, add it to `JOB_FIELDS` and also to the CSV export columns in `tracker.js`.
- Data exists only in the user's local browser storage, and removing the extension deletes it. Don't change storage keys or the job shape in a way that breaks existing data or old backup files.
