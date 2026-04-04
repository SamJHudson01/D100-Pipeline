import { describe, it, expect } from "vitest";
import {
  getExecutorLabel,
  buildBriefResearchActionsView,
  buildResearchEmptyStateView,
} from "@/lib/research/presentation";
import {
  MANUAL_AGENT_LABEL,
  MANUAL_RESEARCH_COMMAND,
} from "@/lib/manual-agent";
import type { ResearchRouteState, ResearchJobProjection } from "@/lib/research/service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(
  overrides: Partial<ResearchJobProjection> = {},
): ResearchJobProjection {
  return {
    id: "job-1",
    executor: "claude",
    status: "completed",
    progressMessage: null,
    requestedAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:01:00Z"),
    completedAt: new Date("2026-01-01T00:05:00Z"),
    error: null,
    ...overrides,
  };
}

function completedState(
  completedExecutor: "claude" | "openrouter" | null,
  latestJob: ResearchJobProjection | null = null,
): ResearchRouteState {
  return {
    kind: "completed",
    hasResearchData: true,
    completedExecutor,
    activeJob: null,
    latestJob,
    recoveryAction: null,
  };
}

function activeState(
  executor: "claude" | "openrouter",
  status: "pending" | "in_progress",
  progressMessage: string | null = null,
): ResearchRouteState {
  const job = makeJob({
    executor,
    status,
    progressMessage,
    startedAt: status === "in_progress" ? new Date("2026-01-01T00:01:00Z") : null,
    completedAt: null,
  });
  return {
    kind: "active",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: job as ResearchJobProjection & { status: "pending" | "in_progress" },
    latestJob: job,
    recoveryAction: null,
  };
}

function failedState(
  executor: "claude" | "openrouter",
  error: string | null = "Something went wrong",
): ResearchRouteState {
  const job = makeJob({
    executor,
    status: "failed",
    error,
    completedAt: null,
  });
  return {
    kind: "failed",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: null,
    latestJob: job,
    recoveryAction: { type: "retry", executor },
  };
}

function idleState(): ResearchRouteState {
  return {
    kind: "idle",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: null,
    latestJob: null,
    recoveryAction: { type: "request" },
  };
}

// ---------------------------------------------------------------------------
// getExecutorLabel
// ---------------------------------------------------------------------------

describe("getExecutorLabel", () => {
  it("PR-17: 'claude' returns the configured manual-agent label", () => {
    expect(getExecutorLabel("claude")).toBe(MANUAL_AGENT_LABEL);
  });

  it("PR-18: 'openrouter' returns 'OpenRouter'", () => {
    expect(getExecutorLabel("openrouter")).toBe("OpenRouter");
  });
});

// ---------------------------------------------------------------------------
// buildBriefResearchActionsView
// ---------------------------------------------------------------------------

