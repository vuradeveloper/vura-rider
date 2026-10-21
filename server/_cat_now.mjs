const r = await fetch('https://api.ridevura.com/api/drivers/vehicle-catalogue');
const j = await r.json();
const makes = j.makes || [];
console.log('makes:', makes.length, 'models:', makes.reduce((n,m)=>n+(m.models||[]).length,0));
const kia = makes.find(m => /kia/i.test(m.make));
console.log('kia models:', (kia?.models||[]).map(x=>x.model).join(', '));
console.log('picanto present:', !!kia?.models?.find(x=>/picanto/i.test(x.model)));
const d = await (await fetch('https://api.ridevura.com/api/dev/diag')).json().catch(e=>({err:String(e)}));
console.log('diag builtAt:', d.builtAt, 'version:', d.version);
