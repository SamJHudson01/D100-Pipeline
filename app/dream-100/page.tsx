import { createCaller } from "@/lib/trpc/server";
import Link from "next/link";
import type { EnrichmentData } from "@/lib/domain";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const SEQUENCE_STEPS = [
  { step: 1, label: "Personalised Loom", channel: "email", day: 1 },
  { step: 2, label: "LinkedIn connect", channel: "linkedin", day: 2 },
  { step: 3, label: "Comment on post", channel: "linkedin", day: 4 },
  { step: 4, label: "Value-add email", channel: "email", day: 7 },
  { step: 5, label: "LinkedIn DM", channel: "linkedin", day: 10 },
  { step: 6, label: "Quick question email", channel: "email", day: 14 },
  { step: 7, label: "Share customer win", channel: "email", day: 21 },
  { step: 8, label: "Direct ask (15 min)", channel: "email", day: 30 },
];

export default async function Dream100Page() {
  const trpc = await createCaller();
  const companies = await trpc.dream100.list();

  const totalDream100 = companies.length;
  const now = new Date();

  const dueItems = companies.filter((c) => {
    if (!c.sequenceStartedAt || !c.sequenceStep || c.sequencePaused) return false;
    const step = SEQUENCE_STEPS.find((s) => s.step === c.sequenceStep);
    if (!step) return false;
    const started = new Date(c.sequenceStartedAt);
    const dueDate = new Date(started.getTime() + step.day * 86400000);
    return dueDate <= now;
  });

  return (
    <div className={styles.page} data-cy="dream100-page">
      <h1 className="type-heading-lg">
        Dream 100
      </h1>
      <div className={styles.page__header}>
        <div className={styles.page__stats}>
          <span className="type-body-sm">
            <span className="type-mono-md">{totalDream100}</span> active targets
            {dueItems.length > 0 && (
              <>
                {" · "}
                <span className="type-mono-md" style={{ color: "var(--warning-text)" }}>
                  {dueItems.length}
                </span>{" "}
                due today
              </>
            )}
          </span>
        </div>
        <Link href="/dream-100/pipeline" className={`type-body-sm ${styles["page__pipeline-link"]}`} data-cy="dream100-pipeline-link">
          Pipeline Board →
        </Link>
      </div>

      {totalDream100 === 0 ? (
        <div className={styles.empty} data-cy="dream100-empty">
          <p className="type-body-md" style={{ color: "var(--text-secondary)" }}>
            No companies in your Dream 100 yet. Select prospects from{" "}
            <Link href="/triage">Morning Briefing</Link>{" "}
            or add them from the{" "}
            <Link href="/pool">Pool Explorer</Link>.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {companies.map((c) => {
            const step = SEQUENCE_STEPS.find((s) => s.step === c.sequenceStep);
            const daysSinceTouch = c.lastTouchDate
              ? Math.floor((now.getTime() - new Date(c.lastTouchDate).getTime()) / 86400000)
              : null;

            // Parse enrichment data
            const ed = (c.enrichmentData && typeof c.enrichmentData === "object"
              ? c.enrichmentData : {}) as EnrichmentData;
            const ws = ed.webSearch;
            const bluf = ed.bluf;
            const tools = ed.detectedTools || [];
            const funding = ws?.fundingStage || c.fundingStage;
            const amount = ws?.fundingAmount;
            const team = ws?.employeeCount || c.teamSize;
            const yc = ed.structuredSources?.yc;

            const scoreColor = (c.score ?? 0) >= 70 ? "var(--badge-high-text)"
              : (c.score ?? 0) >= 50 ? "var(--badge-medium-text)"
              : "var(--text-tertiary)";

            const isDue = dueItems.some(d => d.domain === c.domain);

            return (
              <Link
                key={c.domain}
                href={`/brief/${encodeURIComponent(c.domain)}`}
                className={styles.card}
                data-cy="dream100-company"
              >
                {/* Identity + enrichment tags */}
                <div className={styles.card__identity}>
                  <div className={styles.card__name} data-cy="dream100-company-name">{c.name}</div>
                  <div className={styles.card__meta}>
                    {funding && (
                      <span className={styles.card__tag}>
                        {funding}{amount ? ` ${amount}` : ""}
                      </span>
                    )}
                    {team && (
                      <span className={styles.card__tag}>{team} emp</span>
                    )}
                    {yc?.batch && (
                      <span className={`${styles.card__tag} ${styles["card__tag--accent"]}`}>
                        YC {yc.batch}
                      </span>
                    )}
                    {tools.slice(0, 3).map((t, i) => (
                      <span key={i} className={styles.card__tag}>{t.name}</span>
                    ))}
                    {!funding && !team && !yc && tools.length === 0 && c.source && (
                      <span className={styles.card__tag}>{c.source}</span>
                    )}
                  </div>
                </div>

                {/* Sequence progress */}
                <div className={styles.card__sequence}>
                  <div className={styles["card__step-label"]}>
                    {step ? step.label : "Not started"}
                    {c.sequencePaused ? " (paused)" : ""}
                  </div>
                  <div className={styles.card__progress}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className={`${styles["card__progress-dot"]} ${
                          i < (c.sequenceStep || 0) ? styles["card__progress-dot--done"] : ""
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Timing */}
                <div className={styles.card__timing}>
                  <div className={`${styles.card__days} ${isDue ? styles["card__days--overdue"] : ""}`}>
                    {daysSinceTouch !== null ? `${daysSinceTouch}d ago` : "No contact yet"}
                  </div>
                </div>

                {/* Score */}
                <div className={styles.card__score} style={{ color: scoreColor }}>
                  {c.score || "—"}
                </div>

                {/* BLUF snippet */}
                {bluf?.text && (
                  <div className={styles.card__bluf}>
                    <span className={styles["card__bluf-category"]}>{bluf.category}</span>
                    {bluf.text.length > 120 ? bluf.text.slice(0, 120) + "..." : bluf.text}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
