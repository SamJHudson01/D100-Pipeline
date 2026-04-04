import type { ResearchExecutor } from "../domain";
import type { ResearchRouteState } from "./service";
import {
  MANUAL_AGENT_LABEL,
  MANUAL_RESEARCH_COMMAND,
} from "../manual-agent";

const EXECUTOR_LABELS: Record<ResearchExecutor, string> = {
  claude: MANUAL_AGENT_LABEL,
  openrouter: "OpenRouter",
};

export type BriefResearchActionView = {
  executor: ResearchExecutor;
  title: string;
  label: string;
  disabled: boolean;
  pulsing: boolean;
  hint: string | null;
  error: string | null;
};

export type BriefResearchActionsView = {
  actions: [BriefResearchActionView, BriefResearchActionView];
  notice: string | null;
};

export type ResearchEmptyStateView = {
  title: string;
  message: string;
};

function withStageDetail(baseMessage: string, progressMessage: string | null): string {
  if (!progressMessage) {
    return baseMessage;
  }

  return `${baseMessage} Current stage: ${progressMessage}.`;
}

function getIdleAction(executor: ResearchExecutor): BriefResearchActionView {
  return {
    executor,
    title: EXECUTOR_LABELS[executor],
    label: executor === "claude" ? "Request Research" : "Run with OpenRouter",
    disabled: false,
    pulsing: false,
    hint:
      executor === "claude"
        ? `Queues the ${MANUAL_AGENT_LABEL} research workflow`
        : "Queues the OpenRouter worker for automatic research",
    error: null,
  };
}

export function getExecutorLabel(executor: ResearchExecutor): string {
  return EXECUTOR_LABELS[executor];
}

export function buildBriefResearchActionsView(
  researchState: ResearchRouteState,
): BriefResearchActionsView {
  const claude = getIdleAction("claude");
  const openrouter = getIdleAction("openrouter");

  if (researchState.kind === "completed") {
    const completedVia = researchState.completedExecutor
      ? `Completed via ${getExecutorLabel(researchState.completedExecutor)}`
      : "Research already stored";

    return {
      actions: [
        {
          ...claude,
          label: "Research Complete",
          disabled: true,
          hint: completedVia,
        },
        {
          ...openrouter,
          label: "Research Complete",
          disabled: true,
          hint: completedVia,
        },
      ],
      notice: null,
    };
  }

  if (researchState.kind === "active") {
    const activeExecutor = researchState.activeJob.executor;
    const activeLabel =
      researchState.activeJob.status === "pending"
        ? activeExecutor === "claude"
          ? "Research Queued"
          : "Queued in OpenRouter"
        : "Researching…";

    const activeHint =
      researchState.activeJob.status === "pending"
        ? activeExecutor === "claude"
          ? `Open ${MANUAL_AGENT_LABEL} and run ${MANUAL_RESEARCH_COMMAND} to start`
          : "OpenRouter worker will claim this job"
        : researchState.activeJob.progressMessage ??
          (activeExecutor === "claude"
            ? `${MANUAL_AGENT_LABEL} is processing this company`
            : "OpenRouter worker is processing this company");

    const blockedHint = `A ${getExecutorLabel(activeExecutor)} job is already ${
      researchState.activeJob.status === "pending" ? "queued" : "running"
    } for this company`;

    return {
      actions: [
        {
          ...claude,
          label: activeExecutor === "claude" ? activeLabel : "Already Covered",
          disabled: true,
          pulsing:
            activeExecutor === "claude" &&
            researchState.activeJob.status === "in_progress",
          hint: activeExecutor === "claude" ? activeHint : blockedHint,
        },
        {
          ...openrouter,
          label:
            activeExecutor === "openrouter" ? activeLabel : "Already Covered",
          disabled: true,
          pulsing:
            activeExecutor === "openrouter" &&
            researchState.activeJob.status === "in_progress",
          hint: activeExecutor === "openrouter" ? activeHint : blockedHint,
        },
      ],
      notice: null,
    };
  }

  if (researchState.kind === "failed") {
    const failedExecutor = researchState.latestJob.executor;
    const failedLabel = getExecutorLabel(failedExecutor);

    return {
      actions: [
        {
          ...claude,
          label:
            failedExecutor === "claude" ? "Retry Research" : claude.label,
          error:
            failedExecutor === "claude"
              ? researchState.latestJob.error ??
                `Previous ${MANUAL_AGENT_LABEL} run failed`
              : null,
        },
        {
          ...openrouter,
          label:
            failedExecutor === "openrouter"
              ? "Retry with OpenRouter"
              : openrouter.label,
          error:
            failedExecutor === "openrouter"
              ? researchState.latestJob.error ?? "Previous OpenRouter run failed"
              : null,
        },
      ],
      notice: `Last run failed via ${failedLabel}. Retry it or switch executors from the brief page.`,
    };
  }

  return {
    actions: [claude, openrouter],
    notice: null,
  };
}

export function buildResearchEmptyStateView(
  researchState: ResearchRouteState,
  companyName: string,
): ResearchEmptyStateView {
  if (researchState.kind === "active") {
    if (researchState.activeJob.executor === "claude") {
      return {
        title:
          researchState.activeJob.status === "pending"
            ? `Research queued in ${MANUAL_AGENT_LABEL}`
            : `${MANUAL_AGENT_LABEL} research in progress`,
        message:
          researchState.activeJob.status === "pending"
            ? `Research for ${companyName} has been queued in ${MANUAL_AGENT_LABEL}. Open ${MANUAL_AGENT_LABEL} and run ${MANUAL_RESEARCH_COMMAND} to start it.`
            : withStageDetail(
                `${MANUAL_AGENT_LABEL} is currently processing research for ${companyName}. Check back shortly or return to the brief page.`,
                researchState.activeJob.progressMessage,
              ),
      };
    }

    return {
      title:
        researchState.activeJob.status === "pending"
          ? "OpenRouter research queued"
          : "OpenRouter research in progress",
      message:
        researchState.activeJob.status === "pending"
          ? `Research for ${companyName} has been queued for the OpenRouter worker. It will start automatically when the worker is running.`
          : withStageDetail(
              `The OpenRouter worker is currently processing research for ${companyName}. Check back shortly or return to the brief page.`,
              researchState.activeJob.progressMessage,
            ),
    };
  }

  if (researchState.kind === "failed") {
    const executorLabel = getExecutorLabel(researchState.latestJob.executor);
    return {
      title: `${executorLabel} research failed`,
      message: `${
        researchState.latestJob.error || "The last research attempt failed."
      } Return to the brief page to retry with ${executorLabel} or switch executors.`,
    };
  }

  return {
    title: "No research yet",
    message: `Open the brief page for ${companyName} to queue research via ${MANUAL_AGENT_LABEL} or OpenRouter.`,
  };
}
