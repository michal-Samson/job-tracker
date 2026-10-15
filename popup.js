const $ = sel => document.querySelector(sel);
let connections = [];

document.addEventListener('DOMContentLoaded', async () => {
  $('#status').innerHTML = statusOptionsHtml('saved');
  connections = await Store.getConnections();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https?:/.test(tab.url || '')) {
    const link = cleanUrl(tab.url);
    const guess = guessFromTitle(tab.title);
    $('#link').value = link;
    $('#company').value = guess.company;
    $('#role').value = guess.role;
    $('#source').value = detectSource(link);

    const jobs = await Store.getJobs();
    const existing = jobs.find(j => j.link === link);
    if (existing) {
      $('#existing').textContent =
        `המשרה הזו כבר שמורה (${existing.company}, סטטוס: ${statusById(existing.status).label})`;
      $('#existing').hidden = false;
    }
  }
  updateConnections();
  $('#company').focus();
});

$('#company').addEventListener('input', updateConnections);

$('#status').addEventListener('change', () => {
  if ($('#status').value === 'applied' && !$('#submitDate').value) $('#submitDate').value = today();
  if ($('#status').value === 'saved') $('#submitDate').value = '';
});

$('#openTracker').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tracker.html') });
});

$('#jobForm').addEventListener('submit', async e => {
  e.preventDefault();
  await Store.addJob({
    company: $('#company').value.trim(),
    role: $('#role').value.trim(),
    link: $('#link').value.trim(),
    source: $('#source').value.trim(),
    referrer: $('#referrer').value.trim(),
    status: $('#status').value,
    submitDate: $('#submitDate').value,
    cvVersion: $('#cvVersion').value.trim(),
    notes: $('#notes').value.trim(),
  });
  $('#jobForm').hidden = true;
  $('#existing').hidden = true;
  $('#saved').hidden = false;
  setTimeout(() => window.close(), 1200);
});

function updateConnections() {
  const company = $('#company').value.trim();
  const box = $('#connections');
  if (!company) { box.hidden = true; return; }

  const search = `<a href="${esc(linkedinSearchUrl(company))}" target="_blank">חיפוש קשרים בלינקדאין ↗</a>`;
  const matches = findConnections(company, connections);
  if (matches.length) {
    const names = matches.slice(0, 4).map(c => `<li>${esc(c.name)}${c.position ? `, ${esc(c.position)}` : ''}</li>`).join('');
    const more = matches.length > 4 ? `<li>ועוד ${matches.length - 4}…</li>` : '';
    box.innerHTML = `👥 יש לך ${matches.length} קשרים ב-${esc(company)}:<ul>${names}${more}</ul>${search}`;
  } else {
    box.innerHTML = `לא נמצאו קשרים מיובאים ב-${esc(company)}. ${search}`;
  }
  box.hidden = false;
}
