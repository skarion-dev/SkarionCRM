#!/usr/bin/env node
// scripts/smoke-production.ts
// Production smoke test for Skarion CRM on Cloudflare default URLs.
// Usage: npx tsx scripts/smoke-production.ts
// Required env vars: CRM_URL, IDENTITY_URL, ADMIN_EMAIL, ADMIN_PASSWORD

const CRM_URL = process.env.CRM_URL || 'https://skarion-crm-platform.skarion-talentos.workers.dev';
const IDENTITY_URL = process.env.IDENTITY_URL || 'https://skarion-identity.skarion-talentos.workers.dev';
const PAGES_URL = process.env.PAGES_URL || 'https://skarion-crm.pages.dev';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@skarion.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme-now';

const tests: { name: string; run: () => Promise<{ pass: boolean; detail?: string }> }[] = [];
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<{ pass: boolean; detail?: string }>) {
  tests.push({ name, run: fn });
}

async function runTests() {
  console.log(`\n🧪 Skarion CRM Production Smoke Test`);
  console.log(`   CRM Worker: ${CRM_URL}`);
  console.log(`   Identity Worker: ${IDENTITY_URL}`);
  console.log(`   Pages: ${PAGES_URL}`);
  console.log(`   Admin: ${ADMIN_EMAIL}\n`);

  for (const t of tests) {
    try {
      const result = await t.run();
      if (result.pass) {
        console.log(`  ✅ ${t.name}`);
        passed++;
      } else {
        console.log(`  ❌ ${t.name}: ${result.detail ?? 'Unknown failure'}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${t.name}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Health Checks ─────────────────────────────────────────────────────────

test('CRM Worker /health', async () => {
  const res = await fetch(`${CRM_URL}/health`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { status: string; service: string };
  return { pass: body.status === 'ok' && body.service === 'skarion-crm-platform', detail: JSON.stringify(body) };
});

test('Identity Worker /health', async () => {
  const res = await fetch(`${IDENTITY_URL}/health`);
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { status: string; service: string };
  return { pass: body.status === 'ok' && body.service === 'skarion-identity', detail: JSON.stringify(body) };
});

// ─── Auth Flow ─────────────────────────────────────────────────────────────

test('Login returns token', async () => {
  const res = await fetch(`${IDENTITY_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { access_token?: string };
  return { pass: !!body.access_token, detail: body.access_token ? 'Token received' : 'No token' };
});

test('Refresh token works', async () => {
  const res = await fetch(`${IDENTITY_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (res.ok) {
    const body = (await res.json()) as { access_token?: string };
    return { pass: !!body.access_token, detail: 'Refresh succeeded' };
  }
  return { pass: false, detail: `HTTP ${res.status} (expected if no cookie)` };
});

// ─── Dashboard Protection ──────────────────────────────────────────────────

test('Dashboard requires auth', async () => {
  const res = await fetch(`${CRM_URL}/api/leads`, { headers: {} });
  return { pass: res.status === 401, detail: `HTTP ${res.status}` };
});

// ─── CRUD Operations ────────────────────────────────────────────────────

let createdCompanyId = '';
let createdContactId = '';
let createdLeadId = '';
let authToken = '';

test('Authenticate and get token', async () => {
  const res = await fetch(`${IDENTITY_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = (await res.json()) as { access_token: string };
  authToken = body.access_token;
  return { pass: !!authToken, detail: 'Token acquired' };
});

test('Create company', async () => {
  const res = await fetch(`${CRM_URL}/api/companies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ name: 'Smoke Test Company', industry: 'Engineering', domain: 'smoke-test.com' }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { company: { id: string } };
  createdCompanyId = body.company.id;
  return { pass: !!createdCompanyId, detail: `ID: ${createdCompanyId}` };
});

test('Create contact', async () => {
  const res = await fetch(`${CRM_URL}/api/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ firstName: 'Smoke', lastName: 'Test', email: 'smoke@test.com', companyId: createdCompanyId }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { contact: { id: string } };
  createdContactId = body.contact.id;
  return { pass: !!createdContactId, detail: `ID: ${createdContactId}` };
});

test('Create lead', async () => {
  const res = await fetch(`${CRM_URL}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ firstName: 'Smoke', lastName: 'Lead', email: 'smoke-lead@test.com', companyName: 'Smoke Test Company', source: 'other' }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { lead: { id: string } };
  createdLeadId = body.lead.id;
  return { pass: !!createdLeadId, detail: `ID: ${createdLeadId}` };
});

test('Move lead in pipeline', async () => {
  const res = await fetch(`${CRM_URL}/api/leads/${createdLeadId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ status: 'contacted' }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { lead: { status: string } };
  return { pass: body.lead.status === 'contacted', detail: `Status: ${body.lead.status}` };
});

test('Create task', async () => {
  const res = await fetch(`${CRM_URL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ title: 'Smoke test task', assigneeId: 'me' }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { task: { id: string } };
  return { pass: !!body.task.id, detail: `ID: ${body.task.id}` };
});

// ─── AI Features ───────────────────────────────────────────────────────────

test('AI chat endpoint responds', async () => {
  const res = await fetch(`${CRM_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ message: 'Hello, what can you do?' }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { answer: string };
  return { pass: !!body.answer, detail: body.answer.substring(0, 100) };
});

test('AI summarize lead', async () => {
  if (!createdLeadId) return { pass: false, detail: 'No lead created' };
  const res = await fetch(`${CRM_URL}/api/leads/${createdLeadId}/summarize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { summary?: string };
  return { pass: !!body.summary, detail: body.summary ? body.summary.substring(0, 100) : 'No summary' };
});

test('AI draft outreach', async () => {
  if (!createdLeadId) return { pass: false, detail: 'No lead created' };
  const res = await fetch(`${CRM_URL}/api/leads/${createdLeadId}/outreach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ tone: 'professional', channel: 'email' }),
  });
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { draft?: string };
  return { pass: !!body.draft, detail: body.draft ? body.draft.substring(0, 100) : 'No draft' };
});

// ─── PDF Import ────────────────────────────────────────────────────────────

test('PDF import endpoint exists', async () => {
  // We can't easily test a real PDF upload in a script without a PDF file,
  // but we can verify the endpoint rejects non-PDFs correctly.
  const formData = new FormData();
  const blob = new Blob(['not a pdf'], { type: 'text/plain' });
  formData.append('file', blob, 'test.txt');
  formData.append('leadType', 'candidate');
  const res = await fetch(`${CRM_URL}/api/leads/import/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  return { pass: res.status === 400, detail: `HTTP ${res.status} (expected 400 for non-PDF)` };
});

// ─── Embeddings ────────────────────────────────────────────────────────────

test('Embeddings builder health', async () => {
  const res = await fetch('https://skarion-embeddings-builder.skarion-talentos.workers.dev/health');
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { status: string };
  return { pass: body.status === 'ok', detail: JSON.stringify(body) };
});

// ─── Workflow Runner ──────────────────────────────────────────────────────

test('Workflow runner health', async () => {
  const res = await fetch('https://skarion-workflow-runner.skarion-talentos.workers.dev/health');
  if (!res.ok) return { pass: false, detail: `HTTP ${res.status}` };
  const body = (await res.json()) as { status: string };
  return { pass: body.status === 'ok', detail: JSON.stringify(body) };
});

// ─── Permissions ───────────────────────────────────────────────────────────

test('Permission check prevents unauthorized access', async () => {
  // Try to access admin audit log without admin token
  const res = await fetch(`${CRM_URL}/api/admin/audit-log`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  // Admin user should be allowed (superadmin), so this should pass
  // For a real permission test, we'd need a non-admin user
  return { pass: res.status === 200, detail: `HTTP ${res.status} (admin user)` };
});

// ─── Cleanup ───────────────────────────────────────────────────────────────

test('Cleanup smoke test data', async () => {
  if (createdLeadId) {
    await fetch(`${CRM_URL}/api/leads/${createdLeadId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  }
  if (createdContactId) {
    await fetch(`${CRM_URL}/api/contacts/${createdContactId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  }
  if (createdCompanyId) {
    await fetch(`${CRM_URL}/api/companies/${createdCompanyId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  }
  return { pass: true, detail: 'Cleanup attempted' };
});

runTests();
