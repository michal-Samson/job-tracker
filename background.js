// Shows on the toolbar icon how many jobs need action (follow-up, or a next step due today or earlier)
importScripts('shared.js');

async function updateBadge() {
  const jobs = await Store.getJobs();
  const count = jobs.filter(needsAction).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

// Dates move on even when nothing changes, so recount every hour
function start() {
  chrome.alarms.create('badge', { periodInMinutes: 60 });
  updateBadge();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(updateBadge);
chrome.storage.onChanged.addListener(changes => { if (changes.jobs) updateBadge(); });
