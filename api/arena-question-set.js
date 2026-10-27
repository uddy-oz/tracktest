const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;
const RESERVE_QUESTIONS = 4;
const CLIP_LENGTH_SECONDS = 5;

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function clipStart(durationSeconds, random) {
  const latestStart = Math.max(0, durationSeconds - CLIP_LENGTH_SECONDS);
  const start = latestStart >= 6
    ? 6 + random() * (Math.min(22, latestStart) - 6)
    : Math.max(0, random() * latestStart);
  return Number(start.toFixed(3));
}

function playableTracksFromITunes(results, expectedCollectionId) {
  if (!Array.isArray(results) || !results.length) return [];
  const collection = results.find((item) => item.wrapperType === "collection");
  if (!collection || String(collection.collectionId) !== String(expectedCollectionId)) {
    throw new Error("The selected album could not be verified by the music catalog.");
  }

  const seen = new Set();
  return results
    .filter((item) => item.wrapperType === "track")
    .filter((track) => {
      const id = String(track.trackId || "");
      const url = typeof track.previewUrl === "string" ? track.previewUrl : "";
      let safePreview = false;
      try {
        const parsed = new URL(url);
        safePreview = parsed.protocol === "https:" &&
          ["audio-ssl.itunes.apple.com", "audio.itunes.apple.com"].includes(parsed.hostname);
      } catch {
        safePreview = false;
      }
      if (!/^\d+$/.test(id) || !safePreview || seen.has(id)) return false;
      const name = cleanText(track.trackName);
      if (!name) return false;
      seen.add(id);
      return true;
    })
    .map((track) => ({
      id: `itunes-${track.trackId}`,
      name: cleanText(track.trackName),
      artistName: cleanText(track.artistName),
      previewUrl: track.previewUrl,
      durationSeconds: 30,
    }));
}

export function buildTrustedQuestionSet({
  tracks,
  mode,
  roundNumber,
  questionSetId,
  random = Math.random,
  uuid = () => crypto.randomUUID(),
}) {
  const usable = Array.isArray(tracks) ? tracks : [];
  if (usable.length < MIN_QUESTIONS) {
    throw new Error(`This album has ${usable.length} playable previews. Choose an album with at least ${MIN_QUESTIONS}.`);
  }

  const targetQuestionCount = Math.min(
    MAX_QUESTIONS,
    Math.max(MIN_QUESTIONS, Math.floor(usable.length / 2) + 1)
  );
  const reserveCount = mode === "party_mode"
    ? 0
    : Math.min(RESERVE_QUESTIONS, usable.length - targetQuestionCount);
  const selected = shuffle(usable, random).slice(0, targetQuestionCount + reserveCount);

  const candidates = selected.map((correctTrack) => {
    const optionTracks = shuffle([
      correctTrack,
      ...shuffle(usable.filter((track) => track.id !== correctTrack.id), random).slice(0, 3),
    ], random);
    const questionId = uuid();
    const options = optionTracks.map((track) => ({
      id: uuid(),
      name: track.name,
      artistName: track.artistName,
      trackId: track.id,
    }));
    const correctOption = options.find((option) => option.trackId === correctTrack.id);
    const publicQuestion = {
      questionId,
      options: options.map(({ id, name }) => ({ id, name })),
      clipStartSeconds: clipStart(correctTrack.durationSeconds || 30, random),
    };
    const answerKey = {
      questionId,
      correctOptionId: correctOption.id,
      correctAnswer: correctTrack.name,
      correctTrackId: correctTrack.id,
      previewUrl: correctTrack.previewUrl,
      clipStartSeconds: publicQuestion.clipStartSeconds,
    };
    return { publicQuestion, answerKey };
  });

  return {
    questionSetId,
    roundNumber,
    targetQuestionCount,
    questions: candidates.slice(0, targetQuestionCount).map((entry) => entry.publicQuestion),
    reserveQuestions: candidates.slice(targetQuestionCount).map((entry) => entry.publicQuestion),
    keys: candidates.map((entry) => entry.answerKey),
  };
}

export function parseITunesAlbumId(albumId) {
  const value = String(albumId || "").trim();
  const match = value.match(/^itunes:([a-z]{2}):(\d+)$/i);
  if (match) return { country: match[1].toLowerCase(), collectionId: match[2] };
  if (/^\d+$/.test(value)) return { country: "us", collectionId: value };
  throw new Error("The selected album identifier is invalid.");
}

export function playableTracksFromLookup(results, collectionId) {
  return playableTracksFromITunes(results, collectionId);
}
