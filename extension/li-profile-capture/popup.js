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
// Frontend (not API) origin — only used to build "open existing record" links.
const DEFAULT_CRM_WEB_URL = 'https://skarion-crm-cv9.pages.dev';
let crmSettings = { crmUrl: DEFAULT_CRM_URL, apiKey: '' };
let leadTags = [];

const statCount = document.getElementById('statCount');
const statSent = document.getElementById('statSent');
const searchInput = document.getElementById('searchInput');
const profileList = document.getElementById('profileList');
const detail = document.getElementById('detail');
const btnReviewSend = document.getElementById('btnReviewSend');
const btnClear = document.getElementById('btnClear');
const btnCapture = document.getElementById('btnCaptureNow');
const scrapeProgress = document.getElementById('scrapeProgress');
const scrapeProgressMessage = document.getElementById('scrapeProgressMessage');
const scrapeProgressPercent = document.getElementById('scrapeProgressPercent');
const scrapeProgressFill = document.getElementById('scrapeProgressFill');
const scrapeProgressDetail = document.getElementById('scrapeProgressDetail');
let activeTabId = null;
let activeProfileId = null;

// --- Settings (CRM URL + API key), saved per-device ---
const btnSettings = document.getElementById('btnSettings');
const settingsPanel = document.getElementById('settingsPanel');
const setCrmUrl = document.getElementById('setCrmUrl');
const setApiKey = document.getElementById('setApiKey');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const settingsStatus = document.getElementById('settingsStatus');

// --- Lead form (send captured profile to CRM) ---
const leadForm = document.getElementById('leadForm');
const lfFirstName = document.getElementById('lfFirstName');
const lfLastName = document.getElementById('lfLastName');
const lfEmail = document.getElementById('lfEmail');
const lfPhone = document.getElementById('lfPhone');
const lfCompanyName = document.getElementById('lfCompanyName');
const lfCompanyDomain = document.getElementById('lfCompanyDomain');
const lfLinkedinUrl = document.getElementById('lfLinkedinUrl');
const lfStatus = document.getElementById('lfStatus');
const lfOutreachStatus = document.getElementById('lfOutreachStatus');
const lfTagList = document.getElementById('lfTagList');
const lfTagInput = document.getElementById('lfTagInput');
const lfNotes = document.getElementById('lfNotes');
const lfStatusLine = document.getElementById('lfStatusLine');
const lfDupeBanner = document.getElementById('lfDupeBanner');
const btnSendLead = document.getElementById('btnSendLead');
const btnCancelLead = document.getElementById('btnCancelLead');
const btnPasteSettings = document.getElementById('btnPasteSettings');
const lfAiResult = document.getElementById('lfAiResult');
const lfAiScore = document.getElementById('lfAiScore');
const lfAiClassification = document.getElementById('lfAiClassification');
const lfAiReasoning = document.getElementById('lfAiReasoning');
const lfAiNote = document.getElementById('lfAiNote');
const lfAiNoteCount = document.getElementById('lfAiNoteCount');
const btnCopyAiNote = document.getElementById('btnCopyAiNote');

chrome.storage.local.get(['crmSettings'], (data) => {
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
    setTimeout(() => {
      settingsStatus.textContent = '';
    }, 3000);
  });
});

// Admin's "Copy for extension" button (ApiKeysList.tsx) puts a small JSON
// blob on the clipboard: {"crmUrl": "...", "apiKey": "..."}. Paste it here
// instead of retyping both fields by hand.
btnPasteSettings.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.apiKey !== 'string') throw new Error('not a key blob');
    if (typeof parsed.crmUrl === 'string' && parsed.crmUrl)
      setCrmUrl.value = normalizeCrmUrl(parsed.crmUrl);
    setApiKey.value = parsed.apiKey;
    btnSaveSettings.click();
    settingsStatus.textContent = 'Pasted from clipboard — saved.';
    settingsStatus.className = 'status-line';
  } catch {
    settingsStatus.textContent =
      'Clipboard doesn’t contain a key from the admin panel’s "Copy for extension" button.';
    settingsStatus.className = 'status-line err';
  }
});

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function render(filter = '') {
  const q = filter.toLowerCase();
  const sorted = Object.values(allProfiles)
    .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
    .filter(
      (p) =>
        !q ||
        [p.name, p.headline, p.location, p.currentCompanies].join(' ').toLowerCase().includes(q)
    );

  statCount.textContent = Object.keys(allProfiles).length;
  statSent.textContent = Object.values(allProfiles).filter((p) => p.crmStatus === 'sent').length;
  btnReviewSend.disabled = Object.keys(allProfiles).length === 0;

  if (sorted.length === 0) {
    profileList.style.display = 'none';
    return;
  }

  profileList.style.display = 'block';
  profileList.innerHTML = sorted
    .map(
      (p) => `
    <div class="profile-item${selectedId === p.profileId ? ' selected' : ''}" data-id="${esc(p.profileId)}">
      <div class="profile-dot"></div>
      <div class="profile-info">
        <div class="profile-name">${esc(p.name)}</div>
        <div class="profile-sub">${esc(p.headline || p.location || '—')}</div>
        <div class="profile-time">${esc(p.location || '')} · ${timeAgo(p.capturedAt)}</div>
      </div>
      <div class="profile-crm-status ${p.crmStatus === 'sent' ? 'sent' : 'pending'}">
        ${p.crmStatus === 'sent' ? '✓ Sent to CRM' : 'Not sent'}
      </div>
    </div>
  `
    )
    .join('');

  profileList.querySelectorAll('.profile-item').forEach((el) => {
    el.addEventListener('click', () => showDetail(el.dataset.id));
  });
}

