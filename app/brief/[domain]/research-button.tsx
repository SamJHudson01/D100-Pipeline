"use client";

import { useFormStatus } from "react-dom";
import type { ResearchRouteState } from "@/lib/research/service";
import styles from "./page.module.css";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.action} disabled={pending}>
      {pending ? "Requesting…" : label}
    </button>
  );
}

export function ResearchActions({
  researchState,
  claudeFormAction,
  openRouterFormAction,
  manualAgentLabel = "Codex",
}: {
  researchState: ResearchRouteState;
  claudeFormAction: () => Promise<void>;
  openRouterFormAction: () => Promise<void>;
  manualAgentLabel?: string;
}) {
  if (researchState.kind === "completed") {
    return (
      <div className={styles["research-actions"]}>
        <div className={styles["research-actions__grid"]}>
          <span data-cy="research-status-completed" className={`${styles.action} ${styles["action--disabled"]}`}>
            Researched
          </span>
        </div>
      </div>
    );
  }

  if (researchState.kind === "active") {
    return (
      <div className={styles["research-actions"]}>
        <div className={styles["research-actions__grid"]}>
          <span
            data-cy="research-status-active"
            className={`${styles.action} ${styles["action--disabled"]} ${styles["action--pulse"]}`}
          >
            Researching…
          </span>
        </div>
      </div>
    );
  }

  // Idle or failed: show simple buttons
  return (
    <div data-cy="research-actions" className={styles["research-actions"]}>
      <div className={styles["research-actions__grid"]}>
        <form data-cy="brief-research-cc" action={claudeFormAction}>
          <SubmitButton label={`Research ${manualAgentLabel}`} />
        </form>
        <form data-cy="brief-research-api" action={openRouterFormAction}>
          <SubmitButton label="Research API" />
        </form>
      </div>
    </div>
  );
}
