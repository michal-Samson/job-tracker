const $ = sel => document.querySelector(sel);

let jobs = [];
let connections = [];
let template = '';
let sortKey = 'foundDate';
let sortDir = -1;
let editingId = null;
let editingHistory = null;

document.addEventListener('DOMContentLoaded', async () => {
  $('#statusFilter').innerHTML = '<option value="">כל הסטטוסים</option>' + statusOptionsHtml('');
  $('#jobForm').elements.status.innerHTML = statusOptionsHtml('saved');
  await load();
});

// Keep in sync when the popup adds a job while this page is open
chrome.storage.onChanged.addListener(load);

async function load() {
  [jobs, connections, template] = await Promise.all([
    Store.getJobs(), Store.getConnections(), Store.getTemplate(),
  ]);
  render();
}

// ---------- rendering ----------
function render() {
  renderStats();
  renderTable();
  $('#connInfo').textContent = connections.length
    ? `👥 ${connections.length} קשרים מיובאים מלינקדאין`
    : 'לא יובאו קשרים מלינקדאין (בתפריט "עוד")';
}

function renderStats() {
  const stats = [
    { icon: '💼', lbl: 'סה"כ משרות', num: jobs.length },
    { icon: '📤', lbl: 'הוגשו ב-7 הימים האחרונים', num: jobs.filter(j => wasSubmitted(j) && daysSince(j.submitDate) < 7).length },
    { icon: '💬', lbl: 'בתהליך (שיחה/ראיון/מבחן)', num: jobs.filter(j => IN_PROCESS_STATUSES.includes(j.status)).length },
    { icon: '🎉', lbl: 'הצעות עבודה', num: jobs.filter(j => j.status === 'offer').length },
    { icon: '⏰', lbl: 'כדאי לשלוח פולואפ', num: jobs.filter(needsFollowup).length, warn: true },
    { icon: '📌', lbl: 'צעדים להיום', num: jobs.filter(j => ['overdue', 'today'].includes(nextStepState(j))).length, warn: true },
  ];
  $('#stats').innerHTML = stats.map(s =>
    `<div class="stat${s.warn && s.num ? ' warn' : ''}"><div class="icon">${s.icon}</div><div><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div></div>`
  ).join('');
}

function visibleJobs() {
  const q = $('#search').value.trim().toLowerCase();
  const status = $('#statusFilter').value;
  const followupOnly = $('#followupOnly').checked;
  const statusOrder = id => STATUSES.findIndex(s => s.id === id);
  // Jobs without a next step go last when sorting by it
  const sortValue = j => sortKey === 'status' ? statusOrder(j.status)
    : sortKey === 'nextDate' ? (j.nextDate || (sortDir === 1 ? '9999' : ''))
    : (j[sortKey] || '');

  return jobs
    .filter(j => !status || j.status === status)
    .filter(j => !followupOnly || needsAction(j))
    .filter(j => !q || [j.company, j.role, j.notes, j.referrer, j.source, j.contact, j.cvVersion]
      .some(v => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
    });
}

function renderTable() {
  const list = visibleJobs();
  $('#tbody').innerHTML = list.map(rowHtml).join('');
  $('#empty').hidden = list.length > 0;
  $('#empty').textContent = jobs.length
    ? 'אין משרות שמתאימות לסינון.'
    : 'אין עדיין משרות. נכנסים לדף של משרה ולוחצים על אייקון התוסף, או על "+ משרה חדשה".';

  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    th.classList.toggle('asc', th.dataset.sort === sortKey && sortDir === 1);
  });
}

function rowHtml(j) {
  const status = statusById(j.status);
  const matches = findConnections(j.company, connections);
  const followup = needsFollowup(j);
  const link = safeUrl(j.link);
  return `
    <tr data-id="${j.id}" class="${needsAction(j) ? 'followup' : ''}">
      <td class="date">${formatDate(j.foundDate)}</td>
      <td>
        <div class="company">
          <span class="avatar" style="--h:${companyHue(j.company)}">${esc([...(j.company || '?').trim()][0] || '?')}</span>
          <strong>${link ? `<a href="${esc(link)}" target="_blank" title="פתיחת המשרה">${esc(j.company)} ↗</a>` : esc(j.company)}</strong>
          ${j.notes ? `<span class="has-notes" title="${esc(j.notes)}">📝</span>` : ''}
        </div>
      </td>
      <td class="role">${esc(j.role)}</td>
      <td>
        <select class="status-select" data-action="status" style="--c:${status.color}">${statusOptionsHtml(j.status)}</select>
        ${followup ? `<div class="followup-tag">⏰ ${daysSince(j.lastUpdate)} ימים בלי עדכון</div>` : ''}
      </td>
      <td>${nextStepHtml(j)}</td>
      <td><button class="small conn-btn${matches.length ? ' has' : ''}" data-action="connections">${matches.length ? `👥 ${matches.length}` : '🔍 חיפוש'}</button></td>
    </tr>`;
}

