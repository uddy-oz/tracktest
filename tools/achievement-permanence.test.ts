import assert from "node:assert/strict";
import test from "node:test";
import { getArenaBadges } from "../src/lib/badges.ts";
import { createEmptyTrackTestStats } from "../src/lib/stats.ts";
import { mergeAchievementRecords, parseAchievementRecords, parseAchievementState, preserveObservedAchievements, readPreservedAchievements } from "../src/lib/achievementRecords.ts";
import { achievableCollection, badgeStateLabel, selectVaultBadges } from "../src/lib/badgeVault.ts";
import { sanitizeFeaturedBadgeIds } from "../src/lib/featuredBadgeSelection.ts";
test('late reconciliation responses from a switched account cannot enter the previous identity cache',()=>{
 const response={schemaVersion:1,userId:'second',records:[{badgeId:'arena-legend',awardedAt:'2026-10-29T12:00:00Z',provenance:'server_verified'}]};
 assert.deepEqual(parseAchievementState(response,'first'),{records:[],available:false});
 assert.equal(parseAchievementState(response,'second').records.length,1);
});
test('permanent records survive streak reset, reconnect and duplicate delivery; legacy IDs keep featured order',()=>{
 const s=createEmptyTrackTestStats();s.overall.currentDailyStreak=3;
 const before=getArenaBadges(s);s.overall.currentDailyStreak=0;
 const award={badgeId:'three-day-listener',awardedAt:'2026-10-29T12:00:00Z',provenance:'server_verified' as const};
 s.achievementRecords=[award,award];const after=getArenaBadges(s);assert.equal(after.find(b=>b.id===award.badgeId)!.unlocked,true);
 assert.equal(after.length,before.length);assert.equal(after.find(b=>b.id===award.badgeId)!.unlockedAt,award.awardedAt);
 const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(getArenaBadges(restored),after);
 assert.deepEqual(sanitizeFeaturedBadgeIds([award.badgeId],new Set(after.filter(b=>b.unlocked).map(b=>b.id))),[award.badgeId]);
 assert.equal(mergeAchievementRecords(after,[{...award,badgeId:'not-in-catalog'}]).length,58);
});
test('unknown legacy dates never become verified; newest uses only server awards',()=>{
 const b=getArenaBadges(createEmptyTrackTestStats());
 const merged=mergeAchievementRecords(b,[{badgeId:'first-track',awardedAt:'2000-01-01',provenance:'legacy_preserved'},{badgeId:'perfect-run',awardedAt:'2026-10-29',provenance:'server_verified'}]);
 assert.equal(merged.find(x=>x.id==='first-track')!.unlockedAt,undefined);
 assert.equal(selectVaultBadges(merged,{sort:'newest'})[0].id,'perfect-run');
 assert.deepEqual(parseAchievementRecords([{badgeId:'a',awardedAt:'bad',provenance:'bad'}]),[]);
});
test('achievement observations persist across device-local reloads but never mint verified provenance',()=>{
 const m=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>m.get(k),setItem:(k:string,v:string)=>m.set(k,v)}});
 const s=createEmptyTrackTestStats();s.overall.currentDailyStreak=7;preserveObservedAchievements('registered-one',getArenaBadges(s));
 s.overall.currentDailyStreak=0;preserveObservedAchievements('registered-one',getArenaBadges(s));
 assert.ok(readPreservedAchievements('registered-one').some(x=>x.badgeId==='seven-day-locked-in'));
 assert.deepEqual(readPreservedAchievements('registered-two'),[]);
 assert.ok(readPreservedAchievements('registered-one').every(x=>x.awardedAt===null&&x.provenance==='legacy_preserved'));
});
test('Coming Soon achievements do not count against achievable completion; legacy Championship remains owned',()=>{
 const b=getArenaBadges(createEmptyTrackTestStats());assert.equal(badgeStateLabel(b.find(x=>x.id==='clutch-player')!),'Coming Soon');
 const before=achievableCollection(b);assert.equal(before.total,54);
 const legacy=mergeAchievementRecords(b,[{badgeId:'clutch-player',awardedAt:null,provenance:'legacy_preserved'}]);assert.equal(legacy.find(b=>b.id==='clutch-player')!.unlocked,true);assert.equal(achievableCollection(legacy).total,54);
 const s=createEmptyTrackTestStats();s.achievementLedgerAvailable=true;assert.equal(achievableCollection(getArenaBadges(s)).total,55);
});
