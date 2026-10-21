const KEY='AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const API='https://api.ridevura.com';
const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'specials39u7@gmail.com',password:'Makhavhu@77',returnSecureToken:true})});
const j = await su.json(); const H={Authorization:'Bearer '+j.idToken};
for (const p of ['/api/admin/v2/me','/api/admin/v2/promos','/api/admin/v2/riders']) {
  const r = await fetch(API+p,{headers:H});
  console.log(p,'->',r.status, JSON.stringify(await r.json()).slice(0,260));
}