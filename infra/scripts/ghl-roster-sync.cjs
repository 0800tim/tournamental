const Database = require('/home/clawdbot/clawdia/projects/vtorn/apps/web/node_modules/better-sqlite3');
const fs = require('fs');
(async () => {
  const ROOT = '/home/clawdbot/clawdia/projects/vtorn';
  const TID = 'fifa-wc-2026';
  const DRY = process.env.DO_WRITE ? false : true;
  const envval=(file,key)=>{ try{const m=fs.readFileSync(file,'utf8').match(new RegExp('^'+key+'=(.*)$','m'));return m?m[1].trim().replace(/^["']|["']$/g,''):null;}catch{return null;} };
  const KEY=envval(ROOT+'/apps/auth-sms/.env','GHL_API_KEY'), LOC=envval(ROOT+'/apps/auth-sms/.env','GHL_LOCATION_ID');
  const BASE=(envval(ROOT+'/apps/auth-sms/.env','GHL_API_BASE_URL')||'https://services.leadconnectorhq.com').replace(/\/$/,'');
  const db=new Database(ROOT+'/apps/game/data/game.db',{readonly:true});
  db.exec(`ATTACH '${ROOT}/apps/auth-sms/data/auth.db' AS a`);
  const matchesPlayed=db.prepare("SELECT COUNT(*) c FROM match_results WHERE tournament_id=?").get(TID).c;
  const rows=db.prepare(`
    SELECT u.id uid, COALESCE(NULLIF(u.first_name,''),u.display_name,'there') name,
           NULLIF(u.email,'') email, NULLIF(u.phone,'') phone,
           GROUP_CONCAT(DISTINCT s.slug) slugs, GROUP_CONCAT(DISTINCT s.name) names,
           COUNT(DISTINCT som.syndicate_id) np, COALESCE(MAX(b.correct_picks),0) correct
    FROM syndicate_owners_membership som JOIN syndicates s ON s.id=som.syndicate_id
    JOIN a.user u ON u.id=som.user_id
    LEFT JOIN brackets b ON b.user_id=som.user_id AND b.tournament_id=s.tournament_id
    WHERE u.is_bot=0 AND (NULLIF(u.email,'') IS NOT NULL OR NULLIF(u.phone,'') IS NOT NULL)
    GROUP BY u.id ORDER BY np DESC, correct DESC`).all();
  console.log(`matches_played=${matchesPlayed} | players=${rows.length} | mode=${DRY?'DRY-RUN':'LIVE'} | creds=${KEY&&LOC?'present':'MISSING'}`);
  let posted=0;
  for (const r of rows) {
    const slugs=(r.slugs||'').split(',').filter(Boolean), names=(r.names||'').split(',').filter(Boolean);
    const tags=['tournament:wc2026',...slugs.map(s=>`pool:${s}`)];
    const cf=[{key:'vtourn_user_id',field_value:r.uid},{key:'number_of_pools',field_value:r.np},{key:'pools',field_value:names.join(', ')},{key:'primary_pool',field_value:names[0]||''},{key:'correct_picks',field_value:r.correct},{key:'matches_played',field_value:matchesPlayed},{key:'score_summary',field_value:`${r.correct} of ${matchesPlayed}`}];
    const ch=r.phone&&r.email?'sms+email':r.phone?'sms':'email';
    if (DRY){ console.log(`  ${r.name.padEnd(16)} ${ch.padEnd(9)} pools=${r.np} (${names.slice(0,2).join(', ')}${names.length>2?'…':''})  ${r.correct}/${matchesPlayed}  pool-tags=[${slugs.map(s=>'pool:'+s).join(', ')}]`); continue; }
    const body={locationId:LOC,firstName:r.name,...(r.email?{email:r.email}:{}),...(r.phone?{phone:r.phone}:{}),source:'tournamental-roster-sync',customFields:cf,tags};
    try{ const resp=await fetch(`${BASE}/contacts/upsert`,{method:'POST',headers:{Authorization:`Bearer ${KEY}`,Version:'2021-07-28',LocationId:LOC,'Content-Type':'application/json'},body:JSON.stringify(body)}); const j=await resp.json().catch(()=>({})); console.log(`  ${r.name}: ${resp.status} ${j.contact?.id||JSON.stringify(j).slice(0,90)}`); if(resp.ok)posted++; await new Promise(f=>setTimeout(f,400)); }catch(e){ console.log(`  ${r.name}: ERR ${e.message}`); }
  }
  if(!DRY) console.log(`synced ${posted}/${rows.length}`);
  db.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
