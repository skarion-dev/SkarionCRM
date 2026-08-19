# Skarion Conversation Capture extension

Ingests the LinkedIn message thread you have open into Skarion CRM, then
drafts three reply — or follow-up — options from the candidate-conversation
agent.

## Workflow

1. Open a candidate's LinkedIn message thread.
2. Open the extension and click **Ingest**. It scrolls the thread to the
   top to load the full history, matches or creates the candidate lead by
   their LinkedIn URL, and stores the conversation in CRM.
3. Click **Draft Reply** (they messaged you back) or **Follow Up** (you're
   still waiting on a reply). The button matching the conversation's actual
   state gets a dark outline after Ingest. Three copy-ready options render
   below either way.
4. Copy one and paste it into LinkedIn yourself — nothing is sent
   automatically.

Follow-up drafts use a separate prompt tuned for re-engaging a quiet
candidate: short, casual, references one specific detail, ends with one
ask — not a repeat of the full pitch.

Uses the same CRM URL and personal extension API key as
`li-profile-capture` (paste the same `{crmUrl, apiKey}` blob from the admin
panel's "Copy for extension" button).

Reload the unpacked extension from `chrome://extensions` after changing
files.
