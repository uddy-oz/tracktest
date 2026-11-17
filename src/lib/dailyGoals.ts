export type DailyGoalResult = {
  id: string;
  played_at: string;
  game_mode: string | null;
  total_questions: number;
  correct_answers: number;
  result_status: string | null;
  arena_room_id: string | null;
  arena_round_number: number | null;
  competitive_progression_eligible: boolean | null;
};

export function getDailyGoalPeriod(now: Date) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 86400000).toISOString(),
  };
}

export function getDailyGoals(rows: readonly DailyGoalResult[], now: Date) {
  const period = getDailyGoalPeriod(now);
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const ids = new Set<string>();
  const matches = new Set<string>();
  let soloQuizzes = 0;
  let correctAnswers = 0;

  for (const row of rows) {
    const playedAt = Date.parse(row.played_at);
    if (!row.id || ids.has(row.id) || !Number.isFinite(playedAt) ||
        playedAt < start || playedAt >= end || playedAt > now.getTime() ||
        (row.result_status !== null && row.result_status !== "completed") ||
        !Number.isInteger(row.total_questions) || row.total_questions <= 0 ||
        !Number.isInteger(row.correct_answers) || row.correct_answers < 0 ||
        row.correct_answers > row.total_questions) continue;

    const isSolo = (row.game_mode === null || row.game_mode === "single_player") && !row.arena_room_id;
    if (isSolo) {
      soloQuizzes++;
    } else {
      if (!["duel", "group_lobby", "party_mode"].includes(row.game_mode || "") ||
          row.result_status !== "completed" || row.competitive_progression_eligible !== true ||
          !row.arena_room_id || !row.arena_round_number ||
          !Number.isInteger(row.arena_round_number) || row.arena_round_number < 1) continue;
      const matchKey = `${row.arena_room_id}:${row.arena_round_number}`;
      if (matches.has(matchKey)) continue;
      matches.add(matchKey);
    }
    ids.add(row.id);
    correctAnswers += row.correct_answers;
  }

  return [
    { id: "warm-up", title: "Warm Up", description: "Complete one Solo quiz.", count: soloQuizzes, target: 1 },
    { id: "sharp-ears", title: "Sharp Ears", description: "Answer ten questions correctly across completed games.", count: correctAnswers, target: 10 },
    { id: "bring-the-competition", title: "Bring the Competition", description: "Complete one Duel, Group Lobby, or Party match as a player.", count: matches.size, target: 1 },
  ].map(({ count, ...goal }) => ({
    ...goal, progress: Math.min(count, goal.target), complete: count >= goal.target,
  }));
}
