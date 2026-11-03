import { CATEGORY_LABEL, type VisitStats } from "@/lib/types";
import { date } from "@/lib/format";
import { Badge, Muted } from "./ui";

/** New / Regular / Occasional label. */
export function CategoryBadge({ visits }: { visits?: VisitStats }) {
  if (!visits) return null;
  return <Badge status={visits.category} text={CATEGORY_LABEL[visits.category]} />;
}

/** "5 visits · last 02 Nov 2026 · next 05 Nov" — one line, same everywhere. */
export function visitSummary(v?: VisitStats) {
  if (!v) return "";
  const parts = [v.completedVisits === 0 ? "No visits yet" : `${v.completedVisits} visit${v.completedVisits === 1 ? "" : "s"}`];
  if (v.lastVisitAt) parts.push(`last ${date(v.lastVisitAt)}`);
  if (v.nextVisitAt) parts.push(`next ${date(v.nextVisitAt)}`);
  return parts.join(" · ");
}

export function VisitLine({ visits }: { visits?: VisitStats }) {
  const text = visitSummary(visits);
  return text ? (
    <Muted style={{ fontSize: 12 }} numberOfLines={1}>
      {text}
    </Muted>
  ) : null;
}
