// Live diagnosis: what are the phones reporting, and is the dispatch inspector deployed?
const API = 'https://api.ridevura.com';
const READ = '351d6e8d4be23114e219f579a19de045';

const r = await fetch(`${API}/api/dev/logs?key=${READ}&limit=40`);
const j = await r.json().catch(() => ({}));
console.log('dev-log rows:', j.logs?.length ?? 'ERR ' + r.status);
for (const l of (j.logs || []).slice(0, 40)) {
  const t = String(l.created_at || '').slice(11, 19);
  console.log(`  ${t} ${String(l.app).padEnd(7)} ${String(l.level).padEnd(5)} [${l.tag || '-'}] ${String(l.message || '').slice(0, 110)}`);
}

const d = await fetch(`${API}/api/dev/dispatch?key=${READ}&limit=6`);
const txt = await d.text();
console.log('\ndispatch inspector:', d.status, txt.slice(0, 600));
