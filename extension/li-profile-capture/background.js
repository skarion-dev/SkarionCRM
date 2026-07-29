chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'scrapeProgress') return;
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
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});
