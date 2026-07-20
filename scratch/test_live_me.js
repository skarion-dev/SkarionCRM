const meUrl = 'https://skarion-identity.skarion-talentos.workers.dev/me';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjMGVkNTg0YS1mZGJlLTRiNzYtOWU1Mi0xMDRiODM2YzA2MDciLCJlbWFpbCI6InRhc2hmaWFAZ21haWwuY29tIiwiYXBwcyI6eyJjcm0iOiJtZW1iZXIiLCJib29rcyI6Im1lbWJlciIsImhyIjoibWVtYmVyIn0sImlzU3VwZXJhZG1pbiI6ZmFsc2UsInZlciI6MywiaWF0IjoxNzg0NTQyMjU2LCJleHAiOjE3ODQ1NDMxNTZ9.UHLKR4fQwvrDQoRTCKEb_knTzLVR95w3Qc6yqHb5m4A';

async function main() {
  console.log(`Sending GET request to ${meUrl}...`);
  const response = await fetch(meUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  console.log(`Status: ${response.status}`);
  const data = await response.json();
  console.log('Response JSON:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
