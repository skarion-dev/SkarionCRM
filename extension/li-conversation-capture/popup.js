const DEFAULT_CRM_URL = 'https://skarion-crm-platform.skarion-talentos.workers.dev';

const candidateName = document.getElementById('candidateName');
const candidateMeta = document.getElementById('candidateMeta');
const statusBox = document.getElementById('status');
const progressBar = document.getElementById('progress');
const settings = document.getElementById('settings');
const crmUrlInput = document.getElementById('crmUrl');
const apiKeyInput = document.getElementById('apiKey');
const threadCard = document.getElementById('threadCard');
const profileCard = document.getElementById('profileCard');
const ingestButton = document.getElementById('ingestButton');
const draftButton = document.getElementById('draftButton');
const followUpButton = document.getElementById('followUpButton');
const connectionNoteButton = document.getElementById('connectionNoteButton');
const draftsCard = document.getElementById('draftsCard');
const draftsHeading = document.getElementById('draftsHeading');
const draftsList = document.getElementById('draftsList');
const threadDirectionInput = document.getElementById('threadDirectionInput');
const threadDirectionCount = document.getElementById('threadDirectionCount');
const profileDirectionInput = document.getElementById('profileDirectionInput');
const profileDirectionCount = document.getElementById('profileDirectionCount');

let activeTab = null;
let busy = false;
let pageMode = null; // 'thread' | 'profile' | null
let crmSettings = { crmUrl: DEFAULT_CRM_URL, apiKey: '' };
let lastIngestedProfileUrl = null;
let lastMessageFromUs = null;

function setStatus(message, kind = '', percent = null) {
  statusBox.textContent = message;
  statusBox.className = `status${kind ? ` ${kind}` : ''}`;
  if (percent !== null) progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function updateDraftButtons() {
  const ready = pageMode === 'thread' && Boolean(lastIngestedProfileUrl) && !busy;
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
  ingestButton.disabled = value || pageMode !== 'thread';
  connectionNoteButton.disabled = value || pageMode !== 'profile';
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

function detectPageMode(url) {
  if (!url) return null;
  if (url.includes('linkedin.com/messaging/thread/')) return 'thread';
  if (/linkedin\.com\/in\/[^/?#]+/.test(url)) return 'profile';
  return null;
}

async function refreshActiveTab() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageMode = detectPageMode(activeTab?.url);

  threadCard.style.display = pageMode === 'thread' ? 'block' : 'none';
  profileCard.style.display = pageMode === 'profile' ? 'block' : 'none';
  ingestButton.disabled = pageMode !== 'thread' || busy;
  connectionNoteButton.disabled = pageMode !== 'profile' || busy;

  if (pageMode === 'thread') {
    candidateName.textContent = 'LinkedIn message thread';
    candidateMeta.textContent = 'Click Ingest to read it in.';
  } else if (pageMode === 'profile') {
    candidateName.textContent = 'LinkedIn profile';
    candidateMeta.textContent = 'Click Connection Note to draft one.';
  } else {
    candidateName.textContent = 'Open a LinkedIn message thread or profile';
    candidateMeta.textContent = 'Then use the action below.';
  }

  draftsCard.style.display = 'none';
  lastIngestedProfileUrl = null;
  lastMessageFromUs = null;
  updateDraftButtons();
}

async function requestFromContentScript(action) {
  // chrome.tabs.sendMessage resolves with `undefined` — not a rejection —
  // when no content script frame actually called sendResponse. That
  // happens both when nothing was ever injected (extension loaded after
  // this tab was already open) and when LinkedIn rendered the real
  // messaging UI inside a same-origin child iframe that only an
  // allFrames-scoped injection reaches. Treat both the same: (re)inject
  // into every frame and retry once.
  const response = await chrome.tabs.sendMessage(activeTab.id, { action }).catch(() => undefined);
  if (response !== undefined) return response;
  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id, allFrames: true },
    files: ['content.js'],
  });
  return chrome.tabs.sendMessage(activeTab.id, { action });
}

