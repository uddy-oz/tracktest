import assert from "node:assert/strict";
import test from "node:test";
import { getArenaBadges } from "../src/lib/badges.ts";
import { createEmptyTrackTestStats } from "../src/lib/stats.ts";
import { badgeProgress, isBadgeUnavailable, readTrackedBadge, selectVaultBadges, writeTrackedBadge } from "../src/lib/badgeVault.ts";
import { sanitizeFeaturedBadgeIds } from "../src/lib/featuredBadgeSelection.ts";
const legacyIds = `first-track perfect-run flawless-album quick-hands speed-demon accuracy-specialist perfect-five album-scholar untouchable album-demon replay-king album-collector fifty-questions hundred-question-club five-hundred-questions one-thousand-questions artist-master discography-demon deep-discography five-artist-club ten-artist-club album-specialist three-day-listener seven-day-locked-in thirty-day-arena-regular fourteen-day-music-run hundred-day-legend first-blood rival contender arena-veteran arena-legend clean-sheet lockdown multiplayer-untouchable hot-hand on-fire-multiplayer unstoppable quick-draw lightning photo-finish comeback dominant back-to-back-champion three-peat arena-dynasty first-1v1-win close-call dominant-duel first-lobby-win lobby-sweeper party-starter room-controller private-challenger open-arena championship-winner clutch-player comeback-king`.split(" ");
test("all 58 legacy IDs and empty unlock state remain intact", () => {
  const b=getArenaBadges(createEmptyTrackTestStats());
  assert.deepEqual(b.map(x=>x.id),legacyIds); assert.equal(new Set(legacyIds).size,58);
  assert.ok(b.every(x=>!x.unlocked)); assert.equal(b.filter(isBadgeUnavailable).length,4);
  assert.equal(isBadgeUnavailable({...b.find(x=>x.id==='party-starter')!,unlocked:true}),false);
  assert.equal(badgeProgress(b.find(x=>x.id==='quick-hands')!),0);
});
test("every numeric threshold is exact, without altering inputs", () => {
  const map: Record<string,string[]>={ wins:['first-blood','rival','contender','arena-veteran','arena-legend'], bestWinStreak:['hot-hand','on-fire-multiplayer','unstoppable','back-to-back-champion','three-peat','arena-dynasty'], cleanSheets:['clean-sheet','lockdown','multiplayer-untouchable'], duelWins:['first-1v1-win'], closeCallWins:['close-call'], dominantDuelWins:['dominant-duel'], lobbyWins:['first-lobby-win'], fullLobbyWins:['lobby-sweeper'], partyRoomsHosted:['party-starter'],maxPartyPlayers:['room-controller'],privateGames:['private-challenger'],publicGames:['open-arena'],quickDraws:['quick-draw'],lightningWins:['lightning'],photoFinishWins:['photo-finish'],comebackWins:['comeback'],dominantWins:['dominant'] };
  for(const [field,ids]of Object.entries(map))for(const id of ids){const s=createEmptyTrackTestStats(); const threshold=getArenaBadges(s).find(x=>x.id===id)!.target!; Object.assign(s.arena,{[field]:threshold-1}); assert.equal(getArenaBadges(s).find(x=>x.id===id)!.unlocked,false,id); Object.assign(s.arena,{[field]:threshold}); const before=JSON.stringify(s); assert.equal(getArenaBadges(s).find(x=>x.id===id)!.unlocked,true,id); assert.equal(JSON.stringify(s),before);}
  for(const [field,ids]of Object.entries({totalQuestionsAnswered:['fifty-questions','hundred-question-club','five-hundred-questions','one-thousand-questions'],currentDailyStreak:['three-day-listener','seven-day-locked-in','fourteen-day-music-run','thirty-day-arena-regular','hundred-day-legend']}))for(const id of ids){const s=createEmptyTrackTestStats(),n=getArenaBadges(s).find(x=>x.id===id)!.target!;Object.assign(s.overall,{[field]:n-1});assert.equal(getArenaBadges(s).find(x=>x.id===id)!.unlocked,false);Object.assign(s.overall,{[field]:n});assert.equal(getArenaBadges(s).find(x=>x.id===id)!.unlocked,true);}
});
test("filters, tier sorting, honest date fallback and invalid progress", () => {
  const b=getArenaBadges(createEmptyTrackTestStats());const snapshot=JSON.stringify(b);
  assert.equal(selectVaultBadges(b,{category:'Championship',status:'unavailable'}).length,3);
  assert.ok(selectVaultBadges(b,{tier:'Gold',status:'locked'}).every(x=>x.tier==='Gold'&&!isBadgeUnavailable(x)));
  assert.equal(selectVaultBadges(b,{search:'no such achievement'}).length,0);
  assert.equal(selectVaultBadges(b,{sort:'tier'})[0].tier,'Legendary');
  assert.deepEqual(selectVaultBadges(b,{sort:'newest'}),selectVaultBadges(b,{sort:'alphabetical'}));
  for(const p of[NaN,Infinity,-1])assert.equal(badgeProgress({...b[0],progress:p}),0);
  assert.equal(badgeProgress({...b[0],progress:1000}),99);
  assert.equal(badgeProgress({...b[0],unlocked:true}),100);
  assert.equal(JSON.stringify(b),snapshot);
});
test("featured legacy IDs retain order, deduplicate and cap at six", () => {
  const ids=legacyIds.slice(0,8);assert.deepEqual(sanitizeFeaturedBadgeIds([ids[0],ids[0],'invalid',...ids.slice(1)],new Set(ids)),ids.slice(0,6));
});
test("Solo composites, perfect streaks, artist and album thresholds retain their exact rules", () => {
  const s=createEmptyTrackTestStats();
  const result={id:'fixture',albumName:'Album',artistName:'Artist',totalQuestions:10,correctAnswers:8,accuracyPercentage:80,finalPoints:1000,averageAnswerTime:3,datePlayed:'2026-10-29T12:00:00Z',gameMode:'single_player' as const};
  s.quizResults=[result];
  const unlocked=(id:string)=>getArenaBadges(s).find(b=>b.id===id)!.unlocked;
  assert.equal(unlocked('first-track'),true);assert.equal(unlocked('quick-hands'),true);
  result.averageAnswerTime=3.001;assert.equal(unlocked('quick-hands'),false);
  result.averageAnswerTime=2;result.accuracyPercentage=89;assert.equal(unlocked('speed-demon'),false);
  result.accuracyPercentage=90;assert.equal(unlocked('speed-demon'),true);assert.equal(unlocked('accuracy-specialist'),true);
  result.accuracyPercentage=100;assert.equal(unlocked('perfect-run'),true);
  s.quizResults=Array.from({length:5},(_,i)=>({...result,id:String(i)}));
  assert.equal(unlocked('perfect-five'),true);assert.equal(unlocked('untouchable'),true);
  s.quizResults.unshift({...result,accuracyPercentage:50});assert.equal(unlocked('untouchable'),false);
  for(let i=0;i<10;i++)s.albums[String(i)]={albumName:String(i),artistName:'Artist',timesPlayed:5,bestScore:1000,bestAccuracy:100,lastPlayedDate:'2026-10-29'};
  for(const id of ['flawless-album','album-scholar','album-demon','replay-king','album-collector','deep-discography','album-specialist'])assert.equal(unlocked(id),true,id);
  for(let i=0;i<10;i++)s.artists[String(i)]={artistName:String(i),quizzesPlayed:3,correctAnswers:85,totalQuestions:100,accuracy:85,totalPoints:1000,bestScore:1000};
  for(const id of ['artist-master','discography-demon','five-artist-club','ten-artist-club'])assert.equal(unlocked(id),true,id);
  for(const a of Object.values(s.artists))a.accuracy=84.99;assert.equal(unlocked('artist-master'),false);
});
test("tracking is isolated per identity, guests cannot persist, invalid and unavailable IDs ignored", () => {
  const data=new Map<string,string>(); Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>data.get(k),setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)}});
  const b=getArenaBadges(createEmptyTrackTestStats());assert.equal(writeTrackedBadge(undefined,'first-track'),false);
  writeTrackedBadge('one','first-track');assert.equal(readTrackedBadge('one',b),'first-track');assert.equal(readTrackedBadge('two',b),null);
  writeTrackedBadge('one','clutch-player');assert.equal(readTrackedBadge('one',b),null);
  writeTrackedBadge('one','invalid');assert.equal(readTrackedBadge('one',b),null);
  writeTrackedBadge('one',null);assert.equal(readTrackedBadge('one',b),null);
});
