const Database=require('/home/clawdbot/clawdia/projects/vtorn/apps/web/node_modules/better-sqlite3'); const fs=require('fs');
(async()=>{
  const ROOT='/home/clawdbot/clawdia/projects/vtorn'; const TID='fifa-wc-2026';
  const DRY=process.env.DO_WRITE?false:true;
  const ev=(f,k)=>{const m=fs.readFileSync(f,'utf8').match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim().replace(/^["']|["']$/g,''):null;};
  const KEY=ev(ROOT+'/apps/auth-sms/.env','GHL_API_KEY'),LOC=ev(ROOT+'/apps/auth-sms/.env','GHL_LOCATION_ID');
  const BASE='https://services.leadconnectorhq.com'; const H={Authorization:`Bearer ${KEY}`,Version:'2021-07-28','Content-Type':'application/json'};
  const db=new Database(ROOT+'/apps/game/data/game.db',{readonly:true}); db.exec(`ATTACH '${ROOT}/apps/auth-sms/data/auth.db' AS a`);
  const rows=db.prepare(`SELECT COALESCE(NULLIF(u.first_name,''),u.display_name) name, NULLIF(u.email,'') email, NULLIF(u.phone,'') phone,
      CASE WHEN EXISTS(SELECT 1 FROM syndicate_owners_membership som WHERE som.user_id=b.user_id) THEN 1 ELSE 0 END inpool
    FROM brackets b JOIN users gu ON gu.id=b.user_id AND gu.is_bot=0 JOIN a.user u ON u.id=b.user_id
    WHERE b.tournament_id=? AND (NULLIF(u.email,'') IS NOT NULL OR NULLIF(u.phone,'') IS NOT NULL)`).all(TID);
  db.close();
  console.log(`players to tag: ${rows.length} (solo: ${rows.filter(r=>!r.inpool).length}) | mode=${DRY?'DRY':'LIVE'}`);
  let tagged=0, notfound=[];
  for(const r of rows){
    if(DRY) { tagged++; continue; }
    const q=r.email||r.phone;
    try{
      const sr=await fetch(`${BASE}/contacts/?locationId=${LOC}&query=${encodeURIComponent(q)}`,{headers:H});
      const cs=(await sr.json().catch(()=>({}))).contacts||[];
      if(!cs.length){ notfound.push(`${r.name||'?'} (${q})`); continue; }
      const tr=await fetch(`${BASE}/contacts/${cs[0].id}/tags`,{method:'POST',headers:H,body:JSON.stringify({tags:['player']})});
      if(tr.ok) tagged++; else console.log(`  ${r.name}: ${tr.status}`);
      await new Promise(f=>setTimeout(f,280));
    }catch(e){ console.log(`  ${r.name}: ERR ${e.message}`); }
  }
  if(!DRY){ console.log(`tagged ${tagged}/${rows.length} with player`); if(notfound.length) console.log(`NOT in HL (${notfound.length}): ${notfound.join(' | ')}`); }
})().catch(e=>{console.error(e.message);process.exit(1);});
