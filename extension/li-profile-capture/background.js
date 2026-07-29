chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'updateBadge') {
    chrome.action.setBadgeText({ text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#057642' });
  }
  if (msg.action === 'scrapeProgress') {
    const progress = {
      status: msg.status,
      percent: msg.percent,
      message: msg.message,
      detail: msg.detail,
      profileId: msg.profileId,
      tabId: sender.tab?.id ?? null,
      updatedAt: new Date().toISOString(),
    };
    chrome.storage.local.set({ scrapeProgress: progress });

    if (msg.status === 'running' || msg.status === 'waiting') {
      chrome.action.setBadgeText({ text: '…' });
      chrome.action.setBadgeBackgroundColor({ color: '#0a66c2' });
    } else if (msg.status === 'failed') {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '0' });
  chrome.action.setBadgeBackgroundColor({ color: '#888' });
});
