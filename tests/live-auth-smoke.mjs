import assert from 'node:assert/strict';
const base = 'https://pdf.athat.app';
let lastError;
for (let attempt = 0; attempt < 30; attempt++) {
 try {
  const response = await fetch(base + '/api/auth/config', {cache:'no-store',signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  assert.equal((await response.json()).signupReady,true);
  const session = await fetch(base + '/api/auth/session',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  assert.equal(session.status,200);
  assert.equal((await session.json()).user,null);
  const html = await (await fetch(base + '/', {cache:'no-store',signal:AbortSignal.timeout(10000)})).text();
  assert.match(html,/id="authGate"/);
  assert.match(html,/<div id="app" hidden inert>/);
  const csrf = await fetch(base + '/api/auth/login', {
   method:'POST',headers:{'Content-Type':'application/json',Origin:'https://invalid.example'},
   body:'{}',signal:AbortSignal.timeout(10000)
  });
  assert.equal(csrf.status,403);
  console.log('PASS: production login gate, email configuration readiness, anonymous session and CSRF rejection. No email sent or account created.');
  process.exit(0);
 } catch(error) {lastError=error;console.log(`Waiting for production deployment (${attempt+1}/30).`);}
 await new Promise(resolve=>setTimeout(resolve,10000));
}
console.error('Production authentication smoke check failed:',lastError.message);
process.exit(1);
