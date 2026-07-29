// LinkedIn Profile Auto-Capture
// Runs on every linkedin.com/in/* page, extracts the full profile, saves to storage

// The manifest auto-loads this script on every profile page (document_idle),
// and the popup's "Capture Current Profile Now" button injects it again via
// chrome.scripting.executeScript into the same tab. Without a guard, the
// second injection would register a second MutationObserver on the same
// page (duplicate captures, doubled scroll/observer overhead) and both
// copies would race scrollAndCapture against each other. Guard on a property
// of `window` (not a top-level const/let) so re-injection reads it as
// already-true and returns instead of throwing a redeclaration error.
if (typeof window.__liProfileCaptureInitialized === 'undefined') {
  window.__liProfileCaptureInitialized = true;
  window.__liProfileCaptureRunning = false;
  initLiProfileCapture();
}

function initLiProfileCapture() {
  const CAPTURE_DELAY = 3000; // wait for lazy sections to render

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
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

    for (let round = 0; round < maxRounds; round++) {
      // Scroll down in a modest step so LinkedIn's intersection observers fire
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
      await delay(500); // give the page time to render whatever just scrolled into view

      const height = document.body.scrollHeight;
      const sectionCount = document.querySelectorAll('section').length;
      const atBottom = window.scrollY + window.innerHeight >= height - 100;

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
      }
    }

    // Extra settle time, then click any expanders and give the DOM one more beat
    await delay(400);
    clickExpanders();
    await delay(400);

    // Scroll back to top for a clean state
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

  function extractProfile() {
    const url = window.location.href.split('?')[0];
    const profileId = url.split('/in/')[1]?.replace(/\/$/, '') || '';

    // --- Header ---
    const headerSec = (() => {
      for (const sec of document.querySelectorAll('section')) {
        const h2 = sec.querySelector('h2');
        if (h2 && h2.innerText.trim() === document.title.split('|')[0].trim()) return sec;
      }
      return null;
    })();

    const name = document.title.split('|')[0].trim();
    const headline =
      document
        .querySelector('div[data-generated-suggestion-target] + div, .text-body-medium')
        ?.innerText?.trim() ||
      (() => {
        // fallback: find line after name in page text
        const lines = document.body.innerText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const ni = lines.findIndex((l) => l === name);
        return ni >= 0 ? lines[ni + 1] : '';
      })();

    const location = (() => {
      const spans = Array.from(document.querySelectorAll('span.text-body-small'));
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
    const companies = Array.from(document.querySelectorAll('a[href*="/company/"]'))
      .map((a) => a.innerText.trim())
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

    // Auto-capture (on load) and the popup's manual re-injection can both call
    // run() close together; without this lock they'd scroll/observe the same
    // page concurrently.
    if (window.__liProfileCaptureRunning) return;
    window.__liProfileCaptureRunning = true;

    try {
      await scrollAndCapture();

      const profile = extractProfile();
      if (!profile.name || profile.name === 'LinkedIn') return;

      // Preserve the idempotency key across re-captures of the same profile so
      // repeated sends to the CRM stay recognizable as the same intent.
      const existing = await new Promise((resolve) => {
        chrome.storage.local.get(['profiles'], (data) => resolve(data.profiles || {}));
      });
      const prior = existing[profile.profileId] || {};
      profile.idempotencyKey = prior.idempotencyKey || crypto.randomUUID();
      // Refresh scraped LinkedIn fields without erasing the persistent CRM
      // delivery receipt added by popup.js after the server confirms a send.
      existing[profile.profileId] = { ...prior, ...profile };
      chrome.storage.local.set({ profiles: existing });
      console.log(`[LI Capture] Saved: ${profile.name} (${profile.profileId})`);

      // Badge the extension icon with count
      const count = Object.keys(existing).length;
      chrome.runtime.sendMessage({ action: 'updateBadge', count });
    } finally {
      window.__liProfileCaptureRunning = false;
    }
  }

  // Run after page is stable
  setTimeout(run, CAPTURE_DELAY);

  // Also listen for SPA navigation within the same tab
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastUrl && window.location.href.includes('/in/')) {
      lastUrl = window.location.href;
      setTimeout(run, CAPTURE_DELAY);
    }
  }).observe(document.body, { childList: true, subtree: true });

  console.log('[LI Profile Capture] Content script loaded');
} // end initLiProfileCapture
