// Shows on the toolbar icon how many jobs need action (follow-up, or a next step due today or earlier)
importScripts('shared.js');

async function updateBadge() {
  const jobs = await Store.getJobs();
  const count = jobs.filter(needsAction).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

// Dates have no time of day, so the count only changes when a new day starts:
// recount just after midnight. The alarm is set again each time, since days aren't
// always 24 hours long (daylight saving time).
function scheduleMidnight() {
  const next = new Date();
  next.setHours(24, 1, 0, 0);
  chrome.alarms.create('badge', { when: next.getTime() });
}

function start() {
  scheduleMidnight();
  updateBadge();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(start);
chrome.storage.onChanged.addListener(changes => { if (changes.jobs) updateBadge(); });
