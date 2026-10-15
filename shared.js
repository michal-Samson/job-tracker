// Shared data layer and helpers, used by both popup and tracker pages.
// All storage goes through Store, so it can later be swapped for Google Sheets sync.

const STATUSES = [
  { id: 'saved', label: 'טרם הוגש', color: '#6b7280' },
  { id: 'applied', label: 'הוגש', color: '#2563eb' },
  { id: 'review', label: 'בבדיקה', color: '#7c3aed' },
  { id: 'phone', label: 'שיחת טלפון', color: '#0891b2' },
  { id: 'interview', label: 'ראיון', color: '#d97706' },
  { id: 'assignment', label: 'מבחן בית', color: '#a16207' },
  { id: 'offer', label: 'הצעה', color: '#16a34a' },
  { id: 'rejected', label: 'נדחה', color: '#dc2626' },
  { id: 'irrelevant', label: 'לא רלוונטי', color: '#9ca3af' },
];
const IN_PROCESS_STATUSES = ['phone', 'interview', 'assignment'];
const WAITING_STATUSES = ['applied', 'review'];
const CONVERSATION_STATUSES = ['phone', 'interview', 'assignment', 'offer'];
const ANSWER_STATUSES = [...CONVERSATION_STATUSES, 'rejected'];
const CLOSED_STATUSES = ['rejected', 'irrelevant'];
const FOLLOWUP_DAYS = 7;

const DEFAULT_TEMPLATE = `היי {שם},
ראיתי שאת/ה עובד/ת ב-{חברה}, ושמתי לב שיש אצלכם משרה של {תפקיד}.
אשמח מאוד אם תוכל/י להעביר את קורות החיים שלי, או לספר לי קצת על הצוות.
הלינק למשרה: {לינק}
תודה רבה!`;

const JOB_FIELDS = ['company', 'role', 'link', 'source', 'referrer', 'contact', 'cvVersion', 'submitDate', 'nextDate', 'nextStep', 'notes'];

const Store = {
  async get(key, fallback) {
    const data = await chrome.storage.local.get(key);
    return data[key] ?? fallback;
  },
  set(key, value) {
    return chrome.storage.local.set({ [key]: value });
  },
  getJobs() { return this.get('jobs', []); },
  saveJobs(jobs) { return this.set('jobs', jobs); },
  async addJob(job) {
    const jobs = await this.getJobs();
    const empty = Object.fromEntries(JOB_FIELDS.map(f => [f, '']));
    const full = { ...empty, status: 'saved', foundDate: today(), ...job, id: crypto.randomUUID(), lastUpdate: today() };
    full.history = [{ status: full.status, date: today() }];
    jobs.unshift(full);
    await this.saveJobs(jobs);
    return full;
  },
  async updateJob(id, changes) {
    const jobs = await this.getJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i < 0) return;
    const job = jobs[i];
    const history = changes.status && changes.status !== job.status
      ? [...statusHistory(job), { status: changes.status, date: today() }]
      : job.history;
    jobs[i] = { ...job, ...changes, history, lastUpdate: today() };
    await this.saveJobs(jobs);
  },
  async deleteJob(id) {
    const jobs = await this.getJobs();
    await this.saveJobs(jobs.filter(j => j.id !== id));
  },
  getConnections() { return this.get('connections', []); },
  saveConnections(list) { return this.set('connections', list); },
  getTemplate() { return this.get('template', DEFAULT_TEMPLATE); },
  saveTemplate(text) { return this.set('template', text); },
};

// ---------- dates ----------
function today() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
}
function daysBetween(from, to) {
  return Math.round((new Date(to) - new Date(from)) / 86400000);
}
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return Math.floor((new Date(today()) - new Date(dateStr)) / 86400000);
}
function formatDate(dateStr) {
  return dateStr ? dateStr.split('-').reverse().join('/') : '';
}
function needsFollowup(job) {
  if (!WAITING_STATUSES.includes(job.status)) return false;
  return daysSince(job.lastUpdate || job.submitDate) >= FOLLOWUP_DAYS;
}
// Moving to "applied" with no submit date means it was submitted today;
// moving back to "saved" means it wasn't submitted after all
function statusChanges(job, status) {
  const changes = { status };
  if (status === 'applied' && !job.submitDate) changes.submitDate = today();
  if (status === 'saved') changes.submitDate = '';
  return changes;
}
function wasSubmitted(job) {
  return job.status !== 'saved' && !!job.submitDate;
}

