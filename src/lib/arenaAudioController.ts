import { getArenaClientId, isArenaDebugEnabled } from "./arenaDiagnostics";

export type ArenaAudioPhase =
  | "idle"
  | "preparing_audio"
  | "countdown"
  | "answering"
  | "reveal"
  | "finished"
  | "party_waiting_audio"
  | "party_host_watching";

export type ArenaAudioRound = {
  roomId: string;
  matchGeneration: number;
  userId?: string | null;
  mode: "duel" | "group_lobby" | "party_mode";
  roundKey: string;
  roundId: string;
  roundIndex: number;
  phase: ArenaAudioPhase;
  previewUrl: string;
  clipStartSeconds: number;
  serverTimestamp?: string | null;
};

export type ArenaAudioStartRequest = {
  roundKey: string;
  timelineStartsAtMs: number;
  clockOffsetMs: number;
  clipLengthSeconds: number;
};

export type ArenaAudioPlayResult =
  | { status: "playing" }
  | { status: "failed"; message: string }
  | { status: "expired"; message: string }
  | { status: "stale" };

export type ArenaAudioReadyResult =
  | { status: "ready"; attempts: number; prefetched: boolean }
  | { status: "failed"; message: string; attempts: number }
  | { status: "stale" };

export type ArenaAudioReadyOptions = {
  deadlineMs?: number;
  maxAttempts?: number;
};

export type ArenaAudioFailure = {
  roundKey: string;
  message: string;
  errorName?: string;
  errorMessage?: string;
};

export type ArenaAudioDiagnosticSnapshot = {
  event: string;
  mediaUnlocked: boolean;
  roomId: string | null;
  roundIndex: number | null;
  phase: ArenaAudioPhase | null;
  previewHost: string | null;
  sourceReceived: boolean;
  readyState: number | null;
  networkState: number | null;
  currentTime: number | null;
  duration: number | null;
  paused: boolean | null;
  elapsedMs: number | null;
  visibilityState: DocumentVisibilityState;
  errorCode: number | null;
  errorMessage: string | null;
  [key: string]: unknown;
};

type ArenaAudioCallbacks = {
  onPlaybackChange?: (isPlaying: boolean) => void;
  onPlaybackConfirmed?: (roundKey: string) => void;
  onPlaybackStopped?: (roundKey: string, reason: string) => void;
  onPlaybackFailure?: (failure: ArenaAudioFailure) => void;
  onDiagnostic?: (snapshot: ArenaAudioDiagnosticSnapshot) => void;
};

type ActivePlayback = {
  roundKey: string;
  clipEndSeconds: number;
  request: ArenaAudioStartRequest;
};

type DiagnosticEvent =
  | "ROUND_STATE_RECEIVED"
  | "QUESTION_CHANGED"
  | "ROUND_RECEIVED"
  | "ROUND_CHANGED"
  | "PREVIEW_CHANGED"
  | "AUDIO_LOAD_REQUESTED"
  | "AUDIO_SOURCE_SET"
  | "READINESS_CHECK_STARTED"
  | "READINESS_CONFIRMED"
  | "READINESS_FAILED"
  | "MEDIA_UNLOCK_REQUESTED"
  | "MEDIA_UNLOCKED"
  | "MEDIA_UNLOCK_FAILED"
  | "LOADSTART"
  | "LOADEDDATA"
  | "PAUSE"
  | "SUSPEND"
  | "LOADEDMETADATA"
  | "CANPLAY"
  | "CANPLAYTHROUGH"
  | "SEEK_REQUESTED"
  | "SEEKED"
  | "PLAY_REQUESTED"
  | "PLAY_RESOLVED"
  | "PLAY_REJECTED"
  | "PLAYBACK_CONFIRMED"
  | "PLAYBACK_NOT_ADVANCING"
  | "PAUSE_REQUESTED"
  | "ROUND_WINNER_RECEIVED"
  | "REVEAL_STARTED"
  | "NEXT_ROUND_RECEIVED"
  | "PRELOAD_NEXT_REQUESTED"
  | "PRELOAD_NEXT_READY"
  | "PLAYBACK_RETRY"
  | "TIMELINE_RESEEK"
  | "STALE_EVENT_IGNORED"
  | "MEDIA_WAITING"
  | "MEDIA_STALLED"
  | "MEDIA_ERROR"
  | "MEDIA_ENDED"
  | "MEDIA_ABORTED"
  | "MEDIA_EMPTIED"
  | "READY_ACK_ATTEMPTED"
  | "READY_ACK_SUCCESS"
  | "READY_ACK_FAILURE"
  | "SERVER_PHASE_SEEN"
  | "MATCH_RESET";

const MEDIA_READY_TIMEOUT_MS = 4000;
const COMPETITIVE_READY_TIMEOUT_MS = 10500;
const COMPETITIVE_READY_ATTEMPTS = 3;
const MINIMUM_READY_ATTEMPT_MS = 900;
const PLAY_PROMISE_TIMEOUT_MS = 3000;
const PLAYBACK_PROGRESS_TIMEOUT_MS = 1800;
const PLAYBACK_STALL_GRACE_MS = 1400;
const MINIMUM_PROGRESS_SECONDS = 0.08;
const MINIMUM_BUFFER_SECONDS = 0.2;
const MAXIMUM_TIMELINE_DRIFT_SECONDS = 0.25;

