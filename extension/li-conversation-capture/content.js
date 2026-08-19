// Skarion Conversation Capture
// Runs on linkedin.com/messaging/* pages and waits for an explicit popup
// command ("ingestConversationNow"). Scrolls the open thread's message pane
// to the top to force LinkedIn to lazy-load the full history, then extracts
// it into a plain array the popup POSTs to the CRM.

// Same re-injection guard pattern as li-profile-capture/content.js: the
// manifest auto-loads this on every messaging page, and the popup's
// "Ingest" button injects it again via chrome.scripting.executeScript into
// the same tab. Without the guard, a second injection would race a second
// scroll pass against the first.
if (window.__liConvoCaptureVersion !== chrome.runtime.getManifest().version) {
  window.__liConvoCaptureVersion = chrome.runtime.getManifest().version;
  window.__liConvoCaptureRunning = false;
  initLiConvoCapture();
}

function initLiConvoCapture() {
  const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const MONTHS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function reportProgress(status, percent, message, detail = '') {
    chrome.runtime.sendMessage(
      { action: 'ingestProgress', status, percent, message, detail },
      () => void chrome.runtime.lastError
    );
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  // Date dividers render as "TODAY", "YESTERDAY", a weekday name (within the
  // last ~7 days), or "MMM D" (e.g. "AUG 3") for anything older. None of
  // these carry a machine-readable year, so "MMM D" resolves against the
  // current year and rolls back one year if that would land in the future.
  function resolveDateDivider(label, referenceNow) {
    const text = String(label || '').trim().toUpperCase();
    const now = referenceNow || new Date();
    if (text === 'TODAY') return startOfDay(now);
    if (text === 'YESTERDAY') return startOfDay(addDays(now, -1));
    const weekdayIndex = WEEKDAYS.indexOf(text);
    if (weekdayIndex !== -1) {
      const diff = (now.getDay() - weekdayIndex + 7) % 7;
      return startOfDay(addDays(now, -diff));
    }
    const match = text.match(/^([A-Z]{3})\s+(\d{1,2})$/);
    if (match) {
      const monthIndex = MONTHS.indexOf(match[1]);
      if (monthIndex !== -1) {
        const day = Number.parseInt(match[2], 10);
        const candidate = new Date(now.getFullYear(), monthIndex, day);
        if (candidate.getTime() > startOfDay(now).getTime() + 24 * 3600 * 1000) {
          candidate.setFullYear(candidate.getFullYear() - 1);
        }
        return candidate;
      }
    }
    return startOfDay(now);
  }

  function combineDateAndTime(dateOnly, timeText) {
    const result = new Date(dateOnly);
    const match = String(timeText || '').trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (match) {
      let hours = Number.parseInt(match[1], 10) % 12;
      if (/pm/i.test(match[3])) hours += 12;
      result.setHours(hours, Number.parseInt(match[2], 10), 0, 0);
    }
    return result;
  }

  function findMessagePane() {
    return document.querySelector('.msg-s-message-list');
  }

  // LinkedIn lazy-loads older messages as the pane scrolls up. Scroll to the
  // top repeatedly, waiting for content to render, until either the
  // top-of-thread sentinel is reached or the pane's scrollHeight stops
  // growing for two consecutive rounds. Mirrors the stable-rounds pattern
  // li-profile-capture/content.js already uses for its down-scroll pass.
  async function scrollThreadToTop() {
    const pane = findMessagePane();
    if (!pane) throw new Error('Could not find the open conversation. Click into a message thread first.');

    let stableRounds = 0;
    let lastHeight = -1;
    const maxRounds = 60;

    for (let round = 0; round < maxRounds; round++) {
      const topSentinel = pane.querySelector('.msg-s-message-list__top-of-list');
      if (topSentinel && topSentinel.getBoundingClientRect().bottom >= pane.getBoundingClientRect().top) {
        reportProgress('running', 70, 'Reached the start of the conversation', '');
        break;
      }

      pane.scrollTop = 0;
      await delay(450);

      const height = pane.scrollHeight;
      reportProgress(
        'running',
        Math.min(65, 15 + round * 2),
        'Loading older messages',
        `Scroll pass ${round + 1}`
      );

      if (height === lastHeight) {
        stableRounds++;
        if (stableRounds >= 3) break;
      } else {
        stableRounds = 0;
      }
      lastHeight = height;
    }

    pane.scrollTop = 0;
    await delay(300);
  }

  function extractCandidateProfile() {
    const link = document.querySelector('a.msg-thread__link-to-profile');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const profileUrl = href.split('?')[0];
    const heading = link.querySelector('h2, h3');
    const name = (heading ? heading.innerText : link.innerText.split('\n')[0]).trim();
    return name && profileUrl ? { name, profileUrl } : null;
  }

  function extractThreadId() {
    const match = window.location.pathname.match(/\/messaging\/thread\/([^/]+)\/?/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function extractMessages(candidateName) {
    const pane = findMessagePane();
    if (!pane) return [];
    const events = [...pane.querySelectorAll('.msg-s-message-list-content > li.msg-s-message-list__event')];
    const normalizedCandidateName = candidateName.trim().toLowerCase();
    const now = new Date();

    let currentDateOnly = startOfDay(now);
    const messages = [];

    for (const li of events) {
      const dateHeading = li.querySelector('time.msg-s-message-list__time-heading');
      if (dateHeading) {
        currentDateOnly = resolveDateDivider(dateHeading.innerText, now);
      }

      const senderNameEl = li.querySelector('.msg-s-message-group__name');
      const timestampEl = li.querySelector('.msg-s-message-group__timestamp');
      if (!senderNameEl) continue;
      const senderName = senderNameEl.innerText.trim();
      const sentAt = combineDateAndTime(currentDateOnly, timestampEl ? timestampEl.innerText : '');
      const direction = senderName.toLowerCase() === normalizedCandidateName ? 'inbound' : 'outbound';

      const bubbles = [...li.querySelectorAll('.msg-s-event-listitem__message-bubble')];
      for (const bubble of bubbles) {
        const content = bubble.innerText.trim();
        if (!content) continue;
        messages.push({ sentAt: sentAt.toISOString(), direction, senderName, content });
      }
    }
    return messages;
  }

  async function run() {
    if (window.__liConvoCaptureRunning) {
      reportProgress('running', 5, 'Already ingesting this conversation', '');
      return;
    }
    window.__liConvoCaptureRunning = true;
    try {
      reportProgress('running', 5, 'Starting conversation scan', '');
      const candidate = extractCandidateProfile();
      if (!candidate) {
        throw new Error('Could not identify the other participant. Open a 1:1 message thread and try again.');
      }
      const threadId = extractThreadId();
      if (!threadId) throw new Error('Could not identify this conversation thread.');

      await scrollThreadToTop();

      reportProgress('running', 85, 'Reading messages', '');
      const messages = extractMessages(candidate.name);
      if (messages.length === 0) {
        throw new Error('No messages were found in this conversation.');
      }

      reportProgress('complete', 100, 'Conversation captured', `${messages.length} messages ready to ingest.`);
      return {
        externalConversationId: threadId,
        otherPartyName: candidate.name,
        otherPartyProfileUrl: candidate.profileUrl,
        ownerProfileUrl: '',
        messages,
      };
    } catch (error) {
      reportProgress(
        'failed',
        0,
        'Capture failed',
        error instanceof Error ? error.message : 'Unknown capture error.'
      );
      throw error;
    } finally {
      window.__liConvoCaptureRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'ingestConversationNow') {
      void run()
        .then((conversation) => sendResponse({ ok: true, conversation }))
        .catch((error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' })
        );
      return true;
    }
    return false;
  });

  console.log('[Skarion Conversation Capture] Content script loaded');
} // end initLiConvoCapture