// A stable color per company, so the same company always gets the same avatar
function companyHue(name = '') {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}

function nextStepHtml(j) {
  if (!j.nextDate && !j.nextStep) return '';
  const state = nextStepState(j);
  const when = { overdue: 'עבר התאריך', today: 'היום', soon: 'בקרוב' }[state];
  return `<div class="next-step ${state}">
    <div class="next-top">
      ${j.nextDate ? `<span class="next-chip">📅 ${esc(formatDate(j.nextDate))}${when ? ` · ${when}` : ''}</span>` : ''}
      <button class="step-done" data-action="step-done" title="סימון שבוצע">✓</button>
    </div>
    ${j.nextStep ? `<div class="next-text">${esc(j.nextStep)}</div>` : ''}
  </div>`;
}

// ---------- table interactions ----------
$('#search').addEventListener('input', renderTable);
$('#statusFilter').addEventListener('change', renderTable);
$('#followupOnly').addEventListener('change', renderTable);

document.querySelector('thead').addEventListener('click', e => {
  const key = e.target.closest('th[data-sort]')?.dataset.sort;
  if (!key) return;
  sortDir = key === sortKey ? -sortDir : 1;
  sortKey = key;
  renderTable();
});

$('#tbody').addEventListener('change', async e => {
  if (e.target.dataset.action !== 'status') return;
  const job = jobs.find(j => j.id === e.target.closest('tr').dataset.id);
  await Store.updateJob(job.id, statusChanges(job, e.target.value));
});

// Clicking a row opens the job, except on its own controls (status, link, step done, connections)
$('#tbody').addEventListener('click', async e => {
  const row = e.target.closest('tr');
  if (!row || e.target.closest('a, select')) return;
  const job = jobs.find(j => j.id === row.dataset.id);
  const action = e.target.closest('button')?.dataset.action;
  if (action === 'connections') openConnDialog(job);
  else if (action === 'step-done') {
    await Store.completeStep(job.id);
    toast('✓ הצעד סומן כבוצע ונשמר בהיסטוריה');
  } else openJobDialog(job);
});

// ---------- add / edit dialog ----------
$('#addJob').addEventListener('click', () => openJobDialog(null));

function openJobDialog(job) {
  editingId = job?.id || null;
  const form = $('#jobForm');
  form.reset();
  $('#jobDialogTitle').textContent = job ? [job.company, job.role].filter(Boolean).join(' · ') : 'משרה חדשה';
  $('#deleteJob').hidden = !job;
  $('#completeStep').hidden = !job;
  const values = job || { foundDate: today(), status: 'saved' };
  [...JOB_FIELDS, 'foundDate', 'status'].forEach(f => { form.elements[f].value = values[f] || ''; });
  editingHistory = job?.history?.length ? [...job.history] : null;
  renderHistory();
  $('#jobDialog').showModal();
}

// The last entry is the current status, so it can't be removed
// The last status entry is the current status, so it can't be removed; finished steps always can
function renderHistory() {
  const history = editingHistory || [];
  const current = history.findLastIndex(h => h.status);
  $('#jobHistory').innerHTML = !history.length ? '' :
    '<label>היסטוריה</label><ol class="history">' + history.map((h, i) => {
      const remove = i !== current
        ? `<button type="button" class="remove-history" data-index="${i}" title="מחיקה מההיסטוריה">✕</button>` : '';
      const pill = h.status
        ? `<span class="status-pill" style="--c:${statusById(h.status).color}">${statusById(h.status).label}</span>`
        : `<span class="step-pill">✓ ${esc(h.step)}</span>`;
      return `<li>${pill} ${esc(formatDate(h.date))}${remove}</li>`;
    }).join('') + '</ol>';
}

// Removing an entry takes effect only when the form is saved
$('#jobHistory').addEventListener('click', e => {
  const index = e.target.closest('[data-index]')?.dataset.index;
  if (index === undefined) return;
  editingHistory.splice(Number(index), 1);
  // The same status twice in a row would read as a duplicate, so keep only the first
  let previous = null;
  editingHistory = editingHistory.filter(h => {
    if (!h.status) return true;
    if (h.status === previous) return false;
    previous = h.status;
    return true;
  });
  renderHistory();
});

