// Quick lead-quality tiers — the whole point of this extension per the
// original brief: whenever you think a profile is a good lead, one click
// tags it and pushes it to the CRM, instead of manually typing a tag every
// time. Edit this list to change the tier set; nothing else needs updating,
// tiers are stored as plain CRM tags, not a separate field.
const QUALITY_TIERS = ['Excellent Fit', 'Good Fit', 'Future Fit', 'Indian', 'Worth Trying'];

let allProfiles = {};
let selectedId = null;
// Pre-filled so a fresh install works against production without the user
// having to know the URL — still fully editable in Settings (e.g. to point
// at a local dev CRM instead).
const DEFAULT_CRM_URL = 'https://skarion-crm-platform.skarion-talentos.workers.dev';
let crmSettings = { crmUrl: DEFAULT_CRM_URL, apiKey: '' };
let leadTags = [];

const statCount   = document.getElementById('statCount');
const statToday   = document.getElementById('statToday');
const searchInput = document.getElementById('searchInput');
const profileList = document.getElementById('profileList');
const detail      = document.getElementById('detail');
const btnExport   = document.getElementById('btnExport');
const btnClear    = document.getElementById('btnClear');
const btnCapture  = document.getElementById('btnCaptureNow');

// --- Settings (CRM URL + API key), saved per-device ---
const btnSettings      = document.getElementById('btnSettings');
const settingsPanel    = document.getElementById('settingsPanel');
const setCrmUrl        = document.getElementById('setCrmUrl');
const setApiKey        = document.getElementById('setApiKey');
const btnSaveSettings  = document.getElementById('btnSaveSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const settingsStatus   = document.getElementById('settingsStatus');

// --- Lead form (send captured profile to CRM) ---
const leadForm         = document.getElementById('leadForm');
const lfFirstName      = document.getElementById('lfFirstName');
const lfLastName       = document.getElementById('lfLastName');
const lfEmail          = document.getElementById('lfEmail');
const lfPhone          = document.getElementById('lfPhone');
const lfCompanyName    = document.getElementById('lfCompanyName');
const lfCompanyDomain  = document.getElementById('lfCompanyDomain');
const lfLinkedinUrl    = document.getElementById('lfLinkedinUrl');
const lfStatus         = document.getElementById('lfStatus');
const lfOutreachStatus = document.getElementById('lfOutreachStatus');
const lfTagList        = document.getElementById('lfTagList');
const lfTagInput       = document.getElementById('lfTagInput');
const lfNotes          = document.getElementById('lfNotes');
const lfStatusLine     = document.getElementById('lfStatusLine');
const btnSendLead      = document.getElementById('btnSendLead');
const btnCancelLead    = document.getElementById('btnCancelLead');

chrome.storage.local.get(['crmSettings'], data => {
  if (data.crmSettings && data.crmSettings.crmUrl) {
    crmSettings = data.crmSettings;
  }
  setCrmUrl.value = crmSettings.crmUrl || '';
  setApiKey.value = crmSettings.apiKey || '';
});

btnSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});
btnCloseSettings.addEventListener('click', () => {
  settingsPanel.classList.remove('open');
});
// Normalizes whatever the user types (with/without scheme, with/without
// trailing slash) into an absolute http(s) URL. Without this, a bare value
// like "localhost:8788" gets resolved by fetch() as a path relative to the
// extension's own chrome-extension:// origin instead of an actual host,
// which fails instantly with an opaque "Failed to fetch".
function normalizeCrmUrl(raw) {
  let url = raw.trim().replace(/\/$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

btnSaveSettings.addEventListener('click', () => {
  const crmUrl = normalizeCrmUrl(setCrmUrl.value);
  setCrmUrl.value = crmUrl;
  crmSettings = { crmUrl, apiKey: setApiKey.value.trim() };
  chrome.storage.local.set({ crmSettings }, () => {
    settingsStatus.textContent = crmUrl ? `Saved: ${crmUrl}` : 'Saved.';
    settingsStatus.className = 'status-line';
    setTimeout(() => { settingsStatus.textContent = ''; }, 3000);
  });
});

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function todayCount(profiles) {
  const today = new Date().toDateString();
  return Object.values(profiles).filter(p => new Date(p.capturedAt).toDateString() === today).length;
}

function render(filter = '') {
  const q = filter.toLowerCase();
  const sorted = Object.values(allProfiles)
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
    .filter(p => !q || [p.name, p.headline, p.location, p.currentCompanies].join(' ').toLowerCase().includes(q));

  statCount.textContent = Object.keys(allProfiles).length;
  statToday.textContent = todayCount(allProfiles);
  btnExport.disabled = Object.keys(allProfiles).length === 0;

  if (sorted.length === 0) {
    profileList.style.display = 'none';
    return;
  }

  profileList.style.display = 'block';
  profileList.innerHTML = sorted.map(p => `
    <div class="profile-item${selectedId === p.profileId ? ' selected' : ''}" data-id="${esc(p.profileId)}">
      <div class="profile-dot"></div>
      <div class="profile-info">
        <div class="profile-name">${esc(p.name)}</div>
        <div class="profile-sub">${esc(p.headline || p.location || '—')}</div>
        <div class="profile-time">${esc(p.location || '')} · ${timeAgo(p.capturedAt)}</div>
      </div>
    </div>
  `).join('');

  profileList.querySelectorAll('.profile-item').forEach(el => {
    el.addEventListener('click', () => showDetail(el.dataset.id));
  });
}

function showDetail(id) {
  selectedId = id;
  const p = allProfiles[id];
  if (!p) return;

  render(searchInput.value);

  const sections = [
    p.about       && { title: 'About',           body: p.about },
    p.experience  && { title: 'Experience',       body: p.experience },
    p.education   && { title: 'Education',        body: p.education },
    p.skills      && { title: 'Skills',           body: p.skills },
    p.certifications && { title: 'Certifications', body: p.certifications },
  ].filter(Boolean);

  detail.style.display = 'block';
  detail.innerHTML = `
    <h3>${esc(p.name)}</h3>
    <div class="dheadline">${esc(p.headline || '')}</div>
    ${p.location ? `<div class="dheadline" style="color:#888">📍 ${esc(p.location)}</div>` : ''}
    ${p.connections ? `<div class="dheadline" style="color:#888">🔗 ${esc(p.connections)} connections</div>` : ''}
    ${sections.map(s => `
      <div class="section">
        <div class="section-title">${esc(s.title)}</div>
        <div class="section-body">${esc(s.body.slice(0, 500))}${s.body.length > 500 ? '…' : ''}</div>
      </div>
    `).join('')}
    <a class="open-link" href="${esc(p.profileUrl)}" target="_blank">↗ Open profile</a>

    <div class="tier-row">
      ${QUALITY_TIERS.map(t => `<button class="tier-btn" data-tier="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <button class="send-crm-btn" id="btnOpenLeadForm">Send to CRM (no tier)</button>
  `;

  detail.querySelectorAll('.tier-btn').forEach(btn => {
    btn.addEventListener('click', () => openLeadForm(p, btn.dataset.tier));
  });
  document.getElementById('btnOpenLeadForm').addEventListener('click', () => openLeadForm(p));
}

// --- Name splitting: LinkedIn only gives a single "name" string ---
function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Fold the sections that have no dedicated CRM column into notes
function composeNotes(p) {
  const lines = [];
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.connections) lines.push(`Connections: ${p.connections}`);
  if (p.about) lines.push(`\nAbout:\n${p.about}`);
  if (p.experience) lines.push(`\nExperience:\n${p.experience}`);
  if (p.education) lines.push(`\nEducation:\n${p.education}`);
  if (p.skills) lines.push(`\nSkills:\n${p.skills}`);
  if (p.certifications) lines.push(`\nCertifications:\n${p.certifications}`);
  return lines.join('\n');
}

function renderTags() {
  lfTagList.innerHTML = leadTags.map((t, i) => `
    <span class="tag">${esc(t)}<button data-i="${i}">✕</button></span>
  `).join('');
  lfTagList.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      leadTags.splice(Number(btn.dataset.i), 1);
      renderTags();
    });
  });
}

lfTagInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const tag = lfTagInput.value.trim();
  if (tag && !leadTags.includes(tag)) leadTags.push(tag);
  lfTagInput.value = '';
  renderTags();
});

// LinkedIn never exposes email on a profile page. Pre-fill a placeholder in
// the same shape the CRM's own CSV importer already generates for leads
// with no real email, so a real one can be added later without this field
// blocking every single send. Still fully editable before sending.
function placeholderEmail(firstName, lastName) {
  const slug = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown';
  return `${slug}-${Date.now().toString(36)}@placeholder.skarion`;
}

function openLeadForm(p, presetTier) {
  const { firstName, lastName } = splitName(p.name);
  lfFirstName.value = firstName;
  lfLastName.value = lastName;
  lfEmail.value = placeholderEmail(firstName, lastName);
  lfPhone.value = '';
  lfCompanyName.value = (p.currentCompanies || '').split(',')[0]?.trim() || '';
  lfCompanyDomain.value = '';
  lfLinkedinUrl.value = p.profileUrl || '';
  lfStatus.value = 'new';
  lfOutreachStatus.value = 'not_approached';
  leadTags = presetTier ? [presetTier] : [];
  renderTags();
  lfNotes.value = composeNotes(p);
  lfStatusLine.textContent = presetTier ? `Tier: ${presetTier} — review and send.` : '';
  lfStatusLine.className = 'status-line';
  leadForm.dataset.profileId = p.profileId;
  leadForm.classList.add('open');
  leadForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

btnCancelLead.addEventListener('click', () => {
  leadForm.classList.remove('open');
});

btnSendLead.addEventListener('click', async () => {
  if (!crmSettings.crmUrl) {
    lfStatusLine.textContent = 'Set the CRM API base URL in ⚙ Settings first.';
    lfStatusLine.className = 'status-line err';
    return;
  }
  // The CRM now rejects any /extension/leads request with no valid key —
  // fail fast here with a clear message instead of a confusing 401 later.
  if (!crmSettings.apiKey) {
    lfStatusLine.textContent = 'Add your personal API key in ⚙ Settings first (ask an admin to generate one).';
    lfStatusLine.className = 'status-line err';
    return;
  }
  if (!lfFirstName.value.trim() || !lfLastName.value.trim() || !lfEmail.value.trim()) {
    lfStatusLine.textContent = 'First name, last name, and email are required.';
    lfStatusLine.className = 'status-line err';
    return;
  }

  const payload = {
    firstName: lfFirstName.value.trim(),
    lastName: lfLastName.value.trim(),
    email: lfEmail.value.trim(),
    phone: lfPhone.value.trim() || null,
    companyName: lfCompanyName.value.trim() || null,
    companyDomain: lfCompanyDomain.value.trim() || null,
    linkedinUrl: lfLinkedinUrl.value.trim() || null,
    source: 'linkedin',
    status: lfStatus.value,
    outreachStatus: lfOutreachStatus.value,
    tags: leadTags,
    notes: lfNotes.value,
  };

  btnSendLead.disabled = true;
  btnSendLead.textContent = 'Sending…';
  lfStatusLine.textContent = '';
  lfStatusLine.className = 'status-line';

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (crmSettings.apiKey) headers.Authorization = `Bearer ${crmSettings.apiKey}`;

    const res = await fetch(`${crmSettings.crmUrl}/extension/leads`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${body}`);
    }
    lfStatusLine.textContent = 'Sent to CRM ✓';
    lfStatusLine.className = 'status-line';
    setTimeout(() => leadForm.classList.remove('open'), 1200);
  } catch (err) {
    lfStatusLine.textContent = `Failed to reach ${crmSettings.crmUrl}/extension/leads — ${err.message}`;
    lfStatusLine.className = 'status-line err';
  } finally {
    btnSendLead.disabled = false;
    btnSendLead.textContent = 'Send to CRM';
  }
});

