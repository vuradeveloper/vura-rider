const KEY='AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'vurainvitertest.inviter@gmail.com',password:'VuraInvite2026!',returnSecureToken:true})});
const j=await r.json();
if(!j.idToken){console.log('signin failed');process.exit(1)}
const p=await fetch('https://api.ridevura.com/api/promos/active?side=rider',{headers:{Authorization:`Bearer ${j.idToken}`}});
console.log('GET /api/promos/active?side=rider ->',p.status);
console.log(JSON.stringify(await p.json(),null,1));
