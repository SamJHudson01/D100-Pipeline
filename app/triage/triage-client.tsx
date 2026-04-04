"use client";

import { useReducer, useEffect, useRef, useCallback } from "react";
import { ScoreBadge } from "@/components/badges";
import { trpcClient } from "@/lib/trpc/client";
import styles from "./triage-client.module.css";

// --- Types ---

export type Prospect = {
  domain: string;
  name: string;
  url: string | null;
  description: string | null;
  score: number;
  source: string;
  funding_stage: string | null;
  team_size: number | null;
};

type Decision = "select" | "skip" | "snooze" | "dismiss";

type ToastStatus = "hidden" | "visible" | "expired";

type TriageState = {
  currentIndex: number;
  decisions: Map<number, Decision>;
  toastStatus: ToastStatus;
  lastAction: { index: number; decision: Decision } | null;
};

type TriageAction =
  | { type: "SELECT" }
  | { type: "SKIP" }
  | { type: "SNOOZE" }
  | { type: "DISMISS" }
  | { type: "UNDO" }
  | { type: "TOAST_EXPIRED" };

function triageReducer(state: TriageState, action: TriageAction): TriageState {
  const { currentIndex, decisions } = state;

  switch (action.type) {
    case "SELECT":
    case "SKIP":
    case "SNOOZE":
    case "DISMISS": {
      const decision = action.type.toLowerCase() as Decision;
      const newDecisions = new Map(decisions);
      newDecisions.set(currentIndex, decision);
      return {
        ...state,
        decisions: newDecisions,
        currentIndex: currentIndex + 1,
        toastStatus: "visible",
        lastAction: { index: currentIndex, decision },
      };
    }
    case "UNDO": {
      if (!state.lastAction) return state;
      const { index } = state.lastAction;
      const newDecisions = new Map(decisions);
      newDecisions.delete(index);
      return {
        ...state,
        decisions: newDecisions,
        currentIndex: index,
        toastStatus: "hidden",
        lastAction: null,
      };
    }
    case "TOAST_EXPIRED":
      return { ...state, toastStatus: "hidden" };
    default:
      return state;
  }
}

// --- Component ---