// Load
chrome.storage.local.get(['profiles'], data => {
  allProfiles = data.profiles || {};
  render();
});

// Search
searchInput.addEventListener('input', () => {
  selectedId = null;
  detail.style.display = 'none';
  render(searchInput.value);
});

// Capture current tab now
btnCapture.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url?.includes('linkedin.com/in/')) {
    btnCapture.textContent = '⚠ Not a LinkedIn profile page';
    setTimeout(() => { btnCapture.textContent = '📸 Capture Current Profile Now'; }, 2000);
    return;
  }
  btnCapture.textContent = '⏳ Scrolling & capturing…';
  btnCapture.disabled = true;

  const profileId = tab.url.split('/in/')[1]?.split('?')[0]?.replace(/\/$/, '');

  // Snapshot the existing capturedAt for this profile (if any) so we can
  // detect a genuinely NEW capture rather than matching stale stored data
  const before = await new Promise(resolve => {
    chrome.storage.local.get(['profiles'], data => resolve((data.profiles || {})[profileId]?.capturedAt));
  });

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch(e) {}

  // Thorough scrolling can take 15–30s on long profiles, so poll for up to 45s
  let attempts = 0;
  const maxAttempts = 90; // 90 * 500ms = 45s
  const poll = setInterval(() => {
    chrome.storage.local.get(['profiles'], data => {
      const profiles = data.profiles || {};
      const current = profiles[profileId];
      const isNew = current && current.capturedAt !== before;

      if (isNew || attempts++ > maxAttempts) {
        clearInterval(poll);
        allProfiles = profiles;
        render();
        if (isNew) showDetail(profileId);
        btnCapture.textContent = isNew ? '✓ Captured!' : '⚠ Try again';
        btnCapture.disabled = false;
        setTimeout(() => { btnCapture.textContent = '📸 Capture Current Profile Now'; }, 2000);
      }
    });
  }, 500);
});

