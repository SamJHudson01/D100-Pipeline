import { createCaller } from "@/lib/trpc/server";
import { DEFAULT_REGION } from "@/lib/domain";
import {
  MANUAL_AGENT_LABEL,
  MANUAL_PROSPECT_COMMAND,
} from "@/lib/manual-agent";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const trpc = await createCaller();
  const data = await trpc.settings.overview({ region: DEFAULT_REGION });

  return (
    <div className={styles.page} data-cy="settings-page">
      <h1 className={`type-heading-lg ${styles.page__title}`}>
        Settings
      </h1>

      {/* Pool Health */}
      <section className={styles.section}>
        <h2 className={`type-label ${styles.section__title}`}>
          Pool Health
        </h2>
        <div className={styles["stat-grid"]}>
          <div className={styles["stat-card"]} data-cy="settings-total-companies">
            <div className="type-label">Total</div>
            <div className={`type-mono-md ${styles["stat-card__value"]}`}>
              {data.totalCompanies.toLocaleString()}
            </div>
          </div>
          <div className={styles["stat-card"]}>
            <div className="type-label">UK Pool</div>
            <div className={`type-mono-md ${styles["stat-card__value"]}`}>
              {data.regionCompanies.toLocaleString()}
            </div>
          </div>
        </div>

        {/* State breakdown */}
        <div className={styles.card} data-cy="settings-state-breakdown">
          <div className={`type-label ${styles.card__label}`}>
            State Breakdown
          </div>
          {data.stateBreakdown.map((s) => (
            <div key={s.state} className={styles.breakdown__row}>
              <span className="type-body-sm">{s.state}</span>
              <span className={`type-mono-md ${styles.breakdown__value}`}>
                {s.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Top Sources */}
      <section className={styles.section}>
        <h2 className={`type-label ${styles.section__title}`}>
          Top Sources
        </h2>
        <div className={styles.card} data-cy="settings-source-breakdown">
          {data.sourceBreakdown.map((s) => (
            <div key={s.source} className={styles.breakdown__row}>
              <span className="type-body-sm">{s.source}</span>
              <span className={`type-mono-md ${styles.breakdown__value}`}>
                {s.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Pipeline Runs */}
      <section className={styles.section} data-cy="settings-recent-runs">
        <h2 className={`type-label ${styles.section__title}`}>
          Recent Pipeline Runs
        </h2>
        {data.recentRuns.length === 0 ? (
          <div className={styles.card}>
            <p className={`type-body-sm ${styles.empty__text}`}>
              No pipeline runs yet. Run{" "}
              <code className={styles.empty__code}>{MANUAL_PROSPECT_COMMAND}</code>{" "}
              in {MANUAL_AGENT_LABEL}.
            </p>
          </div>
        ) : (
          <div className={styles.card}>
            {data.recentRuns.map((run) => (
              <div key={run.runId} className={styles.run__row}>
                <span className="type-body-sm">
                  {run.startedAt.toISOString().slice(0, 16).replace("T", " ")} — {run.runType}
                </span>
                <span className={`type-mono-md ${styles.breakdown__value}`}>
                  {run.status} · {run.companiesProcessed} processed
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Configuration Reference */}
      <section>
        <h2 className={`type-label ${styles.section__title}`}>
          Configuration
        </h2>
        <div className={styles.card}>
          <p className={`type-body-sm ${styles.config__text}`}>
            ICP criteria, scoring weights, and sequence templates are configured via
            reference files in the {MANUAL_AGENT_LABEL} skill:
          </p>
          <ul className={styles.config__list}>
            <li className={`type-body-sm ${styles.config__item}`}>
              <code className={styles.config__code}>references/icp-criteria.md</code>{" "}
              — Hard disqualifiers and target profile
            </li>
            <li className={`type-body-sm ${styles.config__item}`}>
              <code className={styles.config__code}>references/scoring-rubric.md</code>{" "}
              — Per-criterion scoring weights
            </li>
            <li className={`type-body-sm ${styles.config__item}`}>
              <code className={styles.config__code}>references/sources.md</code>{" "}
              — Data source configuration
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
