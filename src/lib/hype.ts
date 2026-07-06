export type HypeEvent =
  | "firstCorrect"
  | "correct"
  | "speed"
  | "comeback"
  | "streak"
  | "bigStreak"
  | "wrong"
  | "streakLost"
  | "timeout";

const hypeMessages: Record<HypeEvent, string[]> = {
  firstCorrect: ["First hit on the board.", "That is the opener."],
  correct: ["Locked in.", "Clean pick.", "You know this one."],
  speed: ["Fast trigger.", "No hesitation.", "That was instant."],
  comeback: ["Back in rhythm.", "Recovered fast.", "There is the bounce back."],
  streak: ["Streak building.", "Keep the run alive.", "You are heating up."],
  bigStreak: ["Arena mode.", "Certified run.", "That streak is serious."],
  wrong: ["Shake it off.", "Next clip is yours.", "Still in the match."],
  streakLost: ["Streak broken. Reset and climb.", "The run snapped. Go again."],
  timeout: ["Clock got you.", "Time ran out.", "Beat the timer next round."],
};

export function pickHype(event: HypeEvent, streak = 0) {
  if (event === "streak" && streak > 1) {
    return `${streak} in a row. ${pickFrom(hypeMessages.streak)}`;
  }

  if (event === "bigStreak" && streak > 1) {
    return `${streak} in a row. ${pickFrom(hypeMessages.bigStreak)}`;
  }

  return pickFrom(hypeMessages[event]);
}

export function pickGrade(accuracyPercentage: number) {
  if (accuracyPercentage === 100) {
    return "Flawless";
  }

  if (accuracyPercentage >= 85) {
    return "Certified";
  }

  if (accuracyPercentage >= 70) {
    return "Solid";
  }

  if (accuracyPercentage >= 50) {
    return "Warming up";
  }

  return "Run it back";
}

function pickFrom(messages: string[]) {
  return messages[Math.floor(Math.random() * messages.length)];
}
