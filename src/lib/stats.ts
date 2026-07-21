export type GameMode =
  | "single_player"
  | "duel"
  | "group_lobby"
  | "party_mode"
  | "championship";

export type QuizResult = {
  id: string;
  albumName: string;
  artistName: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracyPercentage: number;
  finalPoints: number;
  averageAnswerTime: number;
  datePlayed: string;
  gameMode?: GameMode;
  isPrivate?: boolean;
  isWinner?: boolean;
  wasHost?: boolean;
  playerCount?: number;
  placement?: number | null;
  scoreMargin?: number;
  resultStatus?: string;
};

export type ArenaProgressStats = {
  gamesPlayed: number;
  wins: number;
  duelWins: number;
  lobbyWins: number;
  partyWins: number;
  championshipWins: number;
  partyGames: number;
  partyRoomsHosted: number;
  privateGames: number;
  publicGames: number;
  closeCallWins: number;
  dominantDuelWins: number;
  fullLobbyWins: number;
  maxPartyPlayers: number;
  currentWinStreak: number;
  bestWinStreak: number;
};

export type OverallStats = {
  totalQuizzesPlayed: number;
  totalCorrectAnswers: number;
  totalQuestionsAnswered: number;
  overallAccuracy: number;
  totalPoints: number;
  bestScore: number;
  averageAnswerTime: number;
  currentDailyStreak: number;
  lastPlayedDate: string;
};

export type ArtistStats = {
  artistName: string;
  quizzesPlayed: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracy: number;
  totalPoints: number;
  bestScore: number;
};

export type AlbumStats = {
  albumName: string;
  artistName: string;
  timesPlayed: number;
  bestScore: number;
  bestAccuracy: number;
  lastPlayedDate: string;
};

export type TrackTestStats = {
  version: 1;
  quizResults: QuizResult[];
  overall: OverallStats;
  artists: Record<string, ArtistStats>;
  albums: Record<string, AlbumStats>;
  arena: ArenaProgressStats;
};

const STATS_STORAGE_KEY = "tracktest_arena_stats_v1";

export function createEmptyArenaProgress(): ArenaProgressStats {
  return {
    gamesPlayed: 0,
    wins: 0,
    duelWins: 0,
    lobbyWins: 0,
    partyWins: 0,
    championshipWins: 0,
    partyGames: 0,
    partyRoomsHosted: 0,
    privateGames: 0,
    publicGames: 0,
    closeCallWins: 0,
    dominantDuelWins: 0,
    fullLobbyWins: 0,
    maxPartyPlayers: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
  };
}

function createEmptyStats(): TrackTestStats {
  return {
    version: 1,
    quizResults: [],
    overall: {
      totalQuizzesPlayed: 0,
      totalCorrectAnswers: 0,
      totalQuestionsAnswered: 0,
      overallAccuracy: 0,
      totalPoints: 0,
      bestScore: 0,
      averageAnswerTime: 0,
      currentDailyStreak: 0,
      lastPlayedDate: "",
    },
    artists: {},
    albums: {},
    arena: createEmptyArenaProgress(),
  };
}