function renderScrapeProgress(progress) {
  if (!progress || !activeProfileId || (activeTabId !== null && progress.tabId !== activeTabId)) {
    scrapeProgress.classList.remove('open');
    return;
  }

  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  scrapeProgress.className = `scrape-progress open ${progress.status || ''}`;
  scrapeProgressMessage.textContent = progress.message || 'Capturing profile';
  scrapeProgressPercent.textContent = `${percent}%`;
  scrapeProgressFill.style.width = `${percent}%`;
  scrapeProgressDetail.textContent = progress.detail || '';

  const inProgress = progress.status === 'running' || progress.status === 'waiting';
  btnCapture.disabled = inProgress;
  if (progress.status === 'complete') {
    btnCapture.textContent = '✓ Profile captured';
  } else if (progress.status === 'failed') {
    btnCapture.textContent = '↻ Try capture again';
  } else if (inProgress) {
    btnCapture.textContent = `⏳ ${progress.message}`;
  } else {
    btnCapture.textContent = '📸 Capture Current Profile Now';
  }
}

function showDetail(id) {
  selectedId = id;
  const p = allProfiles[id];
  if (!p) return;

  render(searchInput.value);

  const sections = [
    p.about && { title: 'About', body: p.about },
    p.experience && { title: 'Experience', body: p.experience },
    p.education && { title: 'Education', body: p.education },
    p.skills && { title: 'Skills', body: p.skills },
    p.certifications && { title: 'Certifications', body: p.certifications },
  ].filter(Boolean);

  detail.style.display = 'block';
  detail.innerHTML = `
    <h3>${esc(p.name)}</h3>
    <div class="dheadline">${esc(p.headline || '')}</div>
    ${p.location ? `<div class="dheadline" style="color:#888">📍 ${esc(p.location)}</div>` : ''}
    ${p.connections ? `<div class="dheadline" style="color:#888">🔗 ${esc(p.connections)} connections</div>` : ''}
    ${
      p.crmStatus === 'sent'
        ? `<a class="crm-sync-banner" href="${esc(p.crmRecordUrl || DEFAULT_CRM_WEB_URL)}" target="_blank">✓ Sent to CRM ${timeAgo(p.crmSentAt)} · Open record</a>`
        : '<div class="crm-sync-banner pending">Not sent to CRM yet</div>'
    }
    ${sections
      .map(
        (s) => `
      <div class="section">
        <div class="section-title">${esc(s.title)}</div>
        <div class="section-body">${esc(s.body.slice(0, 500))}${s.body.length > 500 ? '…' : ''}</div>
      </div>
    `
      )
      .join('')}
    <a class="open-link" href="${esc(p.profileUrl)}" target="_blank">↗ Open profile</a>

    <div class="tier-row">
      ${QUALITY_TIERS.map((t) => `<button class="tier-btn" data-tier="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <button class="send-crm-btn" id="btnOpenLeadForm">
      ${p.crmStatus === 'sent' ? 'Review / resend to CRM' : 'Review & send to CRM'}
    </button>
  `;

  detail.querySelectorAll('.tier-btn').forEach((btn) => {
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
  lfTagList.innerHTML = leadTags
    .map(
      (t, i) => `
    <span class="tag">${esc(t)}<button data-i="${i}">✕</button></span>
  `
    )
    .join('');
  lfTagList.querySelectorAll('button').forEach((btn) => {
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

function openLeadForm(p, presetTier) {
  const { firstName, lastName } = splitName(p.name);
  lfFirstName.value = firstName;
  lfLastName.value = lastName;
  lfEmail.value = '';
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
  lfDupeBanner.style.display = 'none';
  lfDupeBanner.innerHTML = '';
  lfAiResult.classList.remove('open');
  lfAiNote.value = '';
  leadForm.dataset.profileId = p.profileId;
  // Stable per-profile key so a retried send (or a deliberate re-send later)
  // always carries the same idempotency key — persisted alongside the
  // captured profile so it survives popup close/reopen.
  if (!p.idempotencyKey) {
    p.idempotencyKey = crypto.randomUUID();
    allProfiles[p.profileId] = p;
    chrome.storage.local.set({ profiles: allProfiles });
  }
  leadForm.dataset.idempotencyKey = p.idempotencyKey;
  leadForm.classList.add('open');
  leadForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  scheduleDuplicateCheck();
}

function showAiAssessment(assessment) {
  if (!assessment?.connectionNote) return;
  lfAiScore.textContent = `${assessment.overallScore}/100`;
  lfAiClassification.textContent = assessment.classification;
  lfAiReasoning.textContent = assessment.reasoningSummary || '';
  lfAiNote.value = assessment.connectionNote;
  lfAiNoteCount.textContent = `${[...assessment.connectionNote].length}/300 characters`;
  btnCopyAiNote.textContent = 'Copy note';
  lfAiResult.classList.add('open');
  lfAiResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

btnCopyAiNote.addEventListener('click', async () => {
  if (!lfAiNote.value) return;
  await navigator.clipboard.writeText(lfAiNote.value);
  btnCopyAiNote.textContent = 'Copied ✓';
  setTimeout(() => {
    btnCopyAiNote.textContent = 'Copy note';
  }, 2000);
});

function recordLink(entityType, id) {
  return `${DEFAULT_CRM_WEB_URL}/${entityType === 'contact' ? 'contacts' : 'leads'}/${id}`;
}

function markProfileSent(result) {
  const profileId = leadForm.dataset.profileId;
  const profile = allProfiles[profileId];
  const entityType = result.entityType || (result.contact ? 'contact' : 'lead');
  const record = result.contact || result.lead;
  if (!profile || !record?.id) return null;

  profile.crmStatus = 'sent';
  profile.crmSentAt = new Date().toISOString();
  profile.crmRecordId = record.id;
  profile.crmEntityType = entityType;
  profile.crmRecordUrl = recordLink(entityType, record.id);
  allProfiles[profileId] = profile;
  chrome.storage.local.set({ profiles: allProfiles });
  render(searchInput.value);
  return profile.crmRecordUrl;
}

function showCrmConfirmation(message, url) {
  lfStatusLine.textContent = `${message} `;
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.textContent = 'Open in CRM';
    lfStatusLine.appendChild(link);
  }
}

function showDupeBanner(html) {
  lfDupeBanner.innerHTML = html;
  lfDupeBanner.style.display = 'block';
}

function currentLeadFormPayload() {
  return {
    firstName: lfFirstName.value.trim(),
    lastName: lfLastName.value.trim(),
    email: lfEmail.value.trim() || null,
    phone: lfPhone.value.trim() || null,
    companyName: lfCompanyName.value.trim() || null,
    linkedinUrl: lfLinkedinUrl.value.trim() || null,
  };
}

// Preflight — calls /extension/leads/check so the user sees "already
// exists" (with a link to the real record) before deciding whether to send
// at all, rather than only finding out after (or, previously, never).
async function checkDuplicate() {
  if (!crmSettings.crmUrl || !crmSettings.apiKey) return;
  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${crmSettings.apiKey}`,
    };
    const res = await fetch(`${crmSettings.crmUrl}/extension/leads/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify(currentLeadFormPayload()),
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result.status === 'exact_duplicate') {
      const record = result.record;
      const label = result.entityType === 'contact' ? 'an existing contact' : 'an existing lead';
      showDupeBanner(
        `⚠ Already in the CRM as ${label} (matched by ${result.matchType.replace('_', ' ')}). ` +
          `Sending will just return that record, not create a new one. ` +
          `<a href="${recordLink(result.entityType, record.id)}" target="_blank">Open existing ${result.entityType}</a>`
      );
    } else if (result.status === 'possible_duplicate') {
      const names = result.matches.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ');
      showDupeBanner(
        `⚠ Possible duplicate — same name + company already in leads: ${names}. Review before sending.`
      );
    } else {
      lfDupeBanner.style.display = 'none';
      lfDupeBanner.innerHTML = '';
    }
  } catch {
    // Best-effort — a failed preflight shouldn't block the form from being usable.
  }
}

let dupeCheckTimer = null;
function scheduleDuplicateCheck() {
  clearTimeout(dupeCheckTimer);
  dupeCheckTimer = setTimeout(checkDuplicate, 400);
}
[lfLinkedinUrl, lfEmail, lfFirstName, lfLastName, lfCompanyName].forEach((el) => {
  el.addEventListener('input', scheduleDuplicateCheck);
});

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
    lfStatusLine.textContent =
      'Add your personal API key in ⚙ Settings first (ask an admin to generate one).';
    lfStatusLine.className = 'status-line err';
    return;
  }
  const displayName = `${lfFirstName.value.trim()} ${lfLastName.value.trim()}`.trim();
  if (!displayName || !(lfLinkedinUrl.value.trim() || lfEmail.value.trim())) {
    lfStatusLine.textContent = 'A name plus a LinkedIn URL or an email is required.';
    lfStatusLine.className = 'status-line err';
    return;
  }

  const payload = {
    firstName: lfFirstName.value.trim(),
    lastName: lfLastName.value.trim(),
    email: lfEmail.value.trim() || null,
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
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${crmSettings.apiKey}`,
      'X-Idempotency-Key': leadForm.dataset.idempotencyKey,
    };

    const res = await fetch(`${crmSettings.crmUrl}/extension/leads`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${body}`);
    }
    const result = await res.json();
    const crmRecordUrl = markProfileSent(result);

    if (result.duplicate) {
      const entityType = result.entityType || 'lead';
      const record = result.contact || result.lead;
      showDupeBanner(
        `Already existed as ${entityType === 'contact' ? 'a contact' : 'a lead'} — nothing new was created. ` +
          `<a href="${recordLink(entityType, record.id)}" target="_blank">Open existing ${entityType}</a>`
      );
      showCrmConfirmation(
        result.replayed
          ? 'Confirmed in CRM—same send as before, no duplicate created. ✓'
          : 'Confirmed: already exists in CRM. ✓',
        crmRecordUrl
      );
      showAiAssessment(result.aiAssessment);
    } else {
      showCrmConfirmation(
        result.aiAssessment
          ? 'Sent to CRM and qualified ✓'
          : 'Sent to CRM ✓—AI assessment was unavailable',
        crmRecordUrl
      );
      showAiAssessment(result.aiAssessment);
    }
    lfStatusLine.className = 'status-line';
  } catch (err) {
    lfStatusLine.textContent = `Failed to reach ${crmSettings.crmUrl}/extension/leads — ${err.message}`;
    lfStatusLine.className = 'status-line err';
  } finally {
    btnSendLead.disabled = false;
    btnSendLead.textContent = 'Send to CRM';
  }
});

// Load
chrome.storage.local.get(['profiles'], (data) => {
  allProfiles = data.profiles || {};
  render();
});

void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  activeTabId = tab?.id ?? null;
  activeProfileId = tab?.url?.split('/in/')[1]?.split('?')[0]?.replace(/\/$/, '') || null;
  chrome.storage.local.get(['scrapeProgress'], (data) => {
    renderScrapeProgress(data.scrapeProgress);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.scrapeProgress) {
    renderScrapeProgress(changes.scrapeProgress.newValue);
  }
  if (changes.profiles) {
    allProfiles = changes.profiles.newValue || {};
    render(searchInput.value);
    if (activeProfileId && allProfiles[activeProfileId]) {
      showDetail(activeProfileId);
    }
  }
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
    setTimeout(() => {
      btnCapture.textContent = '📸 Capture Current Profile Now';
    }, 2000);
    return;
  }
  activeTabId = tab.id;
  activeProfileId = tab.url.split('/in/')[1]?.split('?')[0]?.replace(/\/$/, '') || null;
  renderScrapeProgress({
    tabId: tab.id,
    status: 'running',
    percent: 2,
    message: 'Starting capture',
    detail: 'Connecting to the LinkedIn profile page.',
  });

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'captureProfileNow' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { action: 'captureProfileNow' });
    } catch (error) {
      renderScrapeProgress({
        tabId: tab.id,
        status: 'failed',
        percent: 2,
        message: 'Could not start capture',
        detail:
          error instanceof Error ? error.message : 'Reload the LinkedIn profile and try again.',
      });
      btnCapture.disabled = false;
    }
  }
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

btnReviewSend.addEventListener('click', () => {
  const profiles = Object.values(allProfiles).sort(
    (a, b) => new Date(b.capturedAt) - new Date(a.capturedAt)
  );
  const profile =
    (selectedId && allProfiles[selectedId]) ||
    profiles.find((candidate) => candidate.crmStatus !== 'sent') ||
    profiles[0];
  if (!profile) return;

  showDetail(profile.profileId);
  openLeadForm(profile);
});
