// Offline compatibility comparison. Reads only the isolated restored backup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { getArenaBadges } from '../src/lib/badges.ts';
import { buildArenaProgress } from '../src/lib/stats.ts';
const output=process.env.BADGE_RELEASE_REPORT || process.env.LOCALAPPDATA+'/StanZer/ui-qa/badge-release-candidate';
const database=JSON.parse(readFileSync(output+'/rehearsal-results.json','utf8')).database;
assert.match(database,/^stanz_badge_rc_[a-f0-9]{12}$/);
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_stanzer-pr2-local-supabase-20261026','psql','-U','supabase_admin','-d',database,'-At','-v','ON_ERROR_STOP=1'],{input:q,stdio:'pipe',maxBuffer:16*1024*1024}).toString().trim();
const load=async(source)=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const old=await load(execFileSync('git',['show','HEAD:src/lib/badges.ts']).toString());
const ast=ts.createSourceFile('cloudBadgeStats.ts',readFileSync('src/lib/cloudBadgeStats.ts','utf8'),ts.ScriptTarget.Latest,true);
const helpers=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name.text!=='attachAchievements'&&n.name.text!=='fetchCloudBadgeStats').map(n=>n.getFullText(ast)).join('\n');
const statsModule=await load(`import {buildArenaProgress} from '${pathToFileURL(process.cwd()+'/src/lib/stats.ts').href}';\n${helpers}\nexport {buildTrackTestStats};`);
assert.equal(typeof buildArenaProgress,'function');
const users=JSON.parse(sql("select coalesce(jsonb_agg(id),'[]') from auth.users where not coalesce(is_anonymous,false);"));
const results=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(q) order by played_at desc,id desc),'[]') from public.quiz_results q;"));
const records=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.player_achievements a;"));
let oldUnlocked=0,preservedFeatured=0;const checkpoint=[];
for(const id of users){
 const stats=statsModule.buildTrackTestStats(results.filter(r=>r.user_id===id));
 const before=old.getArenaBadges(stats).filter(b=>b.unlocked).map(b=>b.id);
 for(const badgeId of before){assert.match(id,/^[a-f0-9-]{36}$/);assert.match(badgeId,/^[a-z0-9-]+$/);checkpoint.push([id,badgeId]);}
 const ledger=records.filter(r=>r.user_id===id).map(r=>({badgeId:r.badge_id,provenance:r.provenance,awardedAt:r.awarded_at}));
 const after=new Set(getArenaBadges({...stats,achievementLedgerAvailable:true,achievementRecords:ledger}).filter(b=>b.unlocked).map(b=>b.id));
 assert.ok(before.every(b=>after.has(b)),'Existing visible badge relocked');oldUnlocked+=before.length;
 const empty={...stats,overall:{...stats.overall,currentDailyStreak:0},arena:{...stats.arena,bestWinStreak:0},achievementRecords:ledger};
 const reset=new Set(getArenaBadges(empty).filter(b=>b.unlocked).map(b=>b.id));
 assert.ok(ledger.every(r=>reset.has(r.badgeId)),'Preserved award relocked after streak reset');preservedFeatured+=ledger.length;
}
// Private release artifact, never source control. Preserve pre-release entitlement,
// not verified history; no fabricated unlock dates and no client import endpoint.
const checkpointSql=`begin;\ninsert into public.player_achievements(user_id,badge_id,provenance,awarded_at)\nselect v.user_id::uuid,v.badge_id,'legacy_preserved',null from (values\n${checkpoint.map(([u,b])=>`('${u}','${b}')`).join(',\n')}\n) v(user_id,badge_id) join auth.users u on u.id=v.user_id::uuid and not coalesce(u.is_anonymous,false) join arena_private.achievement_catalog c on c.badge_id=v.badge_id\non conflict(user_id,badge_id) do nothing;\ncommit;\n`;
assert.ok(checkpoint.length>0,'No checkpoint rows; do not emit an empty VALUES statement');
writeFileSync(output+'/legacy-unlock-checkpoint.sql',checkpointSql);
sql(checkpointSql);
const once=sql("select md5(string_agg(row_to_json(r)::text,chr(10) order by user_id,badge_id)) from public.player_achievements r;");sql(checkpointSql);
assert.equal(sql("select md5(string_agg(row_to_json(r)::text,chr(10) order by user_id,badge_id)) from public.player_achievements r;"),once);
const stored=JSON.parse(sql("select jsonb_agg(to_jsonb(a)) from public.player_achievements a;"));
const rehearsal=JSON.parse(readFileSync(output+'/rehearsal-results.json','utf8'));
for(const [table,fingerprint]of Object.entries(rehearsal.originalFingerprints||{})){
 assert.match(table,/^[a-z_]+\.[a-z_]+$/);
 assert.equal(sql(`select md5(coalesce(string_agg(row_to_json(r)::text,chr(10) order by row_to_json(r)::text),'')) from ${table} r;`),fingerprint,'Legacy checkpoint changed original data');
}
for(const [id,badgeId]of checkpoint){const row=stored.find(r=>r.user_id===id&&r.badge_id===badgeId);assert.ok(row);assert.equal(row.provenance,'legacy_preserved');assert.equal(row.awarded_at,null);}
const resetStats=statsModule.buildTrackTestStats([]);
for(const id of users){const ledger=stored.filter(r=>r.user_id===id).map(r=>({badgeId:r.badge_id,provenance:r.provenance,awardedAt:r.awarded_at}));const owned=new Set(getArenaBadges({...resetStats,achievementRecords:ledger}).filter(b=>b.unlocked).map(b=>b.id));assert.ok(ledger.every(r=>owned.has(r.badgeId)));}
const result={usersCompared:users.length,existingVisibleBadgesCompared:oldUnlocked,previousFeaturedSeedCount:preservedFeatured,legacyCheckpointRecords:checkpoint.length,checkpointSha256:createHash('sha256').update(checkpointSql).digest('hex'),checkpointIdempotent:true,preservedWithoutHistoryOrStreak:true,datesRemainUnknown:true,noRelockedVisibleBadges:true,oldRawResultsUnmodified:true,privateCheckpointOutsideGit:true};writeFileSync(output+'/legacy-compatibility.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