// Marking the next step done moves it into the history; saved with the form
$('#completeStep').addEventListener('click', () => {
  const form = $('#jobForm');
  if (!form.elements.nextStep.value.trim() && !form.elements.nextDate.value) return;
  const job = jobs.find(j => j.id === editingId);
  editingHistory = [...(editingHistory || (job ? statusHistory(job) : [])),
    completedStepEntry({ nextStep: form.elements.nextStep.value })];
  form.elements.nextStep.value = '';
  form.elements.nextDate.value = '';
  renderHistory();
});

$('#jobForm').elements.status.addEventListener('change', e => {
  const form = $('#jobForm');
  if (e.target.value === 'applied' && !form.elements.submitDate.value) form.elements.submitDate.value = today();
  if (e.target.value === 'saved') form.elements.submitDate.value = '';
});

$('#jobForm').addEventListener('submit', async () => {
  const form = $('#jobForm');
  const data = Object.fromEntries([...JOB_FIELDS, 'foundDate', 'status'].map(f => [f, form.elements[f].value.trim()]));
  data.link = data.link ? cleanUrl(data.link) : '';
  if (editingId) {
    if (editingHistory) data.history = editingHistory;
    await Store.updateJob(editingId, data);
    toast('השינויים נשמרו');
  } else {
    await Store.addJob(data);
    toast('המשרה נוספה');
  }
});

$('#deleteJob').addEventListener('click', async () => {
  const job = jobs.find(j => j.id === editingId);
  if (!job || !confirm(`למחוק את המשרה ב-${job.company}?`)) return;
  $('#jobDialog').close();
  await Store.deleteJob(job.id);
  toast('המשרה נמחקה');
});

// ---------- connections dialog ----------
function openConnDialog(job) {
  const matches = findConnections(job.company, connections);
  $('#connTitle').textContent = `קשרים ב-${job.company}`;
  $('#connSearch').href = linkedinSearchUrl(job.company);

  if (!connections.length) {
    $('#connBody').innerHTML = `<p class="muted">עדיין לא ייבאת את רשימת הקשרים שלך מלינקדאין, אז אפשר רק לחפש ישירות בלינקדאין.
      לייבוא: תפריט "עוד" ← "ייבוא קשרים מלינקדאין".</p>`;
  } else if (!matches.length) {
    $('#connBody').innerHTML = `<p class="muted">לא נמצאו קשרים מדרגה ראשונה ב-${esc(job.company)}.
      בחיפוש בלינקדאין אפשר לראות גם קשרים מדרגה שנייה (חברים של חברים).</p>`;
  } else {
    $('#connBody').innerHTML = '<ul class="conn-list">' + matches.map((c, i) => `
      <li>
        <div>
          <div>${safeUrl(c.url) ? `<a href="${esc(c.url)}" target="_blank">${esc(c.name)}</a>` : esc(c.name)}</div>
          <div class="pos">${esc(c.position)}</div>
        </div>
        <button class="small" data-copy="${i}">📋 העתקת הודעה</button>
      </li>`).join('') + '</ul>';

    $('#connBody').querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
      const c = matches[btn.dataset.copy];
      const firstName = c.name.split(' ')[0];
      await navigator.clipboard.writeText(fillTemplate(template, {
        name: firstName, company: job.company, role: job.role, link: job.link,
      }));
      toast(`ההודעה ל${firstName} הועתקה. אפשר להדביק בלינקדאין`);
    }));
  }
  $('#connDialog').showModal();
}

// ---------- insights dialog ----------
$('#openInsights').addEventListener('click', () => {
  closeMenu();
  $('#insightsBody').innerHTML = insightsHtml();
  $('#insightsDialog').showModal();
});

function percent(n, total) {
  return total ? `${Math.round(n / total * 100)}%` : '–';
}

