import styles from "./badges.module.css";

type ScoreTier = "qualify" | "nurture" | "skip" | "disqualify";
type Trend = "up" | "down" | "flat";

function getScoreTier(score: number): ScoreTier {
  if (score >= 70) return "qualify";
  if (score >= 50) return "nurture";
  if (score > 0) return "skip";
  return "disqualify";
}

const TREND_ARROWS: Record<Trend, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

export function ScoreBadge({
  score,
  trend,
}: {
  score: number;
  trend?: Trend;
}) {
  const tier = getScoreTier(score);
  return (
    <span className={`${styles["score-badge"]} ${styles[`score-badge--${tier}`]}`}>
      {score}
      {trend && (
        <span className={styles["score-badge__trend"]}>
          {TREND_ARROWS[trend]}
        </span>
      )}
    </span>
  );
}

const STATE_LABELS: Record<string, string> = {
  discovered: "New",
  pre_filtered: "Awaiting enrichment",
  pre_filter_rejected: "Not a fit",
  enriched: "Enriched",
  qualified: "Qualified",
  nurture: "Nurture",
  skip: "Skip",
  disqualified: "Not a fit",
  contacted: "Contacted",
  stale: "Stale",
  dead: "Dead",
};

export function StateChip({ state }: { state: string }) {
  const modifier = styles[`state-chip--${state}`] || "";
  const label = STATE_LABELS[state] || state;
  return (
    <span className={`${styles["state-chip"]} ${modifier}`}>
      {label}
    </span>
  );
}

export function ResponseBadge({
  status,
}: {
  status: "no-reply" | "opened" | "replied" | "meeting";
}) {
  return (
    <span
      className={`${styles["response-badge"]} ${styles[`response-badge--${status}`]}`}
    >
      {status.replace("-", " ")}
    </span>
  );
}

export function ConfidenceBadge({
  level,
  criteria,
}: {
  level: "high" | "medium" | "low" | "unknown";
  criteria?: string;
}) {
  return (
    <span
      className={`${styles["confidence-badge"]} ${styles[`confidence-badge--${level}`]}`}
    >
      {criteria ? `${criteria}/7` : level}
    </span>
  );
}

export function ResearchBadge({ hasResearch }: { hasResearch: boolean }) {
  if (!hasResearch) return null;
  return (
    <span className={styles["research-badge"]} data-cy="research-badge">
      Researched
    </span>
  );
}
