export type ChallengePeriod = { version: 1; serverNow: string; periodStart: string; periodEnd: string };
export function parseChallengePeriod(value: unknown): ChallengePeriod | null {
  if(!value||typeof value!=="object")return null;
  const p=value as ChallengePeriod;
  if(p.version!==1||![p.serverNow,p.periodStart,p.periodEnd].every(x=>typeof x==="string"&&Number.isFinite(Date.parse(x))))return null;
  const start=Date.parse(p.periodStart),end=Date.parse(p.periodEnd),now=Date.parse(p.serverNow);
  if(start%86400000!==0||end-start!==86400000||now<start||now>=end)return null;
  return p;
}
export function dailyResetLabel(end: string, synced: boolean, timeZone?: string) {
  const local=new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short",...(timeZone?{timeZone}:{})}).format(new Date(end));
  return `${synced?"Server daily period":"Offline estimate"} · resets ${local} (00:00 UTC)`;
}
