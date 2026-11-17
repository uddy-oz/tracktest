import assert from "node:assert/strict";
import test from "node:test";
import { chooseSoloClipOffset, getSoloReserveTrack, startSoloAudio } from "../src/lib/soloAudio.ts";

test("recovery only selects unused playable tracks and caps substitutions", () => {
  const original = { id: "1", name: "Original", previewUrl: "/original" };
  const alias = { id: "2", name: " original ", previewUrl: "/alias" };
  const scheduled = { id: "3", name: "Next", previewUrl: "/next" };
  const retired = { id: "4", name: "Failed", previewUrl: "/failed" };
  const reserve = { id: "5", name: "Reserve", previewUrl: "/reserve" };
  const missing = { id: "6", name: "Missing", previewUrl: "" };
  const pool = [original, alias, scheduled, retired, missing, reserve];
  assert.equal(getSoloReserveTrack(pool, [original, scheduled], [retired]), reserve);
  assert.equal(getSoloReserveTrack(pool, [scheduled], [original, retired]), undefined);
  assert.equal(getSoloReserveTrack([missing], [], []), undefined);
});

class MediaFixture extends EventTarget {
  paused = true;
  seeking = false;
  currentTime = 8;
  readyState = 1;
  plays = 0;
  reject?: string;
  play() {
    this.plays++;
    if (this.reject) return Promise.reject(new DOMException("Test rejection", this.reject));
    this.paused = false;
    return Promise.resolve();
  }
  element() {
    return this as unknown as HTMLAudioElement;
  }
}

test("preload offset stays inside the playable clip window", () => {
  assert.equal(chooseSoloClipOffset(30, 0), 6);
  assert.equal(chooseSoloClipOffset(30, 1), 22);
  assert.equal(chooseSoloClipOffset(7, 1), 2);
  assert.equal(chooseSoloClipOffset(NaN), 0);
});

test("play promise and buffering alone do not open the clock", async () => {
  const audio = new MediaFixture();
  const result = startSoloAudio(audio.element(), new AbortController().signal, 1000);
  let settled = false;
  void result.then(() => { settled = true; });
  assert.equal(audio.plays, 1);
  audio.currentTime = 8.25;
  audio.seeking = true;
  audio.readyState = 3;
  await new Promise(resolve => setTimeout(resolve, 55));
  assert.equal(settled, false);
  audio.seeking = false;
  await new Promise(resolve => setTimeout(resolve, 55));
  assert.equal(settled, false);
  audio.currentTime += 0.1;
  assert.equal(await result, "playing");
});

test("autoplay refusal, preview errors, timeout and cancellation are distinct", async () => {
  const audio = new MediaFixture();
  const active = new AbortController();
  audio.reject = "NotAllowedError";
  assert.equal(await startSoloAudio(audio.element(), active.signal), "blocked");
  audio.reject = undefined;
  const bad = startSoloAudio(audio.element(), active.signal);
  audio.dispatchEvent(new Event("error"));
  assert.equal(await bad, "failed");
  assert.equal(await startSoloAudio(audio.element(), active.signal, 30), "timeout");
  const cancelled = startSoloAudio(audio.element(), active.signal);
  active.abort();
  assert.equal(await cancelled, "aborted");
});
