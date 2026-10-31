// Read an existing protected backup; restore only into a newly created local DB.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const container='supabase_db_stanzer-pr2-local-supabase-20261026';
const backup=process.env.BADGE_RELEASE_BACKUP || join(process.env.LOCALAPPDATA,'StanZer/protected-backups/release-20261029-052006');
const output=process.env.BADGE_RELEASE_REPORT || join(process.env.LOCALAPPDATA,'StanZer/ui-qa/badge-release-candidate');
mkdirSync(output,{recursive:true});
if(process.platform==='win32')execFileSync('icacls',[output,'/inheritance:r','/grant:r',process.env.USERDOMAIN+'\\'+process.env.USERNAME+':(OI)(CI)F'],{stdio:'pipe'});
const docker=(...args)=>execFileSync('docker',args,{stdio:'pipe',maxBuffer:32*1024*1024}).toString();
const target=JSON.parse(docker('inspect',container))[0];
assert.equal(target.State.Running,true);
for(const b of Object.values(target.NetworkSettings.Ports||{}).flat().filter(Boolean))assert.ok(['127.0.0.1','::1'].includes(b.HostIp),'Refuse exposed database');
const archive=join(backup,'stanzer-fresh.dump'),status=JSON.parse(readFileSync(join(backup,'backup-status.json'),'utf8').replace(/^\uFEFF/,''));
const hash=createHash('sha256').update(readFileSync(archive)).digest('hex');
assert.equal(hash.toLowerCase(),status.archiveSha256.toLowerCase(),'Backup checksum mismatch');
const database='stanz_badge_rc_'+randomUUID().replaceAll('-','').slice(0,12);
const archivePath='/tmp/'+database+'.dump';
docker('cp',archive,container+':'+archivePath);
const toc=docker('exec',container,'pg_restore','--list',archivePath);
assert.match(toc,/TABLE DATA public profiles/);assert.match(toc,/TABLE DATA public quiz_results/);
docker('exec',container,'createdb','-U','supabase_admin',database);
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:q,stdio:'pipe',maxBuffer:32*1024*1024}).toString().trim();
sql('create schema if not exists auth; create schema if not exists public; create schema if not exists arena_private; create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create publication supabase_realtime;');
try{
 const restoreList=join(output,'restored-application.list');
 writeFileSync(restoreList,toc.split('\n').filter(l=>!/^\d+;.* SCHEMA - (?:auth|public|arena_private) /.test(l)).join('\n'));
 docker('cp',restoreList,container+':/tmp/'+database+'-restore.list');
 docker('exec',container,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--no-owner','--no-privileges','--schema=auth','--schema=public','--schema=arena_private','--use-list=/tmp/'+database+'-restore.list',archivePath);
 // Restore application and auth object ACLs, never shared roles/managed Realtime internals.
 const acl=toc.split('\n').filter(l=>/^\d+;.* (?:ACL|DEFAULT ACL) (?:auth|public|arena_private) /.test(l)||/^\d+;.* ACL - SCHEMA (?:auth|public|arena_private) /.test(l)).join('\n');
 assert.ok(acl.length>0,'Expected application ACLs');
 const aclFile=join(output,'restored-application-acls.list');writeFileSync(aclFile,acl);
 docker('cp',aclFile,container+':/tmp/'+database+'-acl.list');
 docker('exec',container,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--no-owner','--use-list=/tmp/'+database+'-acl.list',archivePath);
 const protectedTables=JSON.parse(sql("select jsonb_agg(format('%I.%I',n.nspname,c.relname) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','arena_private') and c.relkind='r';"));
 const fingerprints=()=>JSON.parse(sql(`select coalesce(jsonb_object_agg(name,document),'{}') from (select t.name,(xpath('/table/row/f/text()',query_to_xml(format('select md5(coalesce(string_agg(row_to_json(r)::text, chr(10) order by row_to_json(r)::text),%L)) as f from %s r','',t.name),false,false,'')))[1]::text as document from (values ${protectedTables.map(t=>"('"+t+"')").join(',')})t(name))s;`));
 const before=fingerprints();
 assert.ok(Object.values(before).every(v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v)),'Missing row fingerprint');
 const apply=file=>{docker('cp',file,container+':/tmp/'+database+'-migration.sql');const out=docker('exec',container,'psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-f','/tmp/'+database+'-migration.sql');assert.match(out,/COMMIT/);return{file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),committed:true};};
 // This backup predates the last already-shipped lifecycle patch. Local baseline only.
 const baseline=process.env.BADGE_BASELINE_CURRENT === '1' ? { alreadyPresent: true, noHistoricalMigrationReapplied: true } : apply('supabase/20261031_arena_membership_and_match_lifecycle.sql');
 assert.deepEqual(fingerprints(),before,'Baseline patch changed historical rows');
 const migrations=['supabase/20261101_persistent_achievements.sql','supabase/20261102_daily_challenge_clock.sql'].map(apply);
 assert.deepEqual(fingerprints(),before,'Badge migrations changed historical rows');
 const firstAwards=sql("select coalesce(md5(string_agg(row_to_json(r)::text,chr(10) order by user_id,badge_id)),'empty') from public.player_achievements r;");
 migrations.forEach(m=>apply(m.file));
 assert.equal(sql("select coalesce(md5(string_agg(row_to_json(r)::text,chr(10) order by user_id,badge_id)),'empty') from public.player_achievements r;"),firstAwards,'Rerun changed award records');
 assert.deepEqual(fingerprints(),before);
 assert.equal(sql("select to_regclass('arena_private.verified_solo_runs') is null;"),'t','Experimental Solo schema leaked into release');
 const suites=['20261026_multiplayer_authority_permissions.sql','20261026_secure_arena_questions.sql','20261027_arena_active_disconnect_recovery.sql','20261029_arena_rpc_privileges.sql','20261031_arena_membership_and_match_lifecycle.sql','20261101_persistent_achievements.sql','20261102_daily_challenge_clock.sql'];
 for(const file of suites){docker('cp','supabase/tests/'+file,container+':/tmp/'+database+'-test.sql');docker('exec',container,'psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-f','/tmp/'+database+'-test.sql');}
 assert.deepEqual(fingerprints(),before,'Tests did not roll back');
 const result={database,backupSha256:hash,backupReadable:true,restored:true,baseline,migrations,rerunPreservedAwards:true,originalRowFingerprintsUnchanged:true,originalFingerprints:before,protectedTables:Object.keys(before),experimentalSoloAbsent:true,suitesPassed:suites};
 writeFileSync(join(output,'rehearsal-results.json'),JSON.stringify(result,null,2));
 writeFileSync(join(output,'restore-error.log'),'');
 console.log(JSON.stringify(result,null,2));
}catch(e){writeFileSync(join(output,'restore-error.log'),String(e.stderr||e.message));console.error('Local rehearsal stopped. See protected restore-error.log. Original backup and production untouched.');process.exitCode=1;}