function insightsHtml() {
  const submitted = jobs.filter(j => j.status !== 'saved' &&
    (j.submitDate || reached(j, ['applied', 'review', ...ANSWER_STATUSES])));
  if (!submitted.length) return '<p class="muted">עדיין אין משרות שהוגשו, אז אין מה לחשב.</p>';

  const answered = submitted.filter(j => reached(j, ANSWER_STATUSES)).length;
  const talked = submitted.filter(j => reached(j, CONVERSATION_STATUSES)).length;
  const times = submitted.map(daysToResponse).filter(d => d !== null);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  const summary = [
    { lbl: 'הוגשו', num: submitted.length },
    { lbl: 'קיבלו תשובה', num: percent(answered, submitted.length) },
    { lbl: 'הגיעו לשיחה או ראיון', num: percent(talked, submitted.length) },
    { lbl: avg === null ? 'זמן ממוצע עד תשובה' : `זמן ממוצע עד תשובה (לפי ${times.length} משרות)`, num: avg === null ? '–' : `${avg} ימים` },
  ];
  return `<div class="stats">${summary.map(s =>
    `<div class="stat"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>`).join('')}</div>
    ${breakdownHtml(submitted, 'source', 'מקור')}
    ${breakdownHtml(submitted, 'cvVersion', 'גרסת קו"ח')}
    <p class="muted">הזמן עד תשובה נמדד רק למשרות שהסטטוס שלהן השתנה מאז שנוספה היסטוריית הסטטוסים.</p>`;
}

function breakdownHtml(list, key, title) {
  const groups = {};
  list.forEach(j => {
    const name = (j[key] || '').trim() || 'לא צוין';
    (groups[name] ||= []).push(j);
  });
  const rows = Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, group]) => {
      const talked = group.filter(j => reached(j, CONVERSATION_STATUSES)).length;
      return `<tr><td>${esc(name)}</td><td>${group.length}</td><td>${talked}</td><td>${percent(talked, group.length)}</td></tr>`;
    }).join('');
  return `<h3>לפי ${title}</h3>
    <table class="insights-table">
      <thead><tr><th>${title}</th><th>הוגשו</th><th>שיחה/ראיון</th><th>אחוז</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------- template dialog ----------
$('#editTemplate').addEventListener('click', () => {
  closeMenu();
  $('#templateText').value = template;
  $('#templateDialog').showModal();
});
$('#resetTemplate').addEventListener('click', () => { $('#templateText').value = DEFAULT_TEMPLATE; });
$('#templateForm').addEventListener('submit', async () => {
  await Store.saveTemplate($('#templateText').value);
  toast('התבנית נשמרה');
});

// ---------- import LinkedIn connections ----------
$('#importConnections').addEventListener('click', () => {
  closeMenu();
  $('#importDialog').showModal();
});
$('#chooseConnFile').addEventListener('click', () => $('#connFile').click());
$('#connFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const list = parseLinkedInConnections(await file.text());
    await Store.saveConnections(list);
    $('#importDialog').close();
    toast(`יובאו ${list.length} קשרים ✓`);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- export / backup / restore ----------
$('#exportCsv').addEventListener('click', () => {
  const columns = [
    ['foundDate', 'תאריך'], ['company', 'חברה'], ['role', 'תפקיד'], ['link', 'לינק'],
    ['source', 'מקור'], ['referrer', 'מי מעביר קו"ח'], ['submitDate', 'תאריך הגשה'],
    ['status', 'סטטוס'], ['cvVersion', 'גרסת קו"ח'], ['contact', 'איש קשר'],
    ['nextDate', 'תאריך הצעד הבא'], ['nextStep', 'הצעד הבא'],
    ['lastUpdate', 'עדכון אחרון'], ['notes', 'הערות'],
  ];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = jobs.map(j => columns.map(([key]) => {
    if (key === 'status') return cell(statusById(j.status).label);
    if (key.endsWith('Date') || key === 'lastUpdate') return cell(formatDate(j[key]));
    return cell(j[key]);
  }).join(','));
  const csv = '﻿' + [columns.map(([, label]) => cell(label)).join(','), ...rows].join('\r\n');
  download(`משרות-${today()}.csv`, csv, 'text/csv;charset=utf-8');
});

$('#backup').addEventListener('click', () => {
  closeMenu();
  download(`גיבוי-משרות-${today()}.json`, JSON.stringify({ version: 1, jobs, template }, null, 2), 'application/json');
});

$('#restore').addEventListener('click', () => {
  closeMenu();
  $('#restoreFile').click();
});
$('#restoreFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.jobs)) throw new Error();
    if (!confirm(`השחזור יחליף את ${jobs.length} המשרות הקיימות ב-${data.jobs.length} משרות מהגיבוי. להמשיך?`)) return;
    await Store.saveJobs(data.jobs);
    if (data.template) await Store.saveTemplate(data.template);
    toast('הנתונים שוחזרו ✓');
  } catch {
    toast('הקובץ לא תקין');
  }
});

// ---------- helpers ----------
document.querySelectorAll('dialog .cancel').forEach(btn =>
  btn.addEventListener('click', () => btn.closest('dialog').close()));

function closeMenu() {
  document.querySelector('.menu').open = false;
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toast(message) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
