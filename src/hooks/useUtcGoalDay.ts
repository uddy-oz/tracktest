import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { dailyResetLabel, parseChallengePeriod } from "../lib/challengeClock";

// Re-evaluate calendar-scoped UI at UTC midnight and when a sleeping tab returns.
export function useUtcGoalDay(enabled = true) {
  const [clock, setClock] = useState(() => ({ now: new Date(), synced: false }));
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let request: AbortController | null = null;
    let rollover: number | undefined;
    let anchor: { server:number; measured:number; end:number } | null=null;
    async function update() {
      if (request || !live) return;
      if (anchor) {
        const now = anchor.server + performance.now() - anchor.measured;
        setClock({ now: new Date(now), synced: now < anchor.end });
      } else {
        setClock({ now: new Date(), synced: false });
      }
      if (!anchor || Date.parse(getPeriodEnd(anchor.server)) <= anchor.server + performance.now() - anchor.measured) {
        const current = anchor ? anchor.server + performance.now() - anchor.measured : Date.now();
        window.clearTimeout(rollover);
        rollover = window.setTimeout(update, Date.parse(getPeriodEnd(current)) - current + 50);
      }
      if (!supabase) return;
      const controller = new AbortController();
      request = controller;
      const timer = window.setTimeout(() => controller.abort(), 5000);
      try {
        const { data, error } = await supabase.rpc("get_daily_challenge_period").abortSignal(controller.signal);
        const period = !error ? parseChallengePeriod(data) : null;
        if (period && live) {
          anchor = { server: Date.parse(period.serverNow), measured: performance.now(), end: Date.parse(period.periodEnd) };
          setClock({ now: new Date(anchor.server), synced: true });
          window.clearTimeout(rollover);
          rollover = window.setTimeout(update, anchor.end - anchor.server + 50);
        }
      } catch {
        // Keep the last server anchor until the confirmed period expires.
      } finally {
        window.clearTimeout(timer);
        request = null;
      }
    }
    void update();
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => {
      live = false;
      request?.abort();
      window.clearTimeout(rollover);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled]);
  const end = getPeriodEnd(clock.now.getTime());
  return { ...clock, label: dailyResetLabel(end, clock.synced) };
}

function getPeriodEnd(time: number) {
  const day = new Date(time);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1)).toISOString();
}
