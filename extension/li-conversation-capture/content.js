// Skarion Conversation Capture
// Runs on linkedin.com pages and waits for an explicit popup command:
// - "ingestConversationNow" on a linkedin.com/messaging/thread/ page: scrolls
//   the open thread's message pane to the top to force LinkedIn to lazy-load
//   the full history, then extracts it into a plain array the popup POSTs to
//   the CRM.
// - "captureConnectionNoteProfile" on a linkedin.com/in/ page: scrolls the
//   profile to render every lazy-loaded section (mirrors
//   li-profile-capture/content.js's scrollAndCapture), then extracts the
//   header/about/experience/education/skills text for the connection-note
//   agent — no CRM write happens here, the popup does that.

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

  // --- Profile-page scraping (linkedin.com/in/*), for the connection-note
  // agent. Ported directly from li-profile-capture/content.js so both
  // extensions read the profile the same way — this file doesn't do
  // anything with the result besides return it to the popup.

  function compactText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function isPlausibleProfileName(value) {
    const cleaned = compactText(value);
    if (cleaned.length < 2 || cleaned.length > 120 || !/\p{L}/u.test(cleaned)) return false;
    if (/^\(\d+\)(?:\s|$)/u.test(cleaned)) return false;
    return !/^(?:\(\d+\)\s*)?(?:activity|recent activity|all activity|posts?|comments?|reactions?|followers?|connections?|notifications?|messaging|jobs?|home|feed|my network|linkedin)$/i.test(
      cleaned
    );
  }

  function cleanDocumentTitle(value) {
    return compactText(value)
      .replace(/\s*\|\s*LinkedIn.*$/i, '')
      .split(' - ')[0]
      .trim();
  }

  function clickProfileExpanders() {
    let clicked = 0;
    document.querySelectorAll('button, span[role="button"]').forEach((btn) => {
      const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (
        txt === 'see more' ||
        txt === 'show more' ||
        txt === '…more' ||
        txt.includes('show all experiences') ||
        txt.includes('show all education')
      ) {
        btn.click();
        clicked++;
      }
    });
    return clicked;
  }

  function extractProfileSection(sectionHeading) {
    const sections = document.querySelectorAll('section');
    for (const sec of sections) {
      const h2 = sec.querySelector('h2');
      if (h2 && h2.innerText.trim().toLowerCase().includes(sectionHeading.toLowerCase())) {
        return sec.innerText.trim();
      }
    }
    return '';
  }

  // Same multi-pass scroller as li-profile-capture: LinkedIn only renders
  // Experience/Education/Skills as those sections scroll into view, and
  // rendering lags behind the scroll itself, so a single scroll-to-bottom
  // isn't enough.
  async function scrollProfileAndCapture() {
    let stableRounds = 0;
    let lastHeight = 0;
    let lastSectionCount = 0;
    const maxRounds = 40;

    for (let round = 0; round < maxRounds; round++) {
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      await delay(500);

      const height = document.body.scrollHeight;
      const sectionCount = document.querySelectorAll('section').length;
      const atBottom = window.scrollY + window.innerHeight >= height - 100;
      const scrollableHeight = Math.max(1, height - window.innerHeight);
      const pageProgress = Math.min(1, window.scrollY / scrollableHeight);
      reportProgress(
        'running',
        Math.min(65, Math.round(15 + pageProgress * 50)),
        'Loading LinkedIn profile sections',
        `Scroll pass ${round + 1}`
      );

      if (height === lastHeight && sectionCount === lastSectionCount && atBottom) {
        stableRounds++;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
      }
      lastHeight = height;
      lastSectionCount = sectionCount;

      if (atBottom && stableRounds === 0) {
        await delay(700);
      }
    }

    reportProgress('running', 70, 'Expanding profile details', 'Opening "see more" sections.');
    await delay(400);
    clickProfileExpanders();
    await delay(400);

    reportProgress('running', 80, 'Finalizing profile scan', '');
    window.scrollTo({ top: 0, behavior: 'instant' });
    await delay(300);
  }

  function extractProfile() {
    const url = window.location.href.split('?')[0];

    const nameCandidates = [
      ...document.querySelectorAll(
        'main h1, .pv-text-details__left-panel h1, [data-view-name="profile-top-card"] h1'
      ),
    ];
    const nameElement = nameCandidates.find((element) =>
      isPlausibleProfileName(element.innerText || element.textContent)
    );
    const metadataName = cleanDocumentTitle(
      document.querySelector('meta[property="og:title"]')?.getAttribute('content')
    );
    const titleName = cleanDocumentTitle(document.title);
    const name =
      compactText(nameElement?.innerText || nameElement?.textContent) ||
      (isPlausibleProfileName(metadataName) ? metadataName : '') ||
      (isPlausibleProfileName(titleName) ? titleName : '');
    const headerSec =
      nameElement?.closest('section') ||
      nameElement?.closest('[data-view-name="profile-top-card"]') ||
      null;
    const headline =
      headerSec
        ?.querySelector('div[data-generated-suggestion-target] + div, .text-body-medium')
        ?.innerText?.trim() ||
      (() => {
        if (!headerSec) return '';
        const lines = headerSec.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
        const ni = lines.findIndex((l) => l === name);
        return ni >= 0 ? lines[ni + 1] : '';
      })();

    const location = (() => {
      const spans = Array.from(headerSec?.querySelectorAll('span.text-body-small') || []);
      for (const s of spans) {
        const t = s.innerText.trim();
        if (t.includes(',') && !t.includes('@') && t.length < 80) return t;
      }
      return '';
    })();

    const about = extractProfileSection('About').replace(/^About\n/, '').trim();
    const experience = extractProfileSection('Experience').replace(/^Experience\n/, '').trim();
    const education = extractProfileSection('Education').replace(/^Education\n/, '').trim();
    const skills = extractProfileSection('Skills').replace(/^Skills\n/, '').trim();

    return { profileUrl: url, name, headline, location, about, experience, education, skills };
  }

  async function captureConnectionNoteProfile() {
    if (window.__liConvoCaptureRunning) {
      reportProgress('running', 5, 'Already capturing this profile', '');
      return;
    }
    window.__liConvoCaptureRunning = true;
    try {
      reportProgress('running', 10, 'Starting profile scan', '');
      await scrollProfileAndCapture();
      reportProgress('running', 90, 'Reading profile data', '');
      const profile = extractProfile();
      if (!isPlausibleProfileName(profile.name)) {
        throw new Error(
          'Could not read this profile. Return to the main profile page, reload it, and try again.'
        );
      }
      reportProgress('complete', 100, 'Profile captured', `${profile.name}'s profile is ready.`);
      return profile;
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
    // When this frame is the child iframe LinkedIn sometimes renders the
    // real thread inside (see the all_frames comment above), this frame's
    // own window.location is something unrelated (observed: /preload/) —
    // only the top-level window's address bar URL actually has the thread
    // id. Same-origin (both www.linkedin.com), so window.top is reachable.
    let pathname = window.location.pathname;
    try {
      if (window.top && window.top !== window) pathname = window.top.location.pathname;
    } catch {
      // Cross-origin top window (shouldn't happen on linkedin.com, but
      // fall back to this frame's own location rather than throwing).
    }
    const match = pathname.match(/\/messaging\/thread\/([^/]+)\/?/);
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

  // LinkedIn's messaging UI is a client-side SPA: switching threads in the
  // conversation list doesn't reload the page, and the new thread's header
  // (candidate name + profile link) can take a beat to re-render after the
  // URL/selection changes. A single synchronous query right after a thread
  // switch can catch that gap and find nothing. Retry briefly before giving up.
  async function extractCandidateProfileWithRetry() {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = extractCandidateProfile();
      if (candidate) return candidate;
      if (attempt < maxAttempts - 1) {
        reportProgress('running', 5, 'Waiting for the conversation to finish loading', '');
        await delay(300);
      }
    }
    return null;
  }

  async function run() {
    if (window.__liConvoCaptureRunning) {
      reportProgress('running', 5, 'Already ingesting this conversation', '');
      return;
    }
    window.__liConvoCaptureRunning = true;
    try {
      reportProgress('running', 5, 'Starting conversation scan', '');
      const candidate = await extractCandidateProfileWithRetry();
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
      // The manifest injects this script into every linkedin.com frame
      // (all_frames: true) because LinkedIn sometimes renders the real
      // messaging UI inside a same-origin child iframe (observed:
      // /preload/?_bprMode=vanilla) instead of the top-level document —
      // the top frame is left an empty shell in that case. Only the one
      // frame that actually has the message list should ever answer;
      // every other frame silently declines instead of racing a wrong
      // or empty response back to the popup.
      if (!findMessagePane()) return false;
      void run()
        .then((conversation) => sendResponse({ ok: true, conversation }))
        .catch((error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' })
        );
      return true;
    }
    if (message.action === 'captureConnectionNoteProfile') {
      const hasProfileHeader = document.querySelector(
        'main h1, .pv-text-details__left-panel h1, [data-view-name="profile-top-card"] h1'
      );
      if (!hasProfileHeader) return false;
      void captureConnectionNoteProfile()
        .then((profile) => sendResponse({ ok: true, profile }))
        .catch((error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' })
        );
      return true;
    }
    return false;
  });

  console.log('[Skarion Conversation Capture] Content script loaded');
} // end initLiConvoCapture