export function buildArenaProgress(results: QuizResult[]): ArenaProgressStats {
  const arenaResults = results
    .filter((result) => result.gameMode && result.gameMode !== "single_player")
    .sort(
      (a, b) =>
        new Date(b.datePlayed).getTime() - new Date(a.datePlayed).getTime()
    );
  let currentWinStreak = 0;
  let runningWinStreak = 0;
  let bestWinStreak = 0;

  for (const result of arenaResults) {
    if (result.isWinner) {
      runningWinStreak += 1;
      bestWinStreak = Math.max(bestWinStreak, runningWinStreak);
    } else {
      runningWinStreak = 0;
    }
  }

  for (const result of arenaResults) {
    if (!result.isWinner) {
      break;
    }

    currentWinStreak += 1;
  }

  const wins = arenaResults.filter((result) => result.isWinner);
  const duelWins = wins.filter((result) => result.gameMode === "duel");
  const partyResults = arenaResults.filter(
    (result) => result.gameMode === "party_mode"
  );

  return {
    gamesPlayed: arenaResults.length,
    wins: wins.length,
    duelWins: duelWins.length,
    lobbyWins: wins.filter((result) => result.gameMode === "group_lobby").length,
    partyWins: wins.filter((result) => result.gameMode === "party_mode").length,
    championshipWins: wins.filter(
      (result) => result.gameMode === "championship"
    ).length,
    partyGames: partyResults.length,
    partyRoomsHosted: partyResults.filter((result) => result.wasHost).length,
    privateGames: arenaResults.filter((result) => result.isPrivate).length,
    publicGames: arenaResults.filter((result) => !result.isPrivate).length,
    closeCallWins: duelWins.filter(
      (result) => (result.scoreMargin || 0) > 0 && (result.scoreMargin || 0) <= 500
    ).length,
    dominantDuelWins: duelWins.filter(
      (result) => (result.scoreMargin || 0) >= 2000
    ).length,
    fullLobbyWins: wins.filter(
      (result) =>
        result.gameMode === "group_lobby" && (result.playerCount || 0) >= 10
    ).length,
    maxPartyPlayers: Math.max(
      0,
      ...partyResults.map((result) => result.playerCount || 0)
    ),
    currentWinStreak,
    bestWinStreak,
  };
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDaysBetween(previousDateKey: string, currentDateKey: string) {
  const previousDate = new Date(`${previousDateKey}T00:00:00`);
  const currentDate = new Date(`${currentDateKey}T00:00:00`);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round(
    (currentDate.getTime() - previousDate.getTime()) / millisecondsPerDay
  );
}

function calculateAccuracy(correctAnswers: number, totalQuestions: number) {
  if (totalQuestions === 0) {
    return 0;
  }

  return Math.round((correctAnswers / totalQuestions) * 100);
}

function calculateAverage(
  previousAverage: number,
  previousCount: number,
  next: number,
  nextCount: number
) {
  if (previousCount === 0) {
    return next;
  }

  return (
    (previousAverage * previousCount + next * nextCount) /
    (previousCount + nextCount)
  );
}

function isTrackTestStats(value: unknown): value is TrackTestStats {
  if (!value || typeof value !== "object") {
    return false;
  }

  const possibleStats = value as Partial<TrackTestStats>;

  return (
    possibleStats.version === 1 &&
    Array.isArray(possibleStats.quizResults) &&
    Boolean(possibleStats.overall) &&
    Boolean(possibleStats.artists) &&
    Boolean(possibleStats.albums)
  );
}

export function getTrackTestStats() {
  try {
    const storedStats = localStorage.getItem(STATS_STORAGE_KEY);

    if (!storedStats) {
      return createEmptyStats();
    }

    const parsedStats: unknown = JSON.parse(storedStats);

    if (!isTrackTestStats(parsedStats)) {
      return createEmptyStats();
    }

    return {
      ...parsedStats,
      arena: parsedStats.arena || createEmptyArenaProgress(),
    };
  } catch (error) {
    console.error("Could not load TrackTest stats:", error);
    return createEmptyStats();
  }
}

export function setTrackTestStats(stats: TrackTestStats) {
  try {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch (error) {
    console.error("Could not save TrackTest stats:", error);
  }
}

export function saveQuizResult(result: Omit<QuizResult, "id" | "datePlayed">) {
  const stats = getTrackTestStats();
  const datePlayed = new Date().toISOString();
  const playedDateKey = getLocalDateKey();
  const quizResult: QuizResult = {
    ...result,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    datePlayed,
  };

  const previousQuestionCount = stats.overall.totalQuestionsAnswered;
  const previousLastPlayedDate = stats.overall.lastPlayedDate;
  const daysSinceLastPlay = previousLastPlayedDate
    ? getDaysBetween(previousLastPlayedDate, playedDateKey)
    : null;

  stats.quizResults = [quizResult, ...stats.quizResults].slice(0, 100);
  stats.overall.totalQuizzesPlayed += 1;
  stats.overall.totalCorrectAnswers += result.correctAnswers;
  stats.overall.totalQuestionsAnswered += result.totalQuestions;
  stats.overall.overallAccuracy = calculateAccuracy(
    stats.overall.totalCorrectAnswers,
    stats.overall.totalQuestionsAnswered
  );
  stats.overall.totalPoints += result.finalPoints;
  stats.overall.bestScore = Math.max(
    stats.overall.bestScore,
    result.finalPoints
  );
  stats.overall.averageAnswerTime = calculateAverage(
    stats.overall.averageAnswerTime,
    previousQuestionCount,
    result.averageAnswerTime,
    result.totalQuestions
  );

  if (previousLastPlayedDate === playedDateKey) {
    stats.overall.currentDailyStreak = Math.max(
      1,
      stats.overall.currentDailyStreak
    );
  } else if (daysSinceLastPlay === 1) {
    stats.overall.currentDailyStreak += 1;
  } else {
    stats.overall.currentDailyStreak = 1;
  }

  stats.overall.lastPlayedDate = playedDateKey;

  const artistKey = normalizeKey(result.artistName);
  const existingArtist = stats.artists[artistKey] || {
    artistName: result.artistName,
    quizzesPlayed: 0,
    correctAnswers: 0,
    totalQuestions: 0,
    accuracy: 0,
    totalPoints: 0,
    bestScore: 0,
  };

  existingArtist.quizzesPlayed += 1;
  existingArtist.correctAnswers += result.correctAnswers;
  existingArtist.totalQuestions += result.totalQuestions;
  existingArtist.accuracy = calculateAccuracy(
    existingArtist.correctAnswers,
    existingArtist.totalQuestions
  );
  existingArtist.totalPoints += result.finalPoints;
  existingArtist.bestScore = Math.max(
    existingArtist.bestScore,
    result.finalPoints
  );
  stats.artists[artistKey] = existingArtist;

  const albumKey = normalizeKey(`${result.artistName}-${result.albumName}`);
  const existingAlbum = stats.albums[albumKey] || {
    albumName: result.albumName,
    artistName: result.artistName,
    timesPlayed: 0,
    bestScore: 0,
    bestAccuracy: 0,
    lastPlayedDate: "",
  };

  existingAlbum.timesPlayed += 1;
  existingAlbum.bestScore = Math.max(existingAlbum.bestScore, result.finalPoints);
  existingAlbum.bestAccuracy = Math.max(
    existingAlbum.bestAccuracy,
    result.accuracyPercentage
  );
  existingAlbum.lastPlayedDate = playedDateKey;
  stats.albums[albumKey] = existingAlbum;

  setTrackTestStats(stats);

  return quizResult;
}

export function clearTrackTestStats() {
  try {
    localStorage.removeItem(STATS_STORAGE_KEY);
  } catch (error) {
    console.error("Could not clear TrackTest stats:", error);
  }
}
