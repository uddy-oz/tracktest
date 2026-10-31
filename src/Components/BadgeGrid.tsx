import { useState } from "react";
import { ArrowUpRight, Crosshair, Search, X, Trophy } from "lucide-react";
import BadgeCard from "./BadgeCard";
import BadgeEmblem from "./BadgeEmblem";
import type { ArenaBadge } from "../lib/badges";
import { BADGE_CATEGORIES, BADGE_TIERS, badgeProgress, badgeProgressLabel, badgeStateLabel, badgeUnavailableReason, isBadgeUnavailable, readTrackedBadge, selectVaultBadges, writeTrackedBadge, type VaultSort, type VaultStatus } from "../lib/badgeVault";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import { achievableCollection } from "../lib/badgeVault";
import { achievementDateLabel } from "../lib/achievementRecords";

type BadgeGridProps = { badges: ArenaBadge[]; recentBadge?: ArenaBadge; ownerId?: string };
export default function BadgeGrid({ badges, recentBadge, ownerId }: BadgeGridProps) {
  const [category, setCategory] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState<VaultStatus>("all");
  const [sort, setSort] = useState<VaultSort>("collection");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ArenaBadge | null>(null);
  const [tracked, setTracked] = useState(() => ({ ownerId, id: readTrackedBadge(ownerId, badges) }));
  const [message, setMessage] = useState("");
  const dialogRef = useAccessibleDialog<HTMLElement>({ open: Boolean(selected), onClose: () => setSelected(null) });
  const unlocked = badges.filter(b => b.unlocked).length;
  const collection = achievableCollection(badges);
  const completion = collection.completion;
  const trackId = tracked.ownerId === ownerId ? tracked.id : readTrackedBadge(ownerId, badges);
  const goal = ownerId ? badges.find(b => b.id === trackId) : undefined;
  const nextTarget = selectVaultBadges(badges, { status: "progress", sort: "closest" })[0];
  const focusBadge = goal || nextTarget;
  const visible = selectVaultBadges(badges, { category, tier, status, sort, search });
  function track(id: string | null) {
    const saved = writeTrackedBadge(ownerId, id);
    setTracked({ ownerId, id });
    setMessage(saved ? "Tracking preference saved on this device." : "Storage unavailable. Tracking lasts until this page closes.");
  }
  return <section className="badge-section badge-vault" aria-label="Badge Vault">
    <header className="vault-overview">
      <div><p className="eyebrow">Your music. Your legacy.</p><h2>Badge Vault<span>02</span></h2><p>Every run tells a story. Build your collection.</p></div>
      <div className="vault-completion" role="img" aria-label={`${completion}% of achievements unlocked`} style={{ background: `conic-gradient(var(--brand-primary) ${completion}%, var(--separator) 0)` }}><div><strong>{completion}%</strong><span>COLLECTED</span></div></div>
      <div className="vault-count"><strong>{collection.unlocked}<span> / {collection.total}</span></strong><p>achievable badges unlocked</p><small>{unlocked} owned / {badges.length} catalogued. Coming Soon excluded.</small></div>
    </header>
    <div className="vault-tier-strip">{BADGE_TIERS.map(t => { const tierCollection = achievableCollection(badges.filter(b => b.tier === t)); return <div key={t} className={`badge-tier-${t.toLowerCase()}`}><span className="vault-tier-dot" /><span>{t}</span><strong>{tierCollection.unlocked}<small> / {tierCollection.total}</small></strong></div>; })}</div>
    {focusBadge && <div className={`vault-focus badge-tier-${focusBadge.tier.toLowerCase()} ${goal ? "vault-tracked" : "vault-next"}`}>
      <BadgeEmblem badge={focusBadge} />
      <div className="vault-focus-copy"><small>{goal ? goal.unlocked ? "GOAL COMPLETED" : "ON YOUR RADAR" : "CLOSEST TO UNLOCK"}</small><strong>{focusBadge.title}</strong><span>{focusBadge.description}</span></div>
      <div className="vault-focus-progress"><span>{badgeProgressLabel(focusBadge)}</span><progress max={100} value={badgeProgress(focusBadge)} aria-label={`${focusBadge.title} progress`} /></div>
      <button className="vault-focus-open" onClick={() => setSelected(focusBadge)} aria-label={`View ${focusBadge.title} details`} title="View achievement details"><ArrowUpRight size={20} /></button>
      {goal && <button className="vault-focus-dismiss" onClick={() => track(null)} aria-label="Stop tracking achievement" title="Stop tracking"><X size={18} /></button>}
    </div>}
    {recentBadge && <p className="vault-recent"><Trophy size={16} aria-hidden="true" /> Collection highlight: <strong>{recentBadge.title}</strong></p>}
    <div className="vault-toolbar">
      <label className="vault-search"><Search size={18} aria-hidden="true" /><input aria-label="Search achievements" placeholder="Find an achievement" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Category<select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{BADGE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Tier<select aria-label="Tier" value={tier} onChange={e => setTier(e.target.value)}><option value="">All tiers</option>{BADGE_TIERS.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Status<select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as VaultStatus)}><option value="all">All achievements</option><option value="unlocked">Unlocked</option><option value="locked">Locked</option><option value="progress">In progress</option><option value="complete">Completed</option><option value="unavailable">Unavailable / coming soon</option></select></label>
      <label>Sort<select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value as VaultSort)}><option value="collection">Collection highlights</option><option value="closest">Closest to completion</option><option value="newest">Newest verified unlocks</option><option value="tier">Highest tier</option><option value="alphabetical">A to Z</option></select></label>
    </div>
    {sort === "newest" && <p className="vault-note">Server-awarded dates first. Legacy achievements with unknown dates follow alphabetically.</p>}
    <p className="vault-result-count" role="status">{visible.length} of {badges.length} achievements</p>
    {visible.length ? <div className="badge-grid vault-gallery">{visible.map(b => <BadgeCard key={b.id} badge={b} onSelect={setSelected} highlight={goal?.id === b.id ? "tracked" : recentBadge?.id === b.id && b.unlocked ? "collection" : undefined} />)}</div> : <div className="vault-empty"><Search aria-hidden="true" /><h3>No matching achievements</h3><p>Try another category, tier, or search.</p><button onClick={() => { setCategory(""); setTier(""); setStatus("all"); setSearch(""); }}>Reset filters</button></div>}
    {message && <p role="status" className="vault-note">{message}</p>}
    {selected && <div className="badge-detail-overlay" onClick={() => setSelected(null)}><section ref={dialogRef} className={`badge-detail-modal vault-detail badge-tier-${selected.tier.toLowerCase()}`} role="dialog" aria-modal="true" aria-labelledby="vault-detail-title" aria-describedby="vault-detail-description" onClick={e => e.stopPropagation()}>
      <button className="badge-detail-close" aria-label="Close achievement details" onClick={() => setSelected(null)}><X size={20} /></button>
      <BadgeEmblem badge={selected} /><p className="eyebrow">{selected.category} / {selected.tier}</p><h2 id="vault-detail-title">{selected.title}</h2><span className="vault-detail-state">{badgeStateLabel(selected)}</span><h3>Requirements</h3><p id="vault-detail-description">{selected.description}</p>
      <progress max={100} value={badgeProgress(selected)} aria-label="Achievement progress" /><p>{badgeProgressLabel(selected)}</p>
      {isBadgeUnavailable(selected) && <p>{badgeUnavailableReason(selected)}</p>}
      <p className="vault-note">{selected.unlocked ? achievementDateLabel(selected) : "Progress is calculated from your existing stats. All requirements must be met."}</p>
      {ownerId && !selected.unlocked && !isBadgeUnavailable(selected) && <button onClick={() => track(trackId === selected.id ? null : selected.id)}><Crosshair size={18} aria-hidden="true" />{trackId === selected.id ? "Stop tracking" : "Track Achievement"}</button>}
    </section></div>}
  </section>;
}
