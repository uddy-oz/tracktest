import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { dailyResetLabel, parseChallengePeriod } from "../lib/challengeClock";

// Re-evaluate calendar-scoped UI at UTC midnight and when a sleeping tab returns.
export function useUtcGoalDay() {
  const [clock,setClock]=useState(()=>({now:new Date(),synced:false}));
  useEffect(() => {
    let live=true,request:AbortController|null=null;
    let anchor: { server:number; measured:number; end:number } | null=null;
    async function update() {
      if(request)return;
      if(anchor&&live)setClock({now:new Date(anchor.server+performance.now()-anchor.measured),synced:anchor.server+performance.now()-anchor.measured<anchor.end});
      if(!supabase)return;
      const controller=new AbortController();request=controller;
      const timer=window.setTimeout(()=>controller.abort(),5000);
      try {
        const {data,error}=await supabase.rpc("get_daily_challenge_period").abortSignal(controller.signal);
        const period=!error?parseChallengePeriod(data):null;
        if(period&&live){anchor={server:Date.parse(period.serverNow),measured:performance.now(),end:Date.parse(period.periodEnd)};setClock({now:new Date(anchor.server),synced:true});}
      }catch{if(live&&!anchor)setClock({now:new Date(),synced:false});}
      finally{window.clearTimeout(timer);request=null;}
    }
    void update();
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => { live=false;request?.abort();window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const end=new Date(Date.UTC(clock.now.getUTCFullYear(),clock.now.getUTCMonth(),clock.now.getUTCDate()+1)).toISOString();
  return {...clock,label:dailyResetLabel(end,clock.synced)};
}
