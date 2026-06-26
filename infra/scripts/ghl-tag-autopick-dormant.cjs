const Database=require('/home/clawdbot/clawdia/projects/vtorn/apps/web/node_modules/better-sqlite3'); const fs=require('fs');
(async()=>{
  const ROOT='/home/clawdbot/clawdia/projects/vtorn'; const TID='fifa-wc-2026';
  const DRY=process.env.DO_WRITE?false:true;
  const ev=(f,k)=>{const m=fs.readFileSync(f,'utf8').match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim().replace(/^["']|["']$/g,''):null;};
  const KEY=ev(ROOT+'/apps/auth-sms/.env','GHL_API_KEY'),LOC=ev(ROOT+'/apps/auth-sms/.env','GHL_LOCATION_ID');
  const BASE='https://services.leadconnectorhq.com'; const H={Authorization:`Bearer ${KEY}`,Version:'2021-07-28','Content-Type':'application/json'};
  const dts=p=>{const b=JSON.parse(p);const ts=new Set();for(const k of['matchPredictions','knockoutPredictions'])for(const m of Object.values(b[k]||{}))if(m.lockedAt)ts.add(m.lockedAt.slice(0,19));return ts.size;};
  const db=new Database(ROOT+'/apps/game/data/game.db',{readonly:true}); db.exec(`ATTACH '${ROOT}/apps/auth-sms/data/auth.db' AS a`);
  const rows=db.prepare(`SELECT b.payload_json, COALESCE(NULLIF(u.first_name,''),u.display_name) name, NULLIF(u.email,'') email, NULLIF(u.phone,'') phone, b.correct_picks cp
    FROM brackets b JOIN users gu ON gu.id=b.user_id AND gu.is_bot=0 JOIN a.user u ON u.id=b.user_id
    WHERE b.tournament_id=? AND (NULLIF(u.email,'') IS NOT NULL OR NULLIF(u.phone,'') IS NOT NULL)`).all(TID);
  db.close();
  const dormant=rows.filter(r=>dts(r.payload_json)<=2);
  console.log(`dormant (auto-pick & left, w/ contact): ${dormant.length} | mode=${DRY?'DRY':'LIVE'}`);
  let tagged=0;
  for(const r of dormant){
    const q=r.email||r.phone;
    if(DRY){ if(tagged<6) console.log(`  ${(r.name||'?').padEnd(14)} ${r.cp}/62 ${q}`); tagged++; continue; }
    try{
      const sr=await fetch(`${BASE}/contacts/?locationId=${LOC}&query=${encodeURIComponent(q)}`,{headers:H});
      const cs=(await sr.json().catch(()=>({}))).contacts||[];
      if(!cs.length){ console.log(`  ${r.name}: NOT FOUND`); continue; }
      const id=cs[0].id;
      const tr=await fetch(`${BASE}/contacts/${id}/tags`,{method:'POST',headers:H,body:JSON.stringify({tags:['autopick_dormant']})});
      if(tr.ok) tagged++; else console.log(`  ${r.name}: tag ${tr.status}`);
      await new Promise(f=>setTimeout(f,300));
    }catch(e){ console.log(`  ${r.name}: ERR ${e.message}`); }
  }
  if(!DRY) console.log(`tagged ${tagged}/${dormant.length} with autopick_dormant`);
})().catch(e=>{console.error(e.message);process.exit(1);});
