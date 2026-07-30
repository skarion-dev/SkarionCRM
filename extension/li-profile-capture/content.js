// LinkedIn Profile Capture
// Runs on linkedin.com/in/* pages and waits for an explicit popup command.

// The manifest auto-loads this script on every profile page (document_idle),
// and the popup's "Capture Current Profile Now" button injects it again via
// chrome.scripting.executeScript into the same tab. Without a guard, the
// second injection would register a second MutationObserver on the same
// page (duplicate captures, doubled scroll/observer overhead) and both
// copies would race scrollAndCapture against each other. Guard on a property
// of `window` (not a top-level const/let) so re-injection reads it as
// already-current and returns instead of throwing a redeclaration error.
// Comparing the manifest version also lets a newly reloaded extension replace
// an orphaned listener from the prior version without requiring a tab refresh.
if (window.__liProfileCaptureVersion !== chrome.runtime.getManifest().version) {
  window.__liProfileCaptureVersion = chrome.runtime.getManifest().version;
  window.__liProfileCaptureInitialized = true;
  window.__liProfileCaptureRunning = false;
  initLiProfileCapture();
}

function initLiProfileCapture() {
  let currentProgress = {
    status: 'idle',
    percent: 0,
    message: 'Ready to capture',
    detail: 'Choose a review decision in the extension popup.',
  };

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function profileIdFromUrl() {
    return window.location.href.split('/in/')[1]?.split('?')[0]?.replace(/\/$/, '') || '';
  }

  function reportProgress(status, percent, message, detail = '') {
    currentProgress = { status, percent, message, detail };
    chrome.runtime.sendMessage(
      {
        action: 'scrapeProgress',
        status,
        percent,
        message,
        detail,
        profileId: profileIdFromUrl(),
      },
      () => void chrome.runtime.lastError
    );
  }

  // Thorough multi-pass scroller: LinkedIn only renders Experience/Education/Skills
  // as those sections scroll into view, and rendering lags behind the scroll itself.
  // A single fast scroll-to-bottom isn't enough — we need to pause at each step
  // and keep re-checking until the page stops growing.
  async function scrollAndCapture() {
    let stableRounds = 0;
    let lastHeight = 0;
    let lastSectionCount = 0;
    const maxRounds = 40; // hard cap so we never loop forever
    let highestPercent = 15;

    for (let round = 0; round < maxRounds; round++) {
      // Scroll down in a modest step so LinkedIn's intersection observers fire
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      await delay(500); // give the page time to render whatever just scrolled into view

      const height = document.body.scrollHeight;
      const sectionCount = document.querySelectorAll('section').length;
      const visibleSectionNames = Array.from(document.querySelectorAll('section h2'))
        .map((heading) => heading.innerText.trim())
        .filter(Boolean)
        .slice(-3);
      const atBottom = window.scrollY + window.innerHeight >= height - 100;
      const scrollableHeight = Math.max(1, height - window.innerHeight);
      const pageProgress = Math.min(1, window.scrollY / scrollableHeight);
      highestPercent = Math.max(highestPercent, Math.round(15 + pageProgress * 55));
      reportProgress(
        'running',
        highestPercent,
        'Loading LinkedIn profile sections',
        `Scroll pass ${round + 1} · ${sectionCount} sections${visibleSectionNames.length ? ` · ${visibleSectionNames.join(', ')}` : ''}`
      );

      // Consider things "stable" once neither page height nor section count
      // has grown for two consecutive rounds AND we've reached the bottom
      if (height === lastHeight && sectionCount === lastSectionCount && atBottom) {
        stableRounds++;
        if (stableRounds >= 2) break;
      } else {
        stableRounds = 0;
      }

      lastHeight = height;
      lastSectionCount = sectionCount;

      if (atBottom && stableRounds === 0) {
        // We hit the bottom but content is still growing — pause a bit longer
        // to let lazy sections (Experience/Education/Skills) finish rendering
        await delay(700);
        reportProgress(
          'running',
          Math.max(highestPercent, 72),
          'Waiting for lazy-loaded sections',
          'LinkedIn is still adding profile content.'
        );
      }
    }

    // Extra settle time, then click any expanders and give the DOM one more beat
    reportProgress('running', 78, 'Expanding profile details', 'Opening “see more” sections.');
    await delay(400);
    const expanded = clickExpanders();
    reportProgress(
      'running',
      84,
      'Expanded profile details',
      `${expanded} expandable section${expanded === 1 ? '' : 's'} opened`
    );
    await delay(400);

    // Scroll back to top for a clean state
    reportProgress('running', 88, 'Finalizing page scan', 'Returning the profile to the top.');
    window.scrollTo({ top: 0, behavior: 'instant' });
    await delay(300);
  }

  function clickExpanders() {
    // Click "…see more", "Show more" buttons to expand truncated text
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

  function extractSection(sectionHeading) {
    const sections = document.querySelectorAll('section');
    for (const sec of sections) {
      const h2 = sec.querySelector('h2');
      if (h2 && h2.innerText.trim().toLowerCase().includes(sectionHeading.toLowerCase())) {
        return sec.innerText.trim();
      }
    }
    return '';
  }

  function compactText(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
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

  function cleanCompanyName(value) {
    const candidate =
      String(value || '')
        .split(/\r?\n|,/)
        .map(compactText)
        .find(Boolean) || '';
    if (!candidate || candidate.length > 120) return '';
    if (
      /\b(?:full-time|part-time|self-employed|internship|contract|temporary|apprenticeship|seasonal)\b/i.test(
        candidate
      ) ||
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(
        candidate
      ) ||
      /\b\d+\s+(?:yr|yrs|year|years|mo|mos|month|months)\b/i.test(candidate)
    ) {
      return '';
    }
    return candidate;
  }

  function extractProfile() {
    const url = window.location.href.split('?')[0];
    const profileId = url.split('/in/')[1]?.replace(/\/$/, '') || '';

    // --- Header ---
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
        const lines = headerSec.innerText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
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

    // --- About ---
    const about = extractSection('About')
      .replace(/^About\n/, '')
      .trim();

    // --- Experience ---
    const experienceRaw = extractSection('Experience');
    const experience = experienceRaw.replace(/^Experience\n/, '').trim();

    // --- Education ---
    const educationRaw = extractSection('Education');
    const education = educationRaw.replace(/^Education\n/, '').trim();

    // --- Skills ---
    const skillsRaw = extractSection('Skills');
    const skills = skillsRaw.replace(/^Skills\n/, '').trim();

    // --- Certifications ---
    const certsRaw = extractSection('Licenses') || extractSection('Certifications');
    const certifications = certsRaw
      .replace(/^Licenses.*?\n/, '')
      .replace(/^Certifications\n/, '')
      .trim();

    // --- Connections ---
    const connectionsMatch = document.body.innerText.match(/(\d+)\s+connections/i);
    const connections = connectionsMatch ? connectionsMatch[1] : '';

    // --- Current company from header ---
    const companies = Array.from(headerSec?.querySelectorAll('a[href*="/company/"]') || [])
      .map((a) => cleanCompanyName(a.innerText || a.textContent))
      .filter(Boolean)
      .slice(0, 3);

    return {
      capturedAt: new Date().toISOString(),
      profileUrl: url,
      profileId,
      name,
      headline,
      location,
      connections,
      currentCompanies: [...new Set(companies)].join(', '),
      about,
      experience,
      education,
      skills,
      certifications,
    };
  }

  async function run() {
    // Only capture actual profile pages, not overlays/redirects
    if (!window.location.href.includes('/in/')) return;

    // Repeated button clicks or reinjection can call run() close together;
    // without this lock they would scroll/observe the same page concurrently.
    if (window.__liProfileCaptureRunning) {
      reportProgress(
        currentProgress.status,
        currentProgress.percent,
        currentProgress.message,
        currentProgress.detail
      );
      return;
    }
    window.__liProfileCaptureRunning = true;

    try {
      reportProgress('running', 10, 'Starting profile scan', 'Preparing the LinkedIn page.');
      await scrollAndCapture();

      reportProgress('running', 92, 'Reading profile data', 'Extracting visible profile fields.');
      const profile = extractProfile();
      if (!isPlausibleProfileName(profile.name)) {
        throw new Error(
          'LinkedIn is showing an activity or navigation view instead of the profile header. Return to the main profile page, reload it, and capture again.'
        );
      }

      profile.idempotencyKey = crypto.randomUUID();
      reportProgress('running', 97, 'Preparing CRM review', 'Keeping this capture in memory only.');
      reportProgress(
        'complete',
        100,
        'Profile captured',
        `${profile.name} is ready for a review decision. Nothing was saved locally.`
      );
      return profile;
    } catch (error) {
      reportProgress(
        'failed',
        currentProgress.percent,
        'Capture failed',
        error instanceof Error ? error.message : 'Unknown capture error.'
      );
      throw error;
    } finally {
      window.__liProfileCaptureRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'captureProfileNow') {
      void run()
        .then((profile) => sendResponse({ ok: true, profile }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Capture failed.',
          })
        );
      return true;
    }
    return false;
  });

  reportProgress(
    'idle',
    0,
    'Ready to capture',
    'Nothing is queued automatically. Choose an action in the extension popup.'
  );

  // Also listen for SPA navigation within the same tab
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastUrl && window.location.href.includes('/in/')) {
      lastUrl = window.location.href;
      reportProgress(
        'idle',
        0,
        'New LinkedIn profile detected',
        'Nothing is queued automatically. Choose an action in the extension popup.'
      );
    }
  }).observe(document.body, { childList: true, subtree: true });

  console.log('[LI Profile Capture] Content script loaded');
} // end initLiProfileCapture