function getErrorDetails(error: unknown) {
  if (error instanceof DOMException || error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { name: "UnknownError", message: String(error) };
}

function sameMediaUrl(left: string, right: string) {
  if (!left || !right) return false;

  try {
    return new URL(left, window.location.href).href ===
      new URL(right, window.location.href).href;
  } catch {
    return left === right;
  }
}

function createSilentWavDataUrl() {
  const sampleRate = 8000;
  const sampleCount = 800;
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${window.btoa(binary)}`;
}

export class ArenaAudioController {
  private audio: HTMLAudioElement | null = null;
  private preloader: HTMLAudioElement | null = null;
  private preloaderCleanup: (() => void) | null = null;
  private prefetchedUrls = new Set<string>();
  private callbacks: ArenaAudioCallbacks = {};
  private activeRound: ArenaAudioRound | null = null;
  private activePlayback: ActivePlayback | null = null;
  private operationId = 0;
  private clipStopTimer: number | null = null;
  private stallTimer: number | null = null;
  private stallRecoveryRoundKey = "";
  private clientId = getArenaClientId();
  private debugEnabled = isArenaDebugEnabled();
  private mediaUnlocked = false;
  private questionReceivedAt = 0;

  setCallbacks(callbacks: ArenaAudioCallbacks) {
    this.callbacks = callbacks;
  }

  attach(audio: HTMLAudioElement) {
    if (this.audio === audio) return;

    this.detach();
    this.audio = audio;
    audio.preload = "auto";
    audio.controls = false;
    audio.addEventListener("loadedmetadata", this.handleLoadedMetadata);
    audio.addEventListener("loadstart", this.handleLoadStart);
    audio.addEventListener("loadeddata", this.handleLoadedData);
    audio.addEventListener("canplay", this.handleCanPlay);
    audio.addEventListener("canplaythrough", this.handleCanPlayThrough);
    audio.addEventListener("seeked", this.handleSeeked);
    audio.addEventListener("playing", this.handlePlaying);
    audio.addEventListener("waiting", this.handleWaiting);
    audio.addEventListener("stalled", this.handleStalled);
    audio.addEventListener("error", this.handleError);
    audio.addEventListener("timeupdate", this.handleTimeUpdate);
    audio.addEventListener("ended", this.handleEnded);
    audio.addEventListener("pause", this.handlePause);
    audio.addEventListener("suspend", this.handleSuspend);
    audio.addEventListener("abort", this.handleAbort);
    audio.addEventListener("emptied", this.handleEmptied);

    if (this.activeRound) {
      this.loadActiveRoundSource("ROUND_RECEIVED");
    }
  }

  detach() {
    const audio = this.audio;
    if (!audio) return;

    this.stopTimers();
    audio.pause();
    audio.removeEventListener("loadedmetadata", this.handleLoadedMetadata);
    audio.removeEventListener("loadstart", this.handleLoadStart);
    audio.removeEventListener("loadeddata", this.handleLoadedData);
    audio.removeEventListener("canplay", this.handleCanPlay);
    audio.removeEventListener("canplaythrough", this.handleCanPlayThrough);
    audio.removeEventListener("seeked", this.handleSeeked);
    audio.removeEventListener("playing", this.handlePlaying);
    audio.removeEventListener("waiting", this.handleWaiting);
    audio.removeEventListener("stalled", this.handleStalled);
    audio.removeEventListener("error", this.handleError);
    audio.removeEventListener("timeupdate", this.handleTimeUpdate);
    audio.removeEventListener("ended", this.handleEnded);
    audio.removeEventListener("pause", this.handlePause);
    audio.removeEventListener("suspend", this.handleSuspend);
    audio.removeEventListener("abort", this.handleAbort);
    audio.removeEventListener("emptied", this.handleEmptied);
    this.audio = null;
  }

  dispose() {
    this.operationId += 1;
    this.stopTimers();
    this.audio?.pause();
    this.detach();

    if (this.preloader) {
      this.preloaderCleanup?.();
      this.preloaderCleanup = null;
      this.preloader.pause();
      this.preloader.removeAttribute("src");
      this.preloader.load();
      this.preloader = null;
    }

    this.activeRound = null;
    this.activePlayback = null;
    this.mediaUnlocked = false;
    this.prefetchedUrls.clear();
  }

  resetMatch(reason: string) {
    this.log("MATCH_RESET", {
      reason,
      previousRoundKey: this.activeRound?.roundKey || null,
      preservedMediaUnlock: this.mediaUnlocked,
    });
    this.operationId += 1;
    this.stopTimers();
    this.audio?.pause();
    this.activeRound = null;
    this.activePlayback = null;
    this.stallRecoveryRoundKey = "";
    this.questionReceivedAt = 0;

    if (this.audio) {
      this.audio.removeAttribute("src");
      this.audio.load();
    }

    if (this.preloader) {
      this.preloaderCleanup?.();
      this.preloaderCleanup = null;
      this.preloader.pause();
      this.preloader.removeAttribute("src");
      this.preloader.load();
    }

    this.prefetchedUrls.clear();
    this.callbacks.onPlaybackChange?.(false);
  }

  prepareRound(round: ArenaAudioRound, nextPreviewUrl = "") {
    const previousRound = this.activeRound;
    const isNewRound = previousRound?.roundKey !== round.roundKey;

    if (isNewRound) {
      this.operationId += 1;
      this.stopTimers();
      this.pauseCurrentAudio("round-changed");
      this.activePlayback = null;
      this.stallRecoveryRoundKey = "";
      this.questionReceivedAt = Date.now();
    }

    this.activeRound = round;
    this.log("ROUND_STATE_RECEIVED", {
      previousRoundKey: previousRound?.roundKey || null,
    });
    this.log(isNewRound ? "ROUND_CHANGED" : "ROUND_RECEIVED", {
      previousRoundKey: previousRound?.roundKey || null,
    });
    if (
      previousRound &&
      previousRound.roomId === round.roomId &&
      previousRound.roundIndex !== round.roundIndex
    ) {
      this.log("NEXT_ROUND_RECEIVED", {
        previousRoundIndex: previousRound.roundIndex,
      });
      this.log("QUESTION_CHANGED", {
        previousRoundIndex: previousRound.roundIndex,
        nextRoundIndex: round.roundIndex,
      });
    }
    this.loadActiveRoundSource(isNewRound ? "PREVIEW_CHANGED" : "ROUND_RECEIVED");

    if (nextPreviewUrl && nextPreviewUrl !== round.previewUrl) {
      this.warmPreview(nextPreviewUrl, round.roundIndex + 1);
    }
  }

  warmPreview(previewUrl: string, roundIndex = 0) {
    if (!previewUrl) return;
    this.preloadPreview(previewUrl, roundIndex);
  }

  unlockFromUserGesture() {
    const audio = this.audio;
    if (!audio || this.mediaUnlocked) {
      return Promise.resolve(this.mediaUnlocked);
    }

    const roundToRestore = this.activeRound;
    const previousMuted = audio.muted;
    const previousVolume = audio.volume;
    const unlockUrl = createSilentWavDataUrl();
    this.operationId += 1;
    this.stopTimers();
    audio.pause();
    audio.src = unlockUrl;
    audio.muted = false;
    audio.volume = 1;
    audio.load();
    this.log("MEDIA_UNLOCK_REQUESTED");

    const playPromise = audio.play();
    const restorePreparedRound = () => {
      audio.pause();
      audio.muted = previousMuted;
      audio.volume = previousVolume;
      if (
        roundToRestore &&
        this.activeRound?.roundKey === roundToRestore.roundKey
      ) {
        audio.src = roundToRestore.previewUrl;
        audio.load();
        this.log("AUDIO_LOAD_REQUESTED", { reason: "restore-after-unlock" });
      } else if (!this.activeRound && sameMediaUrl(audio.src, unlockUrl)) {
        audio.removeAttribute("src");
        audio.load();
      }
    };

    return playPromise
      .then(() => {
        this.mediaUnlocked = true;
        this.log("MEDIA_UNLOCKED");
        restorePreparedRound();
        return true;
      })
      .catch((error) => {
        const details = getErrorDetails(error);
        this.log("MEDIA_UNLOCK_FAILED", details);
        restorePreparedRound();
        return false;
      });
  }

  isMediaUnlocked() {
    return this.mediaUnlocked;
  }

  noteDiagnostic(
    event: "READY_ACK_ATTEMPTED" | "READY_ACK_SUCCESS" | "READY_ACK_FAILURE" | "SERVER_PHASE_SEEN",
    details: Record<string, unknown> = {}
  ) {
    this.log(event, details);
  }

  async waitUntilRoundReady(
    roundKey: string,
    clipLengthSeconds: number,
    options: ArenaAudioReadyOptions = {}
  ): Promise<ArenaAudioReadyResult> {
    const round = this.activeRound;
    const audio = this.audio;

    if (!round || !audio || round.roundKey !== roundKey) {
      return { status: "stale" };
    }

    if (!round.previewUrl) {
      return {
        status: "failed",
        message: "This preview URL is missing.",
        attempts: 0,
      };
    }

    const operationId = ++this.operationId;
    const maxAttempts = Math.max(
      1,
      Math.min(options.maxAttempts || COMPETITIVE_READY_ATTEMPTS, 3)
    );
    const deadlineMs = Number.isFinite(options.deadlineMs)
      ? Number(options.deadlineMs)
      : Date.now() + COMPETITIVE_READY_TIMEOUT_MS;
    const wasPrefetched = this.prefetchedUrls.has(round.previewUrl);
    this.stopTimers();
    this.activePlayback = null;
    this.log("READINESS_CHECK_STARTED", {
      deadlineMs,
      maxAttempts,
      prefetched: wasPrefetched,
    });

    let lastMessage = "Preview data was not playable in time.";
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (!this.isCurrent(operationId, roundKey, round.previewUrl)) {
        return { status: "stale" };
      }

      const remainingMs = deadlineMs - Date.now();
      if (remainingMs < MINIMUM_READY_ATTEMPT_MS) break;
      attemptsUsed = attempt;

      const attemptsLeft = maxAttempts - attempt + 1;
      const attemptBudgetMs = Math.max(
        MINIMUM_READY_ATTEMPT_MS,
        Math.floor(remainingMs / attemptsLeft)
      );

      if (attempt > 1) {
        this.log("PLAYBACK_RETRY", {
          reason: "readiness",
          attempt,
          remainingMs,
        });
        this.reloadActiveSource(round, `readiness-retry-${attempt}`);
      }

      try {
        const metadataBudgetMs = Math.max(
          500,
          Math.floor(attemptBudgetMs * 0.4)
        );
        const hasMetadata = await this.waitForMetadata(
          operationId,
          round,
          metadataBudgetMs
        );

        if (!hasMetadata) {
          lastMessage = "Preview metadata did not load in time.";
          continue;
        }

        if (deadlineMs - Date.now() < 250) {
          lastMessage = "The audio readiness deadline elapsed after loading metadata.";
          break;
        }

        const targetTime = this.getSafeClipStart(
          audio,
          round.clipStartSeconds,
          clipLengthSeconds
        );
        const seekBudgetMs = Math.max(
          250,
          Math.min(
            attemptBudgetMs - metadataBudgetMs,
            deadlineMs - Date.now()
          )
        );
        const isSeekable = await this.seekAndWait(
          operationId,
          round,
          targetTime,
          seekBudgetMs
        );

        if (!isSeekable) {
          lastMessage = "Preview data was not playable in time.";
          continue;
        }

        this.log("READINESS_CONFIRMED", {
          targetTime,
          attempt,
          prefetched: wasPrefetched,
        });
        return { status: "ready", attempts: attempt, prefetched: wasPrefetched };
      } catch (error) {
        const details = getErrorDetails(error);
        lastMessage = `${details.name}: ${details.message}`;
        this.log("READINESS_FAILED", { ...details, attempt });
      }
    }

    return this.isCurrent(operationId, roundKey, round.previewUrl)
      ? { status: "failed", message: lastMessage, attempts: attemptsUsed }
      : { status: "stale" };
  }

  updateRoundPhase(
    roundKey: string,
    phase: ArenaAudioPhase,
    serverTimestamp?: string | null
  ) {
    if (!this.activeRound || this.activeRound.roundKey !== roundKey) {
      this.log("STALE_EVENT_IGNORED", {
        requestedRoundKey: roundKey,
        reason: "phase-update",
      });
      return;
    }

    this.activeRound = { ...this.activeRound, phase, serverTimestamp };

    if (phase === "reveal") {
      this.log("REVEAL_STARTED");
    }
  }

  noteRoundWinner(roundKey: string) {
    if (this.activeRound?.roundKey === roundKey) {
      this.log("ROUND_WINNER_RECEIVED");
    }
  }

  async startRound(
    request: ArenaAudioStartRequest
  ): Promise<ArenaAudioPlayResult> {
    const round = this.activeRound;
    const audio = this.audio;

    if (!round || !audio || round.roundKey !== request.roundKey) {
      this.log("STALE_EVENT_IGNORED", {
        requestedRoundKey: request.roundKey,
        reason: "start-round",
      });
      return { status: "stale" };
    }

    if (!round.previewUrl) {
      return { status: "failed", message: "This preview URL is missing." };
    }

    const operationId = ++this.operationId;
    this.stopTimers();
    this.activePlayback = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.isCurrent(operationId, request.roundKey, round.previewUrl)) {
        this.log("STALE_EVENT_IGNORED", {
          requestedRoundKey: request.roundKey,
          reason: "play-attempt",
        });
        return { status: "stale" };
      }

      if (attempt > 0) {
        this.log("PLAYBACK_RETRY", { attempt: attempt + 1 });
        this.pauseCurrentAudio("bounded-retry");
        audio.load();
        this.log("AUDIO_LOAD_REQUESTED", { reason: "bounded-retry" });
      }

      const result = await this.attemptPlayback(
        round,
        request,
        operationId,
        attempt
      );

      if (result.status === "playing" || result.status === "stale") {
        return result;
      }

      if (result.status === "expired") {
        return result;
      }
    }

    return {
      status: "failed",
      message: "The preview did not become playable after one retry.",
    };
  }

  async primeRound(roundKey: string): Promise<boolean> {
    const round = this.activeRound;
    const audio = this.audio;

    if (!round || !audio || round.roundKey !== roundKey || !round.previewUrl) {
      return false;
    }

    const operationId = ++this.operationId;
    const previousMuted = audio.muted;
    const previousTime = audio.currentTime;

    try {
      if (!(await this.waitForMetadata(operationId, round))) return false;

      const targetTime = this.getSafeClipStart(audio, round.clipStartSeconds, 5);
      if (!(await this.seekAndWait(operationId, round, targetTime))) return false;

      audio.muted = true;
      this.log("PLAY_REQUESTED", { reason: "user-audio-prime" });
      await this.playWithTimeout(audio);

      if (!this.isCurrent(operationId, roundKey, round.previewUrl)) {
        return false;
      }

      audio.pause();
      audio.currentTime = previousTime;
      audio.muted = previousMuted;
      this.mediaUnlocked = true;
      this.log("MEDIA_UNLOCKED", { reason: "user-audio-prime" });
      this.log("PLAY_RESOLVED", { reason: "user-audio-prime" });
      return true;
    } catch (error) {
      const details = getErrorDetails(error);
      this.log("PLAY_REJECTED", {
        reason: "user-audio-prime",
        errorName: details.name,
        errorMessage: details.message,
      });

      if (this.isCurrent(operationId, roundKey, round.previewUrl)) {
        audio.pause();
        audio.muted = previousMuted;
      }

      return false;
    }
  }

  stopRound(
    roundKey: string,
    options: { resetToClipStart?: boolean; reason?: string } = {}
  ) {
    const round = this.activeRound;
    if (!round || round.roundKey !== roundKey) {
      this.log("STALE_EVENT_IGNORED", {
        requestedRoundKey: roundKey,
        reason: options.reason || "stop-round",
      });
      return false;
    }

    this.operationId += 1;
    this.stopTimers();
    this.log("PAUSE_REQUESTED", { reason: options.reason || "stop-round" });
    this.pauseCurrentAudio(options.reason || "stop-round");

    if (options.resetToClipStart && this.audio) {
      this.audio.currentTime = round.clipStartSeconds;
    }

    this.activePlayback = null;
    this.callbacks.onPlaybackChange?.(false);
    this.callbacks.onPlaybackStopped?.(roundKey, options.reason || "stop-round");
    return true;
  }

  stopAll(reason: string) {
    this.operationId += 1;
    this.stopTimers();
    this.log("PAUSE_REQUESTED", { reason });
    this.pauseCurrentAudio(reason);
    this.activePlayback = null;
    this.activeRound = null;
    this.callbacks.onPlaybackChange?.(false);
  }

  private async attemptPlayback(
    round: ArenaAudioRound,
    request: ArenaAudioStartRequest,
    operationId: number,
    attempt: number
  ): Promise<ArenaAudioPlayResult> {
    const audio = this.audio;
    if (!audio) return { status: "stale" };

    try {
      if (!(await this.waitForMetadata(operationId, round))) {
        return this.isCurrent(operationId, round.roundKey, round.previewUrl)
          ? { status: "failed", message: "Preview metadata did not load." }
          : { status: "stale" };
      }

      const safeClipStart = this.getSafeClipStart(
        audio,
        round.clipStartSeconds,
        request.clipLengthSeconds
      );
      let targetTime = safeClipStart;
      let isTimelineAligned = false;

      for (let seekPass = 0; seekPass < 3; seekPass += 1) {
        const timelineOffsetSeconds = this.getTimelineOffset(request);
        if (timelineOffsetSeconds >= request.clipLengthSeconds) {
          return {
            status: "expired",
            message: "The shared preview window has already ended.",
          };
        }

        targetTime = Math.min(
          safeClipStart + timelineOffsetSeconds,
          safeClipStart + request.clipLengthSeconds
        );
        if (!(await this.seekAndWait(operationId, round, targetTime))) {
          return this.isCurrent(operationId, round.roundKey, round.previewUrl)
            ? { status: "failed", message: "The preview seek did not become playable." }
            : { status: "stale" };
        }

        const latestTimelineOffset = this.getTimelineOffset(request);
        const preparedTimelineOffset = Math.max(
          0,
          audio.currentTime - safeClipStart
        );
        const driftSeconds = latestTimelineOffset - preparedTimelineOffset;

        if (Math.abs(driftSeconds) <= MAXIMUM_TIMELINE_DRIFT_SECONDS) {
          isTimelineAligned = true;
          break;
        }

        this.log("TIMELINE_RESEEK", {
          seekPass: seekPass + 1,
          driftSeconds,
        });
      }

      if (!isTimelineAligned) {
        return {
          status: "failed",
          message: "The preview could not align with the shared round clock.",
        };
      }

      const positionBeforePlay = audio.currentTime;
      this.log("PLAY_REQUESTED", { attempt: attempt + 1, targetTime });
      await this.playWithTimeout(audio);

      if (!this.isCurrent(operationId, round.roundKey, round.previewUrl)) {
        return { status: "stale" };
      }

      this.log("PLAY_RESOLVED", { attempt: attempt + 1 });
      const didAdvance = await this.waitForPlaybackProgress(
        audio,
        operationId,
        round,
        positionBeforePlay
      );

      if (!this.isCurrent(operationId, round.roundKey, round.previewUrl)) {
        return { status: "stale" };
      }

      if (!didAdvance) {
        this.log("PLAYBACK_NOT_ADVANCING", { attempt: attempt + 1 });
        return {
          status: "failed",
          message: "Playback started but media time did not advance.",
        };
      }

      const latestTimelineOffset = this.getTimelineOffset(request);
      if (latestTimelineOffset >= request.clipLengthSeconds) {
        return {
          status: "expired",
          message: "The shared preview window ended while audio was loading.",
        };
      }

      this.activePlayback = {
        roundKey: round.roundKey,
        clipEndSeconds: safeClipStart + request.clipLengthSeconds,
        request,
      };
      this.log("PLAYBACK_CONFIRMED", {
        attempt: attempt + 1,
        timelineOffsetSeconds: latestTimelineOffset,
      });
      this.callbacks.onPlaybackChange?.(true);
      this.callbacks.onPlaybackConfirmed?.(round.roundKey);
      this.scheduleClipStop(round.roundKey, request, latestTimelineOffset);
      return { status: "playing" };
    } catch (error) {
      const details = getErrorDetails(error);
      this.log("PLAY_REJECTED", {
        attempt: attempt + 1,
        errorName: details.name,
        errorMessage: details.message,
      });

      if (!this.isCurrent(operationId, round.roundKey, round.previewUrl)) {
        return { status: "stale" };
      }

      return {
        status: "failed",
        message: `${details.name}: ${details.message}`,
      };
    }
  }

  private loadActiveRoundSource(event: DiagnosticEvent) {
    const audio = this.audio;
    const round = this.activeRound;
    if (!audio || !round?.previewUrl) return;

    const sourceChanged =
      !sameMediaUrl(audio.src, round.previewUrl) &&
      !sameMediaUrl(audio.currentSrc, round.previewUrl);

    if (sourceChanged) {
      audio.src = round.previewUrl;
      this.log("AUDIO_SOURCE_SET", { sourceChanged: true });
      this.log(event, { sourceChanged: true });
      audio.load();
      this.log("AUDIO_LOAD_REQUESTED", { reason: "prepare-round" });
      return;
    }

    if (
      audio.networkState === HTMLMediaElement.NETWORK_EMPTY ||
      audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
      audio.error
    ) {
      audio.load();
      this.log("AUDIO_LOAD_REQUESTED", { reason: "recover-existing-source" });
    }
  }

  private reloadActiveSource(round: ArenaAudioRound, reason: string) {
    const audio = this.audio;
    if (!audio || this.activeRound?.roundKey !== round.roundKey) return;

    this.pauseCurrentAudio(reason);
    audio.src = round.previewUrl;
    audio.load();
    this.log("AUDIO_LOAD_REQUESTED", { reason });
  }

  private preloadPreview(previewUrl: string, roundIndex: number) {
    if (!this.preloader) {
      this.preloader = document.createElement("audio");
      this.preloader.preload = "auto";
    }

    const preloader = this.preloader;
    if (
      sameMediaUrl(preloader.src, previewUrl) &&
      this.prefetchedUrls.has(previewUrl)
    ) {
      return;
    }

    this.preloaderCleanup?.();
    this.preloaderCleanup = null;
    preloader.pause();
    preloader.src = previewUrl;
    this.log("PRELOAD_NEXT_REQUESTED", {
      nextRoundIndex: roundIndex,
      nextPreviewUrl: previewUrl,
    });

    const handleReady = () => {
      if (!sameMediaUrl(preloader.currentSrc || preloader.src, previewUrl)) {
        return;
      }

      this.prefetchedUrls.add(previewUrl);
      this.log("PRELOAD_NEXT_READY", {
        nextRoundIndex: roundIndex,
        nextPreviewUrl: previewUrl,
        preloadReadyState: preloader.readyState,
        preloadNetworkState: preloader.networkState,
      });
      cleanup();
    };

    const handleError = () => cleanup();
    const cleanup = () => {
      preloader.removeEventListener("canplay", handleReady);
      preloader.removeEventListener("error", handleError);
      if (this.preloaderCleanup === cleanup) this.preloaderCleanup = null;
    };

    preloader.addEventListener("canplay", handleReady);
    preloader.addEventListener("error", handleError);
    this.preloaderCleanup = cleanup;
    preloader.load();
  }

  private async waitForMetadata(
    operationId: number,
    round: ArenaAudioRound,
    timeoutMs = MEDIA_READY_TIMEOUT_MS
  ) {
    const audio = this.audio;
    if (!audio) return false;

    if (
      audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
      Number.isFinite(audio.duration) &&
      this.isCurrent(operationId, round.roundKey, round.previewUrl)
    ) {
      return true;
    }

    return this.waitForCondition(
      audio,
      ["loadedmetadata", "durationchange", "canplay"],
      () =>
        audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
        Number.isFinite(audio.duration),
      operationId,
      round,
      timeoutMs
    );
  }

  private async seekAndWait(
    operationId: number,
    round: ArenaAudioRound,
    targetTime: number,
    timeoutMs = MEDIA_READY_TIMEOUT_MS
  ) {
    const audio = this.audio;
    if (!audio) return false;

    this.log("SEEK_REQUESTED", { targetTime });
    audio.currentTime = targetTime;

    return this.waitForCondition(
      audio,
      ["seeked", "canplay", "canplaythrough", "loadeddata", "progress"],
      () =>
        !audio.seeking &&
        (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ||
          this.isBufferedAt(audio, audio.currentTime)),
      operationId,
      round,
      timeoutMs
    );
  }

  private waitForCondition(
    audio: HTMLAudioElement,
    events: string[],
    condition: () => boolean,
    operationId: number,
    round: ArenaAudioRound,
    timeoutMs: number
  ): Promise<boolean> {
    if (condition() && this.isCurrent(operationId, round.roundKey, round.previewUrl)) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        events.forEach((eventName) => audio.removeEventListener(eventName, handleEvent));
        audio.removeEventListener("error", handleError);
        resolve(
          value &&
            this.isCurrent(operationId, round.roundKey, round.previewUrl)
        );
      };
      const handleEvent = () => {
        if (!this.isCurrent(operationId, round.roundKey, round.previewUrl)) {
          finish(false);
          return;
        }

        if (condition()) finish(true);
      };
      const handleError = () => finish(false);
      const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

      events.forEach((eventName) => audio.addEventListener(eventName, handleEvent));
      audio.addEventListener("error", handleError, { once: true });
      handleEvent();
    });
  }

  private playWithTimeout(audio: HTMLAudioElement) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        if (error) reject(error);
        else resolve();
      };
      const timeoutId = window.setTimeout(
        () => finish(new DOMException("play() did not resolve in time.", "TimeoutError")),
        PLAY_PROMISE_TIMEOUT_MS
      );

      audio.play().then(() => finish()).catch(finish);
    });
  }

  private waitForPlaybackProgress(
    audio: HTMLAudioElement,
    operationId: number,
    round: ArenaAudioRound,
    startTime: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        audio.removeEventListener("timeupdate", handleProgress);
        audio.removeEventListener("playing", handleProgress);
        audio.removeEventListener("error", handleError);
        resolve(value);
      };
      const handleProgress = () => {
        if (!this.isCurrent(operationId, round.roundKey, round.previewUrl)) {
          finish(false);
          return;
        }

        if (
          !audio.paused &&
          audio.currentTime >= startTime + MINIMUM_PROGRESS_SECONDS
        ) {
          finish(true);
        }
      };
      const handleError = () => finish(false);
      const timeoutId = window.setTimeout(
        () => {
          handleProgress();
          if (!settled) finish(false);
        },
        PLAYBACK_PROGRESS_TIMEOUT_MS
      );

      audio.addEventListener("timeupdate", handleProgress);
      audio.addEventListener("playing", handleProgress);
      audio.addEventListener("error", handleError, { once: true });
      handleProgress();
    });
  }

  private getTimelineOffset(request: ArenaAudioStartRequest) {
    if (!Number.isFinite(request.timelineStartsAtMs)) return 0;

    return Math.max(
      0,
      (Date.now() + request.clockOffsetMs - request.timelineStartsAtMs) / 1000
    );
  }

  private getSafeClipStart(
    audio: HTMLAudioElement,
    requestedStart: number,
    clipLength: number
  ) {
    const latestStart = Number.isFinite(audio.duration)
      ? Math.max(0, audio.duration - clipLength)
      : requestedStart;
    return Math.min(Math.max(0, requestedStart), latestStart);
  }

  private isBufferedAt(audio: HTMLAudioElement, time: number) {
    for (let index = 0; index < audio.buffered.length; index += 1) {
      if (
        audio.buffered.start(index) <= time &&
        audio.buffered.end(index) >= time + MINIMUM_BUFFER_SECONDS
      ) {
        return true;
      }
    }

    return false;
  }

  private isCurrent(operationId: number, roundKey: string, previewUrl: string) {
    return Boolean(
      this.audio &&
        this.operationId === operationId &&
        this.activeRound?.roundKey === roundKey &&
        (sameMediaUrl(this.audio.src, previewUrl) ||
          sameMediaUrl(this.audio.currentSrc, previewUrl))
    );
  }

  private scheduleClipStop(
    roundKey: string,
    request: ArenaAudioStartRequest,
    timelineOffsetSeconds: number
  ) {
    const remainingMs = Math.max(
      0,
      (request.clipLengthSeconds - timelineOffsetSeconds) * 1000
    );

    this.clipStopTimer = window.setTimeout(() => {
      this.clipStopTimer = null;
      this.stopRound(roundKey, {
        resetToClipStart: true,
        reason: "shared-clip-ended",
      });
    }, remainingMs);
  }

  private scheduleStallRecovery(eventName: "waiting" | "stalled") {
    const playback = this.activePlayback;
    const audio = this.audio;
    if (!playback || !audio || this.stallTimer !== null) return;

    const observedTime = audio.currentTime;
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = null;
      const currentPlayback = this.activePlayback;
      const currentAudio = this.audio;

      if (
        !currentPlayback ||
        !currentAudio ||
        currentPlayback.roundKey !== playback.roundKey ||
        currentAudio.currentTime > observedTime + MINIMUM_PROGRESS_SECONDS
      ) {
        return;
      }

      if (this.stallRecoveryRoundKey === currentPlayback.roundKey) {
        this.reportPlaybackFailure(
          currentPlayback.roundKey,
          `Audio ${eventName} and did not recover after one retry.`
        );
        return;
      }

      this.stallRecoveryRoundKey = currentPlayback.roundKey;
      this.log("PLAYBACK_RETRY", { reason: eventName });
      void this.startRound(currentPlayback.request).then((result) => {
        if (result.status === "failed" || result.status === "expired") {
          this.reportPlaybackFailure(currentPlayback.roundKey, result.message);
        }
      });
    }, PLAYBACK_STALL_GRACE_MS);
  }

  private reportPlaybackFailure(
    roundKey: string,
    message: string,
    error?: unknown
  ) {
    if (this.activeRound?.roundKey !== roundKey) return;

    const details = error ? getErrorDetails(error) : null;
    this.callbacks.onPlaybackFailure?.({
      roundKey,
      message,
      errorName: details?.name,
      errorMessage: details?.message,
    });
  }

  private pauseCurrentAudio(reason: string) {
    if (!this.audio) return;

    this.log("PAUSE_REQUESTED", { reason });
    this.audio.pause();
    this.callbacks.onPlaybackChange?.(false);
  }

  private stopTimers() {
    if (this.clipStopTimer !== null) {
      window.clearTimeout(this.clipStopTimer);
      this.clipStopTimer = null;
    }

    if (this.stallTimer !== null) {
      window.clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private log(event: DiagnosticEvent, details: Record<string, unknown> = {}) {
    if (!this.debugEnabled) return;

    const audio = this.audio;
    const round = this.activeRound;
    const mediaError = audio?.error;
    const previewHost = (() => {
      try {
        return round?.previewUrl ? new URL(round.previewUrl).hostname : null;
      } catch {
        return null;
      }
    })();
    const snapshot: ArenaAudioDiagnosticSnapshot = {
      event,
      clientId: this.clientId,
      roomId: round?.roomId || null,
      matchGeneration: round?.matchGeneration ?? null,
      userId: round?.userId || null,
      mode: round?.mode || null,
      roundId: round?.roundId || null,
      roundIndex: round?.roundIndex ?? null,
      roundKey: round?.roundKey || null,
      phase: round?.phase || null,
      previewHost,
      sourceReceived: Boolean(round?.previewUrl),
      mediaUnlocked: this.mediaUnlocked,
      readyState: audio?.readyState ?? null,
      networkState: audio?.networkState ?? null,
      paused: audio?.paused ?? null,
      seeking: audio?.seeking ?? null,
      currentTime: audio?.currentTime ?? null,
      duration: audio?.duration ?? null,
      ended: audio?.ended ?? null,
      muted: audio?.muted ?? null,
      volume: audio?.volume ?? null,
      buffered: audio ? this.readTimeRanges(audio.buffered) : [],
      seekable: audio ? this.readTimeRanges(audio.seekable) : [],
      browserTimeMs: Date.now(),
      generation: this.operationId,
      timestamp: new Date().toISOString(),
      serverTimestamp: round?.serverTimestamp || null,
      elapsedMs: this.questionReceivedAt
        ? Math.max(0, Date.now() - this.questionReceivedAt)
        : null,
      visibilityState: document.visibilityState,
      userAgent: navigator.userAgent,
      errorCode: mediaError?.code ?? null,
      errorMessage: mediaError?.message || null,
      ...details,
    };
    console.info(`[STANZER_AUDIO] ${JSON.stringify(snapshot)}`);
    this.callbacks.onDiagnostic?.(snapshot);
  }

  private readTimeRanges(ranges: TimeRanges) {
    return Array.from({ length: ranges.length }, (_, index) => ({
      start: ranges.start(index),
      end: ranges.end(index),
    }));
  }

  private handleLoadStart = () => this.log("LOADSTART");
  private handleLoadedData = () => this.log("LOADEDDATA");
  private handleLoadedMetadata = () => this.log("LOADEDMETADATA");
  private handleCanPlay = () => this.log("CANPLAY");
  private handleCanPlayThrough = () => this.log("CANPLAYTHROUGH");
  private handleSeeked = () => this.log("SEEKED");
  private handlePlaying = () => this.log("PLAY_RESOLVED", { reason: "playing-event" });
  private handleWaiting = () => {
    this.log("MEDIA_WAITING");
    this.scheduleStallRecovery("waiting");
  };
  private handleStalled = () => {
    this.log("MEDIA_STALLED");
    this.scheduleStallRecovery("stalled");
  };
  private handleError = () => {
    const mediaError = this.audio?.error;
    const error = mediaError
      ? new DOMException(`MediaError code ${mediaError.code}: ${mediaError.message}`, "MediaError")
      : new DOMException("Unknown media error.", "MediaError");
    this.log("MEDIA_ERROR", getErrorDetails(error));

    if (this.activePlayback) {
      this.reportPlaybackFailure(this.activePlayback.roundKey, error.message, error);
    }
  };
  private handleTimeUpdate = () => {
    const playback = this.activePlayback;
    const audio = this.audio;
    if (!playback || !audio) return;

    if (audio.currentTime >= playback.clipEndSeconds) {
      this.stopRound(playback.roundKey, {
        resetToClipStart: true,
        reason: "clip-time-reached",
      });
    }
  };
  private handleEnded = () => {
    this.log("MEDIA_ENDED");
    if (this.activePlayback) {
      this.stopRound(this.activePlayback.roundKey, {
        resetToClipStart: true,
        reason: "media-ended",
      });
    }
  };
  private handlePause = () => this.log("PAUSE");
  private handleSuspend = () => this.log("SUSPEND");
  private handleAbort = () => this.log("MEDIA_ABORTED");
  private handleEmptied = () => this.log("MEDIA_EMPTIED");
}
