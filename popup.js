const $ = sel => document.querySelector(sel);
let connections = [];

document.addEventListener('DOMContentLoaded', async () => {
  $('#status').innerHTML = statusOptionsHtml('saved');
  connections = await Store.getConnections();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https?:/.test(tab.url || '')) {
    const link = cleanUrl(tab.url);
    const page = await readPageInfo(tab.id);
    const guess = guessFromTitle(tab.title, page.siteName);
    $('#link').value = link;
    $('#company').value = page.company || guess.company;
    $('#role').value = page.role || guess.role;
    $('#source').value = detectSource(link, page.siteName);

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

// Pages Chrome doesn't let extensions read (like the Web Store) just fall back to the title
async function readPageInfo(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readJobPosting });
    return result || {};
  } catch (err) {
    console.warn('Could not read the job page:', err);
    return {};
  }
}

// Runs inside the job page. Most job sites describe the job for Google as a schema.org
// JobPosting. When there are several (ads, similar jobs), the one whose title appears in
// the page title or heading is used; if none matches, only a single posting is trusted.
function readJobPosting() {
  const postings = [];
  const collect = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(collect);
    const type = [].concat(node['@type'] || []);
    if (type.includes('JobPosting')) postings.push(node);
    if (node['@graph']) collect(node['@graph']);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try { collect(JSON.parse(script.textContent)); } catch {}
  });
  // Some sites put HTML entities like &amp; inside the JSON
  const decode = text => {
    const el = document.createElement('textarea');
    el.innerHTML = String(text || '');
    return el.value.trim();
  };
  const pageText = [document.title, document.querySelector('h1')?.textContent,
    document.querySelector('meta[property="og:title"]')?.content].join(' ').toLowerCase();
  const job = postings.find(p => p.title && pageText.includes(decode(p.title).toLowerCase())) ||
    (postings.length === 1 ? postings[0] : null);
  const org = job?.hiringOrganization;
  return {
    role: decode(job?.title),
    company: decode(typeof org === 'string' ? org : org?.name),
    siteName: document.querySelector('meta[property="og:site_name"]')?.content || '',
  };
}

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
