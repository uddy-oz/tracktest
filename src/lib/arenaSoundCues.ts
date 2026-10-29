/** Client presentation only. Never schedules or advances authoritative rounds. */
export class ArenaSoundCueLedger {
  private observedMatches = new Set<string>();
  private played = new Set<string>();

  observeMatch(matchKey: string, status: string) {
    if (status === "active") this.observedMatches.add(matchKey);
  }

  take(cueKey: string) {
    if (this.played.has(cueKey)) return false;
    this.played.add(cueKey);
    return true;
  }

  takeResult(matchKey: string) {
    return this.observedMatches.has(matchKey) && this.take(`${matchKey}:result`);
  }
}
