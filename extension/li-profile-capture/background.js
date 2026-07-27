chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'updateBadge') {
    chrome.action.setBadgeText({ text: String(msg.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#057642' });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '0' });
  chrome.action.setBadgeBackgroundColor({ color: '#888' });
});