// ---------- status history ----------
// Jobs saved before history existed get a single entry for their current status
function statusHistory(job) {
  return job.history?.length ? job.history : [{ status: job.status, date: job.lastUpdate || job.foundDate || '' }];
}
function reached(job, statuses) {
  return statusHistory(job).some(h => statuses.includes(h.status));
}
// Days from submitting to the first answer (a call, interview etc. or a rejection); null if unknown
function daysToResponse(job) {
  if (!job.submitDate || !job.history) return null;
  const first = job.history.find(h => ANSWER_STATUSES.includes(h.status));
  if (!first) return null;
  const days = daysBetween(job.submitDate, first.date);
  return days >= 0 ? days : null;
}

// ---------- next step ----------
function nextStepState(job) {
  if (!job.nextDate || CLOSED_STATUSES.includes(job.status)) return '';
  const days = daysSince(job.nextDate);
  if (days > 0) return 'overdue';
  if (days === 0) return 'today';
  if (days >= -2) return 'soon';
  return '';
}
function needsAction(job) {
  return needsFollowup(job) || ['overdue', 'today'].includes(nextStepState(job));
}

// ---------- statuses ----------
function statusById(id) {
  return STATUSES.find(s => s.id === id) || STATUSES[0];
}
function statusOptionsHtml(selected) {
  return STATUSES.map(s =>
    `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${s.label}</option>`).join('');
}

// ---------- URLs and page info ----------
function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}
// Strips tracking params so the same job isn't saved twice
function cleanUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('linkedin.com')) {
      const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1];
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    [...u.searchParams.keys()].filter(k => /^(utm_|trk|ref|refId|trackingId)/i.test(k))
      .forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}
function detectSource(url) {
  const sources = {
    'linkedin.': 'לינקדאין', 'alljobs.': 'AllJobs', 'drushim.': 'דרושים', 'jobmaster.': 'JobMaster',
    'gotfriends.': 'GotFriends', 'indeed.': 'Indeed', 'glassdoor.': 'Glassdoor', 'facebook.': 'פייסבוק',
    'comeet.': 'Comeet', 'greenhouse.': 'Greenhouse', 'lever.co': 'Lever',
  };
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const match = Object.keys(sources).find(k => host.includes(k));
    return match ? sources[match] : host;
  } catch {
    return '';
  }
}
function guessFromTitle(title = '') {
  title = title.replace(/^\(\d+\)\s*/, '');
  const hiring = title.match(/^(.+?) hiring (.+?)(?: in .+?)?\s*\|/i);
  if (hiring) return { company: hiring[1].trim(), role: hiring[2].trim() };
  const sites = /linkedin|alljobs|drushim|דרושים|jobmaster|indeed|glassdoor|comeet|greenhouse|lever/i;
  const parts = title.split(/\s+[|–—-]\s+/).map(s => s.trim()).filter(p => p && !sites.test(p));
  return { role: parts[0] || '', company: parts[1] || '' };
}
function linkedinSearchUrl(company) {
  return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(company) +
    '&network=' + encodeURIComponent('["F","S"]');
}

// ---------- LinkedIn connections ----------
function normalizeCompany(name) {
  return (name || '').toLowerCase()
    .replace(/בע"?מ|\b(ltd|inc|llc|corp|group|technologies|israel)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function findConnections(company, connections) {
  const n = normalizeCompany(company);
  if (n.length < 2) return [];
  return connections.filter(c => {
    const cn = normalizeCompany(c.company);
    if (!cn) return false;
    return cn === n || ` ${cn} `.includes(` ${n} `) || ` ${n} `.includes(` ${cn} `);
  });
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
// LinkedIn's Connections.csv starts with a few "Notes" lines before the header row
function parseLinkedInConnections(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const headerIdx = rows.findIndex(r => r[0] === 'First Name');
  if (headerIdx < 0) throw new Error('הקובץ לא נראה כמו Connections.csv של לינקדאין');
  const header = rows[headerIdx];
  const col = name => header.indexOf(name);
  return rows.slice(headerIdx + 1)
    .filter(r => r.length > 1)
    .map(r => ({
      name: `${r[col('First Name')] || ''} ${r[col('Last Name')] || ''}`.trim(),
      company: r[col('Company')] || '',
      position: r[col('Position')] || '',
      url: r[col('URL')] || '',
    }))
    .filter(c => c.name && c.company);
}

// ---------- misc ----------
function fillTemplate(template, values) {
  return template
    .replaceAll('{שם}', values.name || '')
    .replaceAll('{חברה}', values.company || '')
    .replaceAll('{תפקיד}', values.role || '')
    .replaceAll('{לינק}', values.link || '');
}
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
