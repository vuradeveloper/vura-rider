const KEY='AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const API='https://api.ridevura.com';
const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'specials39u7@gmail.com',password:'Makhavhu@77',returnSecureToken:true})});
const j = await su.json();
if(!j.idToken){console.log('sign-in failed:',j.error?.message);process.exit(1)}
const H={Authorization:'Bearer '+j.idToken};
const g = async (p) => { const r = await fetch(API+p,{headers:H}); return { s:r.status, j: await r.json().catch(()=>null) }; };
const feat = await g('/api/drivers/feature-status');
console.log('feature-status ->', feat.s, 'server_build:', feat.j?.server_build, '| flags:', JSON.stringify(feat.j?.flags ?? feat.j).slice(0,200));
const me = await g('/api/drivers/me');
console.log('drivers/me ->', me.s, JSON.stringify(me.j).slice(0,420));
const act = await g('/api/rides/me/active-state');
console.log('rides/me/active-state ->', act.s, JSON.stringify(act.j).slice(0,600));