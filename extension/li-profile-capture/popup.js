const DEFAULT_CRM_URL = 'https://skarion-crm-platform.skarion-talentos.workers.dev';
const DEFAULT_CRM_WEB_URL = 'https://crm.skarion.com';

const profileName = document.getElementById('profileName');
const profileMeta = document.getElementById('profileMeta');
const statusBox = document.getElementById('status');
const progressBar = document.getElementById('progress');
const settings = document.getElementById('settings');
const crmUrlInput = document.getElementById('crmUrl');
const apiKeyInput = document.getElementById('apiKey');
const decisionButtons = [...document.querySelectorAll('[data-disposition]')];

let activeTab = null;
let resolvedLead = null;
let busy = false;
let resolveTimer = null;
let crmSettings = { crmUrl: DEFAULT_CRM_URL, apiKey: '' };

function normalizeCrmUrl(raw) {
  let value = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value;
}

function setStatus(message, kind = '', percent = null) {
  statusBox.textContent = message;
  statusBox.className = `status${kind ? ` ${kind}` : ''}`;
  if (percent !== null) progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setBusy(value) {
  busy = value;
  decisionButtons.forEach((button) => {
    button.disabled = value;
  });
}

async function api(path, options = {}) {
  if (!crmSettings.apiKey) throw new Error('Add your extension API key in settings first.');
  const response = await fetch(`${crmSettings.crmUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${crmSettings.apiKey}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} request failed`);
  return body;
}

async function resolveCurrentProfile() {
  if (busy) return;
  resolvedLead = null;
  decisionButtons.forEach((button) => {
    button.disabled = true;
  });
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.url?.includes('linkedin.com/in/')) {
    profileName.textContent = 'Open a LinkedIn profile';
    profileMeta.textContent = 'This extension only reviews linkedin.com/in/ pages.';
    decisionButtons.forEach((button) => {
      button.disabled = true;
    });
    return;
  }
  profileName.textContent =
    activeTab.title?.replace(/\s*\|\s*LinkedIn.*$/i, '') || 'LinkedIn profile';
  if (!crmSettings.apiKey) {
    profileMeta.textContent = 'Add your CRM API key to begin.';
    settings.classList.add('open');
    return;
  }
  profileMeta.textContent = 'Checking this profile in Skarion CRM…';
  setStatus('Choose a stage. The profile will be captured and sent directly to CRM.', '', 0);
  try {
    const result = await api('/extension/prospects/resolve', {
      method: 'POST',
      body: JSON.stringify({
        linkedinUrl: activeTab.url,
        profileName: profileName.textContent,
      }),
    });
    resolvedLead = result.lead;
    profileMeta.textContent = resolvedLead
      ? `${resolvedLead.leadNumber} · ${resolvedLead.reviewState === 'pending' ? 'Awaiting review' : `Already ${resolvedLead.reviewDisposition || resolvedLead.reviewState}`}`
      : 'Not imported yet — a lead number will be created when you decide.';
    decisionButtons.forEach((button) => {
      button.disabled = false;
    });
  } catch (error) {
    setStatus(error.message, 'error', 0);
  }
}

function scheduleProfileResolution() {
  if (busy) return;
  if (resolveTimer) clearTimeout(resolveTimer);
  resolveTimer = setTimeout(() => void resolveCurrentProfile(), 250);
}

async function captureProfile() {
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'captureProfileNow' });
    if (!response?.ok) throw new Error(response?.error || 'Profile capture failed.');
    return response.profile;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content.js'],
    });
    const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'captureProfileNow' });
    if (!response?.ok) throw new Error(response?.error || 'Profile capture failed.');
    return response.profile;
  }
}

async function captureAndReview(disposition) {
  if (busy || !activeTab) return;
  setBusy(true);
  setStatus('Capturing visible LinkedIn profile sections…', '', 5);
  try {
    const profile = await captureProfile();
    profileName.textContent = profile.name || profileName.textContent;
    setStatus('Sending capture and decision directly to CRM…', '', 82);
    const result = await api('/extension/prospects/review', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': profile.idempotencyKey },
      body: JSON.stringify({
        disposition,
        linkedinUrl: activeTab.url,
        profile,
        rowVersion: resolvedLead?.rowVersion,
      }),
    });
    resolvedLead = result.lead;
    statusBox.replaceChildren();
    statusBox.append('Saved as ');
    const leadNumber = document.createElement('strong');
    leadNumber.textContent = result.lead.leadNumber;
    statusBox.append(leadNumber, '. ');
    const recordLink = document.createElement('a');
    recordLink.href = `${DEFAULT_CRM_WEB_URL}/leads/${result.lead.id}`;
    recordLink.textContent = 'Open CRM record';
    recordLink.addEventListener('click', async (event) => {
      event.preventDefault();
      const openResult = await chrome.runtime.sendMessage({
        action: 'openCrmRecord',
        leadId: result.lead.id,
      });
      if (!openResult?.ok) {
        setStatus(openResult?.error || 'Could not open the CRM record.', 'error', 100);
      }
    });
    statusBox.append(recordLink);
    statusBox.className = 'status success';
    progressBar.style.width = '100%';
    profileMeta.textContent = `${result.lead.leadNumber} · ${result.lead.reviewDisposition.replaceAll('_', ' ')}`;
  } catch (error) {
    setStatus(error.message || 'Review failed.', 'error', 0);
  } finally {
    setBusy(false);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'scrapeProgress') {
    setStatus(
      message.detail || message.message,
      message.status === 'failed' ? 'error' : '',
      message.percent
    );
  }
});

chrome.tabs.onActivated.addListener(() => {
  scheduleProfileResolution();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
    scheduleProfileResolution();
  }
});

document.getElementById('toggleSettings').addEventListener('click', () => {
  settings.classList.toggle('open');
});
document.getElementById('saveSettings').addEventListener('click', async () => {
  crmSettings = {
    crmUrl: normalizeCrmUrl(crmUrlInput.value) || DEFAULT_CRM_URL,
    apiKey: apiKeyInput.value.trim(),
  };
  await chrome.storage.local.set({ crmSettings });
  settings.classList.remove('open');
  setStatus('Settings saved. Choose a review decision.', 'success', 0);
  await resolveCurrentProfile();
});
decisionButtons.forEach((button) => {
  button.addEventListener('click', () => void captureAndReview(button.dataset.disposition));
});

void chrome.storage.local.get(['crmSettings']).then(async (stored) => {
  crmSettings = {
    crmUrl: normalizeCrmUrl(stored.crmSettings?.crmUrl) || DEFAULT_CRM_URL,
    apiKey: stored.crmSettings?.apiKey || '',
  };
  crmUrlInput.value = crmSettings.crmUrl;
  apiKeyInput.value = crmSettings.apiKey;
  await resolveCurrentProfile();
});