describe("buildBriefResearchActionsView", () => {
  // ---- completed ----

  it("PR-1: completed with completedExecutor='claude' disables both actions with hint mentioning the manual agent", () => {
    const view = buildBriefResearchActionsView(completedState("claude"));
    const [claude, openrouter] = view.actions;

    expect(claude.label).toBe("Research Complete");
    expect(claude.disabled).toBe(true);
    expect(claude.hint).toBe(`Completed via ${MANUAL_AGENT_LABEL}`);

    expect(openrouter.label).toBe("Research Complete");
    expect(openrouter.disabled).toBe(true);
    expect(openrouter.hint).toBe(`Completed via ${MANUAL_AGENT_LABEL}`);

    expect(view.notice).toBeNull();
  });

  it("PR-1b: completed with completedExecutor='openrouter' disables both with hint mentioning 'OpenRouter'", () => {
    const view = buildBriefResearchActionsView(completedState("openrouter"));

    expect(view.actions[0].hint).toBe("Completed via OpenRouter");
    expect(view.actions[1].hint).toBe("Completed via OpenRouter");
  });

  it("PR-2: completed with completedExecutor=null shows 'Research already stored'", () => {
    const view = buildBriefResearchActionsView(completedState(null));

    expect(view.actions[0].hint).toBe("Research already stored");
    expect(view.actions[1].hint).toBe("Research already stored");
    expect(view.actions[0].disabled).toBe(true);
    expect(view.actions[1].disabled).toBe(true);
  });

  // ---- active ----

  it("PR-3: active with claude pending shows 'Research Queued' for claude, both disabled", () => {
    const view = buildBriefResearchActionsView(activeState("claude", "pending"));
    const [claude, openrouter] = view.actions;

    expect(claude.label).toBe("Research Queued");
    expect(claude.disabled).toBe(true);
    expect(claude.pulsing).toBe(false);
    expect(claude.hint).toBe(
      `Open ${MANUAL_AGENT_LABEL} and run ${MANUAL_RESEARCH_COMMAND} to start`,
    );

    expect(openrouter.label).toBe("Already Covered");
    expect(openrouter.disabled).toBe(true);
  });

  it("PR-4: active with openrouter in_progress shows 'Researching...' and pulsing=true", () => {
    const view = buildBriefResearchActionsView(
      activeState("openrouter", "in_progress"),
    );
    const [claude, openrouter] = view.actions;

    expect(openrouter.label).toBe("Researching\u2026");
    expect(openrouter.pulsing).toBe(true);
    expect(openrouter.disabled).toBe(true);
    expect(openrouter.hint).toBe(
      "OpenRouter worker is processing this company",
    );

    expect(claude.label).toBe("Already Covered");
    expect(claude.disabled).toBe(true);
    expect(claude.pulsing).toBe(false);
  });

  it("PR-5: active with claude in_progress and progressMessage includes it in the hint", () => {
    const view = buildBriefResearchActionsView(
      activeState("claude", "in_progress", "Analyzing founder background"),
    );
    const [claude] = view.actions;

    expect(claude.hint).toBe("Analyzing founder background");
    expect(claude.pulsing).toBe(true);
  });

  it("PR-6: active non-active executor shows 'Already Covered' label", () => {
    const view = buildBriefResearchActionsView(
      activeState("openrouter", "pending"),
    );
    const [claude] = view.actions;

    expect(claude.label).toBe("Already Covered");
    expect(claude.disabled).toBe(true);
    expect(claude.hint).toBe(
      "A OpenRouter job is already queued for this company",
    );
  });

  it("PR-6b: active with claude in_progress, openrouter shows blocked hint with 'running'", () => {
    const view = buildBriefResearchActionsView(
      activeState("claude", "in_progress"),
    );
    const [, openrouter] = view.actions;

    expect(openrouter.label).toBe("Already Covered");
    expect(openrouter.hint).toBe(
      `A ${MANUAL_AGENT_LABEL} job is already running for this company`,
    );
  });

  // ---- failed ----

  it("PR-7: failed with claude shows 'Retry Research' for claude with error", () => {
    const view = buildBriefResearchActionsView(
      failedState("claude", `${MANUAL_AGENT_LABEL} crashed`),
    );
    const [claude, openrouter] = view.actions;

    expect(claude.label).toBe("Retry Research");
    expect(claude.error).toBe(`${MANUAL_AGENT_LABEL} crashed`);
    expect(claude.disabled).toBe(false);

    // openrouter keeps its default label
    expect(openrouter.label).toBe("Run with OpenRouter");
    expect(openrouter.error).toBeNull();
  });

  it("PR-7b: failed with claude and null error uses fallback error text", () => {
    const view = buildBriefResearchActionsView(failedState("claude", null));
    const [claude] = view.actions;

    expect(claude.error).toBe(`Previous ${MANUAL_AGENT_LABEL} run failed`);
  });

  it("PR-8: failed with openrouter shows 'Retry with OpenRouter' for openrouter", () => {
    const view = buildBriefResearchActionsView(
      failedState("openrouter", "rate limit exceeded"),
    );
    const [claude, openrouter] = view.actions;

    expect(openrouter.label).toBe("Retry with OpenRouter");
    expect(openrouter.error).toBe("rate limit exceeded");
    expect(openrouter.disabled).toBe(false);

    // claude keeps default label
    expect(claude.label).toBe("Request Research");
    expect(claude.error).toBeNull();
  });

  it("PR-8b: failed with openrouter and null error uses fallback error text", () => {
    const view = buildBriefResearchActionsView(failedState("openrouter", null));
    const [, openrouter] = view.actions;

    expect(openrouter.error).toBe("Previous OpenRouter run failed");
  });

  it("PR-9: failed state notice includes executor label and 'brief page'", () => {
    const view = buildBriefResearchActionsView(
      failedState("claude", "timeout"),
    );

    expect(view.notice).toBe(
      `Last run failed via ${MANUAL_AGENT_LABEL}. Retry it or switch executors from the brief page.`,
    );
  });

  it("PR-9b: failed openrouter notice includes 'OpenRouter'", () => {
    const view = buildBriefResearchActionsView(
      failedState("openrouter", "crash"),
    );

    expect(view.notice).toBe(
      "Last run failed via OpenRouter. Retry it or switch executors from the brief page.",
    );
  });

  // ---- idle ----

  it("PR-10: idle state returns both actions enabled with default labels", () => {
    const view = buildBriefResearchActionsView(idleState());
    const [claude, openrouter] = view.actions;

    expect(claude.executor).toBe("claude");
    expect(claude.label).toBe("Request Research");
    expect(claude.disabled).toBe(false);
    expect(claude.pulsing).toBe(false);
    expect(claude.hint).toBe(
      `Queues the ${MANUAL_AGENT_LABEL} research workflow`,
    );
    expect(claude.error).toBeNull();

    expect(openrouter.executor).toBe("openrouter");
    expect(openrouter.label).toBe("Run with OpenRouter");
    expect(openrouter.disabled).toBe(false);
    expect(openrouter.pulsing).toBe(false);
    expect(openrouter.hint).toBe(
      "Queues the OpenRouter worker for automatic research",
    );
    expect(openrouter.error).toBeNull();

    expect(view.notice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildResearchEmptyStateView
// ---------------------------------------------------------------------------

describe("buildResearchEmptyStateView", () => {
  const company = "Acme Corp";

  // ---- active ----

  it("PR-11: active with claude pending shows the manual-agent queue message", () => {
    const view = buildResearchEmptyStateView(
      activeState("claude", "pending"),
      company,
    );

    expect(view.title).toBe(`Research queued in ${MANUAL_AGENT_LABEL}`);
    expect(view.message).toBe(
      `Research for Acme Corp has been queued in ${MANUAL_AGENT_LABEL}. Open ${MANUAL_AGENT_LABEL} and run ${MANUAL_RESEARCH_COMMAND} to start it.`,
    );
  });

  it("PR-11b: active with claude in_progress shows the manual-agent progress title", () => {
    const view = buildResearchEmptyStateView(
      activeState("claude", "in_progress"),
      company,
    );

    expect(view.title).toBe(`${MANUAL_AGENT_LABEL} research in progress`);
    expect(view.message).toBe(
      `${MANUAL_AGENT_LABEL} is currently processing research for Acme Corp. Check back shortly or return to the brief page.`,
    );
  });

  it("PR-12: active with openrouter in_progress shows 'OpenRouter research in progress'", () => {
    const view = buildResearchEmptyStateView(
      activeState("openrouter", "in_progress"),
      company,
    );

    expect(view.title).toBe("OpenRouter research in progress");
    expect(view.message).toBe(
      "The OpenRouter worker is currently processing research for Acme Corp. Check back shortly or return to the brief page.",
    );
  });

  it("PR-12b: active with openrouter pending shows 'OpenRouter research queued'", () => {
    const view = buildResearchEmptyStateView(
      activeState("openrouter", "pending"),
      company,
    );

    expect(view.title).toBe("OpenRouter research queued");
    expect(view.message).toBe(
      "Research for Acme Corp has been queued for the OpenRouter worker. It will start automatically when the worker is running.",
    );
  });

  it("PR-13: active in_progress with progressMessage includes 'Current stage:' in message", () => {
    const view = buildResearchEmptyStateView(
      activeState("claude", "in_progress", "Scraping LinkedIn"),
      company,
    );

    expect(view.message).toBe(
      `${MANUAL_AGENT_LABEL} is currently processing research for Acme Corp. Check back shortly or return to the brief page. Current stage: Scraping LinkedIn.`,
    );
  });

  it("PR-13b: active openrouter in_progress with progressMessage includes 'Current stage:'", () => {
    const view = buildResearchEmptyStateView(
      activeState("openrouter", "in_progress", "Fetching website"),
      company,
    );

    expect(view.message).toBe(
      "The OpenRouter worker is currently processing research for Acme Corp. Check back shortly or return to the brief page. Current stage: Fetching website.",
    );
  });

  // ---- failed ----

  it("PR-14: failed with error shows executor label in title and error in message", () => {
    const view = buildResearchEmptyStateView(
      failedState("claude", "API key expired"),
      company,
    );

    expect(view.title).toBe(`${MANUAL_AGENT_LABEL} research failed`);
    expect(view.message).toBe(
      `API key expired Return to the brief page to retry with ${MANUAL_AGENT_LABEL} or switch executors.`,
    );
  });

  it("PR-14b: failed openrouter shows 'OpenRouter research failed'", () => {
    const view = buildResearchEmptyStateView(
      failedState("openrouter", "rate limit"),
      company,
    );

    expect(view.title).toBe("OpenRouter research failed");
    expect(view.message).toBe(
      "rate limit Return to the brief page to retry with OpenRouter or switch executors.",
    );
  });

  it("PR-15: failed with null error uses fallback text", () => {
    const view = buildResearchEmptyStateView(
      failedState("claude", null),
      company,
    );

    expect(view.message).toBe(
      `The last research attempt failed. Return to the brief page to retry with ${MANUAL_AGENT_LABEL} or switch executors.`,
    );
  });

  // ---- idle / completed (default branch) ----

  it("PR-16: idle returns 'No research yet' with company name in message", () => {
    const view = buildResearchEmptyStateView(idleState(), company);

    expect(view.title).toBe("No research yet");
    expect(view.message).toBe(
      `Open the brief page for Acme Corp to queue research via ${MANUAL_AGENT_LABEL} or OpenRouter.`,
    );
  });

  it("PR-16b: completed state also returns 'No research yet' (default branch)", () => {
    const view = buildResearchEmptyStateView(completedState(null), company);

    expect(view.title).toBe("No research yet");
    expect(view.message).toBe(
      `Open the brief page for Acme Corp to queue research via ${MANUAL_AGENT_LABEL} or OpenRouter.`,
    );
  });
});
