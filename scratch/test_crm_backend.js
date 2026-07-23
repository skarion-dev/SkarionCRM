const loginUrl = 'https://skarion-identity.skarion-talentos.workers.dev/auth/login';
const crmApiUrl = 'https://skarion-crm-platform.skarion-talentos.workers.dev/api/notifications';

async function main() {
  console.log(`Sending login request to ${loginUrl}...`);
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'tashfia@gmail.com',
      password: '67890'
    })
  });
  const data = await response.json();
  const accessToken = data.access_token;
  console.log(`Got access token: ${accessToken}`);

  const endpoints = [
    '/api/notifications',
    '/api/notifications/count',
    '/api/leads',
    '/api/companies',
    '/api/contacts',
    '/api/opportunities',
    '/api/tasks',
    '/api/activities'
  ];

  for (const path of endpoints) {
    const url = `https://skarion-crm-platform.skarion-talentos.workers.dev${path}`;
    console.log(`Sending GET request to CRM API ${url} with Bearer token...`);
    const crmResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log(`  Status for ${path}: ${crmResponse.status}`);
    const text = await crmResponse.text();
    console.log(`  Response snippet: ${text.substring(0, 100)}`);
  }
}

main().catch(console.error);
