// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { ResearchActions } from "./research-button";
import type { ResearchRouteState } from "@/lib/research/service";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const completedState: ResearchRouteState = {
  kind: "completed",
  hasResearchData: true,
  completedExecutor: "openrouter",
  activeJob: null,
  latestJob: null,
  recoveryAction: null,
};

const activeState: ResearchRouteState = {
  kind: "active",
  hasResearchData: false,
  completedExecutor: null,
  activeJob: {
    id: "job-1",
    executor: "claude",
    status: "pending",
    progressMessage: null,
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    error: null,
  },
  latestJob: {
    id: "job-1",
    executor: "claude",
    status: "pending",
    progressMessage: null,
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    error: null,
  },
  recoveryAction: null,
};

const idleState: ResearchRouteState = {
  kind: "idle",
  hasResearchData: false,
  completedExecutor: null,
  activeJob: null,
  latestJob: null,
  recoveryAction: { type: "request" },
};

const noop = vi.fn(async () => {});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ResearchActions", () => {
  it("T63: completed state shows disabled 'Researched' label", () => {
    render(
      <ResearchActions
        researchState={completedState}
        claudeFormAction={noop}
        openRouterFormAction={noop}
      />,
    );

    expect(screen.getByText("Researched")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("T64: active state shows pulsing 'Researching…' label", () => {
    render(
      <ResearchActions
        researchState={activeState}
        claudeFormAction={noop}
        openRouterFormAction={noop}
      />,
    );

    expect(screen.getByText("Researching…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("T65: idle state shows both research action buttons", () => {
    render(
      <ResearchActions
        researchState={idleState}
        claudeFormAction={noop}
        openRouterFormAction={noop}
      />,
    );

    const ccButton = screen.getByText("Research Codex");
    const apiButton = screen.getByText("Research API");

    expect(ccButton).toBeInTheDocument();
    expect(apiButton).toBeInTheDocument();
    expect(ccButton).not.toBeDisabled();
    expect(apiButton).not.toBeDisabled();

    // Both buttons are inside form elements
    expect(ccButton.closest("form")).toBeTruthy();
    expect(apiButton.closest("form")).toBeTruthy();
  });
});
