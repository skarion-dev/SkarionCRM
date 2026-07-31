chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'scrapeProgress') {
    if (message.status === 'running' || message.status === 'waiting') {
      chrome.action.setBadgeText({ text: '…' });
      chrome.action.setBadgeBackgroundColor({ color: '#0a66c2' });
    } else if (message.status === 'failed') {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
    } else if (message.status === 'complete') {
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#057642' });
    }
  }
});

const CRM_TAB_ORIGINS = new Set(['https://crm.skarion.com']);

async function openCrmRecord(leadId) {
  const path = `/leads/${encodeURIComponent(leadId)}`;
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const allTabs = await chrome.tabs.query({});
  const candidates = [...currentWindowTabs, ...allTabs].filter((tab, index, tabs) => {
    if (!tab.id || !tab.url || tabs.findIndex((candidate) => candidate.id === tab.id) !== index) {
      return false;
    }
    try {
      return CRM_TAB_ORIGINS.has(new URL(tab.url).origin);
    } catch {
      return false;
    }
  });

  const existing = candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (existing?.id && existing.url) {
    await chrome.tabs.update(existing.id, { url: `https://crm.skarion.com${path}`, active: true });
    return;
  }
  await chrome.tabs.create({ url: `https://crm.skarion.com${path}`, active: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'openCrmRecord') return false;
  void openCrmRecord(message.leadId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not open the CRM record.',
      })
    );
  return true;
});

async function enablePersistentSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Could not enable the Skarion side panel:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  void enablePersistentSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void enablePersistentSidePanel();
});

void enablePersistentSidePanel();