export function TriageClient({
  prospects,
  manualAgentLabel = "Codex",
  prospectCommand = "/prospect pipeline",
}: {
  prospects: Prospect[];
  manualAgentLabel?: string;
  prospectCommand?: string;
}) {
  const [state, dispatch] = useReducer(triageReducer, {
    currentIndex: 0,
    decisions: new Map(),
    toastStatus: "hidden",
    lastAction: null,
  });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived state
  const reviewedCount = state.decisions.size;
  const selectedCount = Array.from(state.decisions.values()).filter(
    (d) => d === "select"
  ).length;
  const isComplete = state.currentIndex >= prospects.length;
  const currentProspect = prospects[state.currentIndex];

  // Persist decisions to database via tRPC mutation
  useEffect(() => {
    if (state.lastAction && state.toastStatus === "visible") {
      const { index, decision } = state.lastAction;
      const prospect = prospects[index];
      if (prospect) {
        trpcClient.triage.decide.mutate({
          domain: prospect.domain,
          decision,
        });
      }
    }
  }, [state.lastAction, state.toastStatus, prospects]);

  // Toast auto-dismiss
  useEffect(() => {
    if (state.toastStatus === "visible") {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        dispatch({ type: "TOAST_EXPIRED" });
      }, 5000);
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [state.toastStatus, state.lastAction]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isComplete) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case "s":
          e.preventDefault();
          dispatch({ type: "SELECT" });
          break;
        case "x":
          e.preventDefault();
          dispatch({ type: "SKIP" });
          break;
        case "h":
          e.preventDefault();
          dispatch({ type: "SNOOZE" });
          break;
        case "d":
          e.preventDefault();
          dispatch({ type: "DISMISS" });
          break;
        case "z":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            dispatch({ type: "UNDO" });
          }
          break;
      }
    },
    [isComplete]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Empty state
  if (prospects.length === 0) {
    return (
      <div className={styles.empty} data-cy="triage-empty">
        <p className="type-body-md" style={{ color: "var(--text-secondary)" }}>
          No scored prospects available. Run{" "}
          <code className={styles.empty__command}>{prospectCommand}</code> in{" "}
          {manualAgentLabel} to generate today&apos;s briefing.
        </p>
      </div>
    );
  }

  // Completion state
  if (isComplete) {
    return (
      <div className={styles.completion} data-cy="triage-complete">
        <div className={styles.completion__icon}>✓</div>
        <p className="type-heading-sm">
          {reviewedCount} of {prospects.length} reviewed
        </p>
        <p className={`type-body-sm ${styles.completion__text}`}>
          {selectedCount} selected for today
        </p>
        {selectedCount === 0 && (
          <p className={`type-body-sm ${styles.completion__warning}`}>
            No prospects selected. Run the pipeline with more candidates or
            review your ICP criteria.
          </p>
        )}
        <div className={styles.completion__actions}>
          {selectedCount > 0 && (
            <a
              href={`/brief/${prospects.find((_, i) => state.decisions.get(i) === "select")?.domain || ""}`}
              className={`${styles.completion__link} ${styles["completion__link--primary"]}`}
            >
              View selected briefs →
            </a>
          )}
          <a href="/dream-100" className={styles.completion__link}>
            Dream 100
          </a>
          <a href="/pool" className={styles.completion__link}>
            Pool Explorer
          </a>
        </div>
      </div>
    );
  }

  // Decision labels for toast
  const DECISION_LABELS: Record<Decision, string> = {
    select: "selected",
    skip: "skipped",
    snooze: "snoozed",
    dismiss: "dismissed",
  };

  return (
    <>
      {/* Progress */}
      <div className={styles.progress}>
        <div className={styles.progress__bar}>
          {prospects.map((_, i) => {
            const decision = state.decisions.get(i);
            let modifier = "";
            if (decision === "select") modifier = styles["progress__segment--selected"];
            else if (decision) modifier = styles["progress__segment--skipped"];
            else if (i === state.currentIndex) modifier = styles["progress__segment--active"];
            return <div key={i} className={`${styles.progress__segment} ${modifier}`} />;
          })}
        </div>
        <span className={`type-body-sm ${styles.progress__text}`}>
          {reviewedCount} of {prospects.length} reviewed · {selectedCount} selected
        </span>
      </div>

      {/* Card */}
      <div className={styles["card-container"]}>
        {prospects.map((prospect, i) => {
          let cardClass = styles.card;
          if (i < state.currentIndex) cardClass += ` ${styles["card--exiting"]}`;
          else if (i > state.currentIndex) cardClass += ` ${styles["card--hidden"]}`;

          return (
            <div key={prospect.domain} className={cardClass} data-cy="triage-card">
              <div className={styles.card__identity}>
                <div className={styles.card__name} data-cy="triage-company-name">{prospect.name}</div>
                <div className={styles.card__descriptor}>
                  {[
                    prospect.funding_stage,
                    prospect.team_size ? `${prospect.team_size} employees` : null,
                    prospect.source,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>

              <div className={styles.card__signals}>
                {prospect.description && (
                  <>
                    <div className={styles["card__signal-label"]}>About</div>
                    <div className={styles["card__signal-text"]}>
                      {prospect.description.length > 120
                        ? prospect.description.slice(0, 120) + "…"
                        : prospect.description}
                    </div>
                  </>
                )}
              </div>

              <div className={styles.card__assessment}>
                <ScoreBadge score={prospect.score} />
                {prospect.url && (
                  <a
                    href={prospect.url.startsWith("http") ? prospect.url : `https://${prospect.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`type-body-sm ${styles["card__visit-link"]}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Visit site ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className={styles.actions}>
        <button
          className={`${styles.actions__key} ${styles["actions__key--select"]}`}
          onClick={() => dispatch({ type: "SELECT" })}
          data-cy="triage-action-select"
        >
          <span className={styles.actions__kbd}>S</span> Select
        </button>
        <button
          className={styles.actions__key}
          onClick={() => dispatch({ type: "SKIP" })}
          data-cy="triage-action-skip"
        >
          <span className={styles.actions__kbd}>X</span> Skip
        </button>
        <button
          className={styles.actions__key}
          onClick={() => dispatch({ type: "SNOOZE" })}
          data-cy="triage-action-snooze"
        >
          <span className={styles.actions__kbd}>H</span> Snooze
        </button>
        <button
          className={`${styles.actions__key} ${styles["actions__key--dismiss"]}`}
          onClick={() => dispatch({ type: "DISMISS" })}
          data-cy="triage-action-dismiss"
        >
          <span className={styles.actions__kbd}>D</span> Dismiss
        </button>
      </div>

      {/* Undo toast */}
      {state.toastStatus === "visible" && state.lastAction && (
        <div className={styles.toast} data-cy="triage-undo-toast">
          <span>
            {prospects[state.lastAction.index]?.name}{" "}
            {DECISION_LABELS[state.lastAction.decision]}
          </span>
          <button
            className={styles.toast__undo}
            onClick={() => dispatch({ type: "UNDO" })}
            data-cy="triage-undo-button"
          >
            Undo ⌘Z
          </button>
        </div>
      )}
    </>
  );
}
