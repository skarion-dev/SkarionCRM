# Skarion Conversation Capture extension

Ingests the LinkedIn message thread you have open into Skarion CRM, then
drafts three reply options from the candidate-conversation agent.

## Workflow

1. Open a candidate's LinkedIn message thread.
2. Open the extension and click **Ingest**. It scrolls the thread to the
   top to load the full history, matches or creates the candidate lead by
   their LinkedIn URL, and stores the conversation in CRM.
3. Click **Draft**. Three copy-ready reply options render below.
4. Copy one and paste it into LinkedIn yourself — nothing is sent
   automatically.

Uses the same CRM URL and personal extension API key as
`li-profile-capture` (paste the same `{crmUrl, apiKey}` blob from the admin
panel's "Copy for extension" button).

Reload the unpacked extension from `chrome://extensions` after changing
files.
