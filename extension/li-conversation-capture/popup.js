const DEFAULT_CRM_URL = 'https://skarion-crm-platform.skarion-talentos.workers.dev';

const candidateName = document.getElementById('candidateName');
const candidateMeta = document.getElementById('candidateMeta');
const statusBox = document.getElementById('status');
const progressBar = document.getElementById('progress');
const settings = document.getElementById('settings');
const crmUrlInput = document.getElementById('crmUrl');
const apiKeyInput = document.getElementById('apiKey');
const ingestButton = document.getElementById('ingestButton');
const draftButton = document.getElementById('draftButton');
const followUpButton = document.getElementById('followUpButton');
const draftsCard = document.getElementById('draftsCard');
const draftsHeading = document.getElementById('draftsHeading');
const draftsList = document.getElementById('draftsList');

let activeTab = null;
let busy = false;
let crmSettings = { crmUrl: DEFAULT_CRM_URL, apiKey: '' };
let lastIngestedProfileUrl = null;
let lastMessageFromUs = null;

function setStatus(message, kind = '', percent = null) {
  statusBox.textContent = message;
  statusBox.className = `status${kind ? ` ${kind}` : ''}`;
  if (percent !== null) progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function updateDraftButtons() {
  const ready = Boolean(lastIngestedProfileUrl) && !busy;
  draftButton.disabled = !ready;
  followUpButton.disabled = !ready;
  // Recommend whichever action actually matches the conversation state: if
  // our last message got no reply, a "reply" makes no sense (nothing new to
  // reply to) — Follow Up is the useful action, and vice versa.
  draftButton.classList.toggle('recommended', ready && lastMessageFromUs === false);
  followUpButton.classList.toggle('recommended', ready && lastMessageFromUs === true);
}

function setBusy(value) {
  busy = value;
  ingestButton.disabled = value;
  updateDraftButtons();
}

function normalizeCrmUrl(raw) {
  let value = String(raw || '').trim().replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value;
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

async function refreshActiveTab() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onThread = Boolean(activeTab?.url?.includes('linkedin.com/messaging/thread/'));
  ingestButton.disabled = !onThread || busy;
  if (!onThread) {
    candidateName.textContent = 'Open a LinkedIn message thread';
    candidateMeta.textContent = 'Then click Ingest.';
    draftsCard.style.display = 'none';
    lastIngestedProfileUrl = null;
    lastMessageFromUs = null;
    updateDraftButtons();
  }
}

async function requestFromContentScript(action) {
  try {
    return await chrome.tabs.sendMessage(activeTab.id, { action });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
    return chrome.tabs.sendMessage(activeTab.id, { action });
  }
}

async function ingest() {
  if (busy || !activeTab) return;
  setBusy(true);
  draftsCard.style.display = 'none';
  setStatus('Scanning the open conversation…', '', 5);
  try {
    const response = await requestFromContentScript('ingestConversationNow');
    if (!response?.ok) throw new Error(response?.error || 'Could not read this conversation.');
    const conversation = response.conversation;

    candidateName.textContent = conversation.otherPartyName;
    candidateMeta.textContent = `${conversation.messages.length} messages found · sending to CRM…`;
    setStatus('Sending conversation to CRM…', '', 85);

    const result = await api('/extension/conversations/ingest', {
      method: 'POST',
      body: JSON.stringify(conversation),
    });

    lastIngestedProfileUrl = conversation.otherPartyProfileUrl;
    lastMessageFromUs = Boolean(result.lastMessageFromUs);
    const leadLabel = result.lead ? result.lead.leadNumber : 'existing contact';
    const hint = lastMessageFromUs ? 'no reply yet — try Follow Up' : 'they replied — try Draft Reply';
    candidateMeta.textContent = result.duplicate
      ? `${leadLabel} · already a converted contact`
      : `${leadLabel} · ${result.messageCount} messages (${result.newMessageCount} new) · ${hint}`;
    setStatus('Conversation ingested.', 'success', 100);
  } catch (error) {
    setStatus(error.message || 'Ingest failed.', 'error', 0);
  } finally {
    setBusy(false);
  }
}

function renderDrafts(drafts) {
  draftsList.replaceChildren();
  drafts.forEach((text, index) => {
    const card = document.createElement('div');
    card.className = 'draft-card';
    const body = document.createElement('div');
    body.className = 'draft-text';
    body.textContent = text;
    const copyButton = document.createElement('button');
    copyButton.className = 'copy';
    copyButton.textContent = `Copy option ${index + 1}`;
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Copied';
      copyButton.classList.add('copied');
      setTimeout(() => {
        copyButton.textContent = `Copy option ${index + 1}`;
        copyButton.classList.remove('copied');
      }, 1500);
    });
    card.append(body, copyButton);
    draftsList.append(card);
  });
  draftsCard.style.display = 'block';
}

async function generateDrafts(mode) {
  if (busy || !lastIngestedProfileUrl) return;
  setBusy(true);
  draftsHeading.textContent =
    mode === 'follow_up'
      ? 'Follow-up options — pick one, copy it, paste it into LinkedIn.'
      : 'Reply options — pick one, copy it, paste it into LinkedIn.';
  setStatus(
    mode === 'follow_up' ? 'Drafting three follow-up options…' : 'Drafting three reply options…',
    '',
    30
  );
  try {
    const result = await api('/extension/conversations/draft', {
      method: 'POST',
      body: JSON.stringify({ linkedinUrl: lastIngestedProfileUrl, mode }),
    });
    renderDrafts(result.drafts);
    setStatus('Drafts ready.', 'success', 100);
  } catch (error) {
    setStatus(error.message || 'Draft failed.', 'error', 0);
  } finally {
    setBusy(false);
  }
}

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
  setStatus('Settings saved.', 'success', 0);
});
ingestButton.addEventListener('click', () => void ingest());
draftButton.addEventListener('click', () => void generateDrafts('reply'));
followUpButton.addEventListener('click', () => void generateDrafts('follow_up'));

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'ingestProgress') {
    setStatus(message.detail || message.message, message.status === 'failed' ? 'error' : '', message.percent);
  }
});

chrome.tabs.onActivated.addListener(() => void refreshActiveTab());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) void refreshActiveTab();
});

void chrome.storage.local.get(['crmSettings']).then(async (stored) => {
  // First run on this machine: seed from default-settings.js (gitignored,
  // ships only in the locally-built/zipped extension) so it works with no
  // manual setup. Once anything is saved to chrome.storage.local, that
  // always wins over the seed.
  const seed = window.__SKARION_DEFAULT_SETTINGS__;
  const hasStored = Boolean(stored.crmSettings?.apiKey);
  crmSettings = {
    crmUrl: normalizeCrmUrl(stored.crmSettings?.crmUrl || seed?.crmUrl) || DEFAULT_CRM_URL,
    apiKey: (hasStored ? stored.crmSettings.apiKey : seed?.apiKey) || '',
  };
  if (!hasStored && crmSettings.apiKey) {
    await chrome.storage.local.set({ crmSettings });
  }
  crmUrlInput.value = crmSettings.crmUrl;
  apiKeyInput.value = crmSettings.apiKey;
  if (!crmSettings.apiKey) settings.classList.add('open');
  await refreshActiveTab();
});
