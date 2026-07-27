# LinkedIn Profile Capture (Chrome extension)

Auto-captures every LinkedIn profile you visit (name, headline, location,
about, experience, education, skills, certifications) and lets you export
the batch to Excel or send an individual profile straight into the Skarion
CRM as a lead.

## Install (unpacked, for internal team use — not published to the Chrome Web Store)

1. Ask a superadmin to generate you a personal API key: Identity Admin →
   **API Keys** → enter your email + a label (e.g. "Saki's laptop") →
   **Generate key**. Copy it immediately — it's shown once and can't be
   retrieved again.
2. Chrome → `chrome://extensions` → enable **Developer mode** (top right).
3. **Load unpacked** → select this `extension/li-profile-capture` folder.
4. Click the extension icon → ⚙ **Settings** → paste your API key. The CRM
   URL is pre-filled to production; only change it if you're pointing at a
   local dev instance.

## Use

- Browsing `linkedin.com/in/*` auto-captures the profile ~3s after the page
  settles (it scrolls through the page first so lazy-loaded sections like
  Experience actually render before scraping).
- Click the extension icon to see everything captured so far, search it,
  export the whole batch to `.xlsx`, or open a captured profile and hit
  **Send to CRM** to create a lead from it.
- Email is left as an auto-generated placeholder (`name-xxxx@placeholder.skarion`)
  since LinkedIn doesn't expose it on the profile page — replace it with a
  real address if you have one before sending, otherwise it's fine to leave
  as-is (matches the same placeholder convention the CRM's own CSV importer
  uses for leads with no known email).
- Sending the same LinkedIn URL twice does not create a duplicate lead — the
  CRM returns the existing one instead.

## Notes for whoever maintains this next

- `content.js` does the actual scraping — it's DOM-structure-dependent on
  LinkedIn's current markup and **will** break silently if LinkedIn changes
  their profile page layout. No automated tests here; if captures start
  coming back empty, check the selectors in `extractProfile()` first.
- API keys are per-teammate (`identity.api_keys`, see
  `apps/identity/src/services/api-keys.ts`), issued/revoked from the
  identity admin UI. `/extension/leads` on the CRM Worker rejects any
  request with a missing or revoked key — there's no anonymous fallback.
