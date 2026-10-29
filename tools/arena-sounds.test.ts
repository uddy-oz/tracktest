import assert from "node:assert/strict";
import {test} from "node:test";
import {ArenaSoundCueLedger} from "../src/lib/arenaSoundCues.ts";

test("repeated events, reconnects, old results and rematches do not duplicate cues", () => {
  const ledger = new ArenaSoundCueLedger();
  ledger.observeMatch("room:1", "finished");
  assert.equal(ledger.takeResult("room:1"), false, "old results stay silent");
  ledger.observeMatch("room:2", "active");
  for (const cue of ["3", "2", "1", "go"]) {
    assert.equal(ledger.take(`room:2:question:1:${cue}`), true);
    assert.equal(ledger.take(`room:2:question:1:${cue}`), false);
  }
  ledger.observeMatch("room:2", "active");
  assert.equal(ledger.takeResult("room:2"), true);
  assert.equal(ledger.takeResult("room:2"), false);
  ledger.observeMatch("room:3", "active");
  assert.equal(ledger.takeResult("room:3"), true, "rematch has its own celebration");
});

test("synthesized game cues unlock, respect mute, and report resume rejection", async () => {
  let tones = 0;
  let rejectResume = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  class FakeContext {
    state = "suspended";
    currentTime = 0;
    destination = {};
    resume() { if (rejectResume) return Promise.reject(new Error("Blocked")); this.state = "running"; return Promise.resolve(); }
    createOscillator() { return {type: "sine", frequency: {setValueAtTime() {}}, connect() {}, start() {tones++;}, stop() {}}; }
    createGain() {return {gain: {setValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}};}
  }
  Object.defineProperty(globalThis, "AudioContext", {configurable: true, value: FakeContext});
  try {
    const {sounds} = await import("../src/lib/sounds.ts");
    sounds.prime();
    sounds.tick(); sounds.go(); sounds.victory(); sounds.defeat(); sounds.draw();
    assert.ok(tones > 10);
    sounds.toggleMuted();
    const before = tones;
    sounds.tick(); sounds.go(); sounds.victory(); sounds.defeat(); sounds.draw();
    assert.equal(tones, before);
    sounds.toggleMuted();
    rejectResume = true;
    sounds.prime();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(sounds.getDiagnostics().lastContextError, "Error");
  } finally {
    if (previous) Object.defineProperty(globalThis, "AudioContext", previous);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});
