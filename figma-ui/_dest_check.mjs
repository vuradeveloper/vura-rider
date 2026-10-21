import { readFileSync } from 'node:fs';
const KEY='AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const API='https://api.ridevura.com';
const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'specials39u7@gmail.com',password:'Makhavhu@77',returnSecureToken:true})});
const j = await su.json();
if(!j.idToken){console.log('sign-in failed:',j.error?.message);process.exit(1)}
const r = await fetch(API+'/api/drivers/destination',{headers:{Authorization:'Bearer '+j.idToken}});
console.log('GET /api/drivers/destination ->', r.status, JSON.stringify(await r.json()));