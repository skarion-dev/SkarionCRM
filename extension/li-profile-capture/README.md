# Skarion Prospect Review extension

Version 2 reviews one visible LinkedIn profile at a time and writes the
decision directly to the existing Skarion prospect record.

## Workflow

1. Import profile URLs into **Prospect Review** in the CRM.
2. Open a LinkedIn profile manually.
3. Open the extension and choose **Excellent Fit**, **Worth Trying**,
   **Maybe**, **Future**, or **Disqualify**.
4. The extension captures visible profile data in memory, sends the capture
   and decision to CRM, and discards the payload after confirmation.

The extension has no saved-profile queue, capture-only mode, Excel export, or
bulk-send path. Only the CRM URL and the user's personal extension API key are
stored locally.

## Decision behavior

- Excellent Fit, Worth Trying, and Maybe promote the same lead number into
  active Leads and queue the cheap scoring/connection-note workflow.
- Future promotes the record into Nurture without immediate AI work.
- Disqualify rejects the prospect while preserving it for deduplication and
  audit history.

Reload the unpacked extension from `chrome://extensions` after changing files.
