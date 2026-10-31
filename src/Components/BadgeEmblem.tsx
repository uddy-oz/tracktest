import { BadgeCheck, Diamond, Zap, Disc3, Crown, Library, CalendarDays, Flame, Trophy, ShieldCheck, Sparkles, Gem, Swords, Users, PartyPopper, TrendingUp, Crosshair, Headphones, Layers, KeyRound } from "lucide-react";
import type { ArenaBadge } from "../lib/badges";
const icons = { checkRing: BadgeCheck, diamond: Diamond, bolt: Zap, record: Disc3, crown: Crown, discs: Library, calendar: CalendarDays, flame: Flame, trophy: Trophy, shield: ShieldCheck, star: Sparkles, clutch: Gem, swords: Swords, users: Users, party: PartyPopper, comeback: TrendingUp, target: Crosshair, headphones: Headphones, stack: Layers, key: KeyRound };
export default function BadgeEmblem({ badge }: { badge: ArenaBadge }) {
  const Icon = icons[badge.icon];
  return <div className={`badge-icon badge-icon-${badge.icon}`} aria-hidden="true"><Icon size={36} strokeWidth={1.6} /></div>;
}
