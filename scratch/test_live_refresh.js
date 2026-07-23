const loginUrl = 'https://skarion-identity.skarion-talentos.workers.dev/auth/login';
const refreshUrl = 'https://skarion-identity.skarion-talentos.workers.dev/auth/refresh';

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
  const refreshToken = data.refresh_token;
  console.log(`Got refresh token: ${refreshToken}`);

  console.log(`Sending refresh request to ${refreshUrl} with body...`);
  const refreshResponse = await fetch(refreshUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refresh_token: refreshToken
    })
  });
  console.log(`Status: ${refreshResponse.status}`);
  const refreshData = await refreshResponse.json();
  console.log('Refresh response:', JSON.stringify(refreshData, null, 2));
}

main().catch(console.error);
