const url = 'https://skarion-identity.skarion-talentos.workers.dev/auth/login';

async function main() {
  console.log(`Sending login request to ${url}...`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'tashfia@gmail.com',
      password: '67890'
    })
  });
  console.log(`Status: ${response.status}`);
  const data = await response.json();
  console.log('Response JSON keys:', Object.keys(data));
  console.log('Response JSON:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