// Clear
btnClear.addEventListener('click', () => {
  if (!confirm('Clear all saved profiles?')) return;
  chrome.storage.local.remove('profiles');
  allProfiles = {};
  selectedId = null;
  detail.style.display = 'none';
  render();
  chrome.action.setBadgeText({ text: '0' });
});

// Export
btnExport.addEventListener('click', () => {
  const profiles = Object.values(allProfiles).sort((a,b) => new Date(b.capturedAt)-new Date(a.capturedAt));
  if (!profiles.length) return;

  const headers = ['#','Name','Headline','Location','Connections','Current Company','About','Experience','Education','Skills','Certifications','Profile URL','Captured At'];
  const rows = profiles.map((p,i) => [
    i+1, p.name, p.headline, p.location, p.connections, p.currentCompanies,
    p.about, p.experience, p.education, p.skills, p.certifications,
    p.profileUrl, p.capturedAt
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    {wch:4},{wch:26},{wch:40},{wch:22},{wch:12},{wch:24},
    {wch:50},{wch:60},{wch:40},{wch:40},{wch:40},{wch:55},{wch:22}
  ];

  // Style header row
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (cell) cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '0A66C2' } },
      alignment: { horizontal: 'center' }
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
  const date = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `linkedin-profiles-${date}-${profiles.length}.xlsx`);
});
