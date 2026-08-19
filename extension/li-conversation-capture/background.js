chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'ingestProgress') {
    if (message.status === 'running') {
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
