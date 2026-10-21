import fs from 'fs';
const API='https://api.ridevura.com';
const KEY='AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const EMAIL=process.argv[2], PASS=process.argv[3];
const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASS,returnSecureToken:true})});
const j=await r.json();
if(!j.idToken){console.log('signin FAILED',JSON.stringify(j).slice(0,200));process.exit(1)}
const w=await fetch(API+'/api/payments/driver/wallet',{headers:{Authorization:`Bearer ${j.idToken}`}});
const txt=await w.text();
console.log('GET /driver/wallet -> HTTP',w.status);
let d; try{d=JSON.parse(txt)}catch{console.log(txt.slice(0,300));process.exit(0)}
console.log('keys:',Object.keys(d).join(','));
const e=(d.entries||d.ledger||[])[0];
console.log('entries:',(d.entries||d.ledger||[]).length);
if(e){console.log('entry0 keys:',Object.keys(e).join(','));
console.log('split fields present:', ['paystack_fee_rand','vat_rand','margin_rand','commission_rand','fare_rand'].map(k=>k+'='+(e[k]??'MISSING')).join(' '));}
else console.log('raw:',JSON.stringify(d).slice(0,400));
