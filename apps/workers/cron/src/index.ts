// apps/workers/cron/src/index.ts
// Triggers periodic workflow evaluations and drains the CRM AI enrichment queues.

export interface Env {
  WORKFLOW_RUNNER_URL: string;
  CRM_API_URL: string;
  WORKFLOW_RUNNER_SECRET: string;
  CRM_SERVICE: Fetcher;
  WORKFLOW_RUNNER_SERVICE: Fetcher;
}

const QUEUE_BATCH_SIZE = 30;

type QueueDrainResult = {
  profileCleanup: unknown;
  leadScoring: unknown;
  linkedinSync: unknown;
};

async function drainEndpoint(env: Env, path: string): Promise<unknown> {
  const url = new URL(`https://crm.internal${path}`);
  if (!url.searchParams.has('limit')) url.searchParams.set('limit', String(QUEUE_BATCH_SIZE));
  const response = await env.CRM_SERVICE.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WORKFLOW_RUNNER_SECRET}`,
      },
    })
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${body}`);
  }
  return body ? JSON.parse(body) : {};
}

async function drainAiQueues(env: Env): Promise<QueueDrainResult> {
  // Cleanup runs first because the separate scoring agent consumes the
  // structured profile. Pending Prospect Review rows are prioritized by CRM.
  const profileCleanup = await drainEndpoint(env, '/internal/lead-profile-queue/drain');
  const leadScoring = await drainEndpoint(env, '/internal/lead-score-queue/drain');
  const linkedinSync = await drainEndpoint(
    env,
    '/internal/linkedin-sync-queue/drain?messageLimit=5&invitationLimit=25'
  );
  return { profileCleanup, leadScoring, linkedinSync };
}

async function syncTalentOsCompanies(env: Env): Promise<unknown> {
  const response = await env.CRM_SERVICE.fetch(
    new Request('https://crm.internal/internal/talentos/companies/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WORKFLOW_RUNNER_SECRET}` },
    })
  );
  const body = await response.text();
  if (!response.ok)
    throw new Error(`/internal/talentos/companies/sync failed: ${response.status} ${body}`);
  const syncResult = body ? JSON.parse(body) : {};
  const enqueue = await drainEndpoint(env, '/internal/talentos/companies/research/enqueue?limit=1');
  return { sync: syncResult, researchQueue: enqueue };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'skarion-cron' }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    if (url.pathname === '/run-now' && request.method === 'POST') {
      if (
        !env.WORKFLOW_RUNNER_SECRET ||
        request.headers.get('Authorization') !== `Bearer ${env.WORKFLOW_RUNNER_SECRET}`
      ) {
        return Response.json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        const result: Record<string, unknown> = { ok: true, ...(await drainAiQueues(env)) };
        if (url.searchParams.get('syncCompanies') === '1') {
          result.talentOsCompanySync = await syncTalentOsCompanies(env);
        }
        return Response.json(result);
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : 'Queue drain failed.',
          },
          { status: 502 }
        );
      }
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    if (event.cron === '0 3 * * *') {
      try {
        console.log('TalentOS company sync:', JSON.stringify(await syncTalentOsCompanies(env)));
      } catch (error) {
        console.error('Error syncing TalentOS companies:', error);
      }
    }

    if (event.cron === '0 * * * *') {
      const triggers = ['opportunity_stale', 'task_due_soon', 'outreach_stale'] as const;
      for (const trigger of triggers) {
        try {
          const res = await env.WORKFLOW_RUNNER_SERVICE.fetch(
            new Request(`https://workflow-runner.internal/evaluate/${trigger}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.WORKFLOW_RUNNER_SECRET}`,
              },
            })
          );
          if (!res.ok) {
            console.error(`Workflow evaluation failed for ${trigger}: ${res.status}`);
          } else {
            const body = await res.json();
            console.log(`Evaluated ${trigger}:`, JSON.stringify(body));
          }
        } catch (err) {
          console.error(`Error evaluating ${trigger}:`, err);
        }
      }
    }

    if (event.cron === '* * * * *') {
      try {
        console.log(
          'Company research queue:',
          JSON.stringify(await drainEndpoint(env, '/internal/company-research/drain?limit=1'))
        );
      } catch (error) {
        console.error('Error draining company research queue:', error);
      }
    }

    try {
      console.log('CRM AI queues:', JSON.stringify(await drainAiQueues(env)));
    } catch (error) {
      console.error('Error draining CRM AI queues:', error);
    }
  },
};