async function ingest() {
  if (busy || !activeTab || pageMode !== 'thread') return;
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

function renderDrafts(drafts, { charLimit = null, onCopy = null } = {}) {
  draftsList.replaceChildren();
  drafts.forEach((text, index) => {
    const card = document.createElement('div');
    card.className = 'draft-card';
    const body = document.createElement('div');
    body.className = 'draft-text';
    body.textContent = text;

    const footer = document.createElement('div');
    footer.className = 'draft-footer';

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
      if (onCopy) void onCopy();
    });
    footer.append(copyButton);

    if (charLimit) {
      const count = [...text].length;
      const countLabel = document.createElement('span');
      countLabel.className = `char-count${count > charLimit ? ' over' : ''}`;
      countLabel.textContent = `${count}/${charLimit}`;
      footer.append(countLabel);
    }

    card.append(body, footer);
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
    const direction = threadDirectionInput.value.trim();
    const result = await api('/extension/conversations/draft', {
      method: 'POST',
      body: JSON.stringify({
        linkedinUrl: lastIngestedProfileUrl,
        mode,
        direction: direction || undefined,
      }),
    });
    renderDrafts(result.drafts);
    setStatus('Drafts ready.', 'success', 100);
  } catch (error) {
    setStatus(error.message || 'Draft failed.', 'error', 0);
  } finally {
    setBusy(false);
  }
}

async function generateConnectionNote() {
  if (busy || !activeTab || pageMode !== 'profile') return;
  setBusy(true);
  draftsCard.style.display = 'none';
  setStatus('Reading the profile…', '', 5);
  try {
    const response = await requestFromContentScript('captureConnectionNoteProfile');
    if (!response?.ok) throw new Error(response?.error || 'Could not read this profile.');
    const profile = response.profile;

    candidateName.textContent = profile.name;
    candidateMeta.textContent = 'Drafting connection note options…';
    setStatus('Drafting three connection-note options…', '', 60);

    const direction = profileDirectionInput.value.trim();
    const result = await api('/extension/profiles/connection-note', {
      method: 'POST',
      body: JSON.stringify({ ...profile, direction: direction || undefined }),
    });

    const leadLabel = result.lead ? result.lead.leadNumber : 'existing contact';
    candidateMeta.textContent = result.duplicate
      ? `${leadLabel} · already a converted contact`
      : `${leadLabel} · copy a note to mark Connection Sent`;

    draftsHeading.textContent = 'Connection note options — under 300 characters, ready for LinkedIn.';
    const linkedinUrl = result.lead ? profile.profileUrl : null;
    renderDrafts(result.drafts, {
      charLimit: 300,
      onCopy: linkedinUrl
        ? async () => {
            try {
              await api('/extension/leads/mark-connection-sent', {
                method: 'POST',
                body: JSON.stringify({ profileUrl: linkedinUrl }),
              });
              candidateMeta.textContent = `${leadLabel} · marked Connection Sent`;
            } catch {
              // Non-fatal — the note is already copied, worth telling the
              // operator the CRM update specifically didn't go through.
              candidateMeta.textContent = `${leadLabel} · note copied, but marking Connection Sent failed`;
            }
          }
        : null,
    });
    setStatus('Notes ready.', 'success', 100);
  } catch (error) {
    setStatus(error.message || 'Connection note failed.', 'error', 0);
  } finally {
    setBusy(false);
  }
}

threadDirectionInput.addEventListener('input', () => {
  threadDirectionCount.textContent = `${threadDirectionInput.value.length}/600`;
});
profileDirectionInput.addEventListener('input', () => {
  profileDirectionCount.textContent = `${profileDirectionInput.value.length}/600`;
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
  setStatus('Settings saved.', 'success', 0);
});
ingestButton.addEventListener('click', () => void ingest());
draftButton.addEventListener('click', () => void generateDrafts('reply'));
followUpButton.addEventListener('click', () => void generateDrafts('follow_up'));
connectionNoteButton.addEventListener('click', () => void generateConnectionNote());

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
