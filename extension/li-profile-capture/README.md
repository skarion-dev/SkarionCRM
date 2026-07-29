# LinkedIn Profile Capture (Chrome extension)

Auto-captures every LinkedIn profile you visit (name, headline, location,
about, experience, education, skills, certifications) and sends reviewed
profiles straight into Skarion CRM as leads.

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
- Click the extension icon to see everything captured so far. **Captured**
  means saved locally in Chrome; it has not reached CRM until the profile
  displays the green **Sent to CRM** badge.
- Click a profile or **Review & Send to CRM**, review the form, then press
  **Send to CRM**. The extension only marks the profile as sent after the
  CRM server confirms the record and provides an **Open in CRM** link.
- **Lead quality tiers**: on a captured profile's detail view, one click on
  a tier button (Excellent Fit / Good Fit / Future Fit / Indian / Worth
  Trying) pre-fills the lead form with that tier as a tag and opens it for
  a final review — this is the actual point of the extension: tag a
  profile's fit the moment you look at it, don't come back to it later. Edit
  `QUALITY_TIERS` in `popup.js` to change the tier set; tiers are plain CRM
  tags, not a separate field, so nothing else needs updating.
- Email is optional because LinkedIn does not expose it on profile pages. The
  extension and CRM do not manufacture placeholder addresses.
- Sending the same LinkedIn URL twice does not create a duplicate lead — the
  CRM returns the existing one instead.
- After a new LinkedIn lead is saved, the Vertex-backed qualification workflow
  scores it, stores the detailed assessment, and generates a personalized
  connection-request note capped at 300 characters. The extension keeps the
  lead form open and shows **Copy note** so the message can be pasted directly
  into LinkedIn.

## Notes for whoever maintains this next

- `content.js` does the actual scraping — it's DOM-structure-dependent on
  LinkedIn's current markup and **will** break silently if LinkedIn changes
  their profile page layout. No automated tests here; if captures start
  coming back empty, check the selectors in `extractProfile()` first.
- API keys are per-teammate (`identity.api_keys`, see
  `apps/identity/src/services/api-keys.ts`), issued/revoked from the
  identity admin UI. `/extension/leads` on the CRM Worker rejects any
  request with a missing or revoked key — there's no anonymous fallback.
