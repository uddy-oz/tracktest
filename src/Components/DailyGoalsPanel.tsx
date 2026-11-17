import { useEffect, useId, useState } from "react";
import { Check, Target, Trophy } from "lucide-react";
import { useUtcGoalDay } from "../hooks/useUtcGoalDay";
import { getDailyGoalPeriod, getDailyGoals, type DailyGoalResult } from "../lib/dailyGoals";
import { collectHistoryPages, historyCursorFilter } from "../lib/historyPagination";
import { supabase } from "../lib/supabaseClient";

type Props = {
  ownerId?: string;
  guest?: boolean;
  compact?: boolean;
  progressionRevision?: number;
};

export default function DailyGoalsPanel({ ownerId, guest, compact, progressionRevision = 0 }: Props) {
  const titleId = useId();
  const clock = useUtcGoalDay();
  const { start, end } = getDailyGoalPeriod(clock.now);
  const accountId = guest ? undefined : ownerId;
  const requestKey = accountId && clock.synced ? `${accountId}:${start}:${progressionRevision}` : "";
  const [snapshot, setSnapshot] = useState<{ key: string; rows: DailyGoalResult[] | null }>();

  useEffect(() => {
    const client = supabase;
    if (!requestKey || !accountId || !client) return;
    const controller = new AbortController();
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      const { data } = await collectHistoryPages<DailyGoalResult>((cursor, size) => {
        let query = client!.from("quiz_results")
          .select("id,played_at,game_mode,total_questions,correct_answers,result_status,arena_room_id,arena_round_number,competitive_progression_eligible")
          .eq("user_id", accountId)
          .gte("played_at", start).lt("played_at", end)
          .order("played_at", { ascending: false }).order("id", { ascending: false }).limit(size);
        if (cursor) query = query.or(historyCursorFilter(cursor));
        return query.abortSignal(controller.signal);
      });
      inFlight = false;
      if (!controller.signal.aborted) setSnapshot({ key: requestKey, rows: data });
    }
    void load();
    function refreshVisible() {
      if (document.visibilityState === "visible") void load();
    }
    const refresh = window.setInterval(refreshVisible, 60000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [accountId, requestKey, start, end]);

  const current = requestKey && snapshot?.key === requestKey ? snapshot : undefined;
  const goals = getDailyGoals(current?.rows || [], clock.now);
  const ready = Boolean(current?.rows);
  const completed = goals.filter((goal) => goal.complete).length;
  const swept = ready && completed === goals.length;
  const note = !accountId
    ? guest ? "Guest games do not count toward saved Daily Goals." : "Sign in to track Daily Goals across devices."
    : !clock.synced ? "Waiting for the server clock to confirm today's goals."
      : !current ? "Loading today's progress..."
        : !ready ? "Progress is unavailable. Check your connection and try again." : "";

  return (
    <section className={`daily-challenge-card${compact ? " daily-challenge-compact" : ""}${swept ? " daily-challenge-swept" : ""}`} aria-labelledby={titleId}>
      <header className="daily-challenge-heading">
        <div>
          <h2 id={titleId}><Target size={19} aria-hidden="true" /> Daily Goals</h2>
          <p>{clock.label}</p>
        </div>
        {ready && <strong>{completed}/{goals.length} complete</strong>}
      </header>
      <div role="status">
        {swept && (
          <div className="daily-challenge-sweep">
            <Trophy size={20} aria-hidden="true" />
            <strong>Daily Sweep</strong>
            {!compact && <span>All three goals complete.</span>}
          </div>
        )}
      </div>
      {note && <p className="daily-challenge-note" role="status">{note}</p>}
      <ul className="daily-challenge-list">
        {goals.map((goal) => (
          <li key={goal.id} className={goal.complete ? "complete" : undefined}>
            <div>
              <strong>{goal.title}</strong>
              {!compact && <small>{goal.description}</small>}
            </div>
            {ready && <span className="daily-challenge-count">
              {goal.complete ? <><Check size={16} aria-hidden="true" /> Complete</> : `${goal.progress}/${goal.target}`}
            </span>}
            {ready && !compact && <progress value={goal.progress} max={goal.target} aria-label={`${goal.title} progress`} />}
          </li>
        ))}
      </ul>
      {!compact && <p className="daily-challenge-note">
        Goal completion is recognition only; it does not award leaderboard points or permanent badges.
      </p>}
    </section>
  );
}
