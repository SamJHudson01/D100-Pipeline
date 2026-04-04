import { describe, it, expect } from "vitest";
import {
  buildResearchRouteState,
  type ResearchJobProjection,
} from "@/lib/research/service";

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

// ---------------------------------------------------------------------------
// buildResearchRouteState
// ---------------------------------------------------------------------------

describe("buildResearchRouteState", () => {
  // ---- completed branch ----

  it("RS-1: hasResearchData=true with no jobs returns kind='completed'", () => {
    const state = buildResearchRouteState({
      hasResearchData: true,
      latestJob: null,
    });

    expect(state.kind).toBe("completed");
    expect(state.hasResearchData).toBe(true);
    expect(state.completedExecutor).toBeNull();
    expect(state.activeJob).toBeNull();
    expect(state.latestJob).toBeNull();
    expect(state.recoveryAction).toBeNull();
  });

  it("RS-2: hasResearchData=true with completed claude job sets completedExecutor='claude'", () => {
    const job = makeJob({ executor: "claude", status: "completed" });
    const state = buildResearchRouteState({
      hasResearchData: true,
      latestJob: job,
    });

    expect(state.kind).toBe("completed");
    expect(state.completedExecutor).toBe("claude");
    expect(state.latestJob).toBe(job);
    expect(state.recoveryAction).toBeNull();
  });

  it("RS-2b: hasResearchData=true with completed openrouter job sets completedExecutor='openrouter'", () => {
    const job = makeJob({ executor: "openrouter", status: "completed" });
    const state = buildResearchRouteState({
      hasResearchData: true,
      latestJob: job,
    });

    expect(state.kind).toBe("completed");
    expect(state.completedExecutor).toBe("openrouter");
  });

  it("RS-3: hasResearchData=true with failed job sets completedExecutor=null (data from different source)", () => {
    const job = makeJob({ status: "failed", error: "something broke" });
    const state = buildResearchRouteState({
      hasResearchData: true,
      latestJob: job,
    });

    expect(state.kind).toBe("completed");
    expect(state.completedExecutor).toBeNull();
    expect(state.latestJob).toBe(job);
  });

  // ---- active branch ----

  it("RS-4: hasResearchData=false with pending job returns kind='active', status='pending'", () => {
    const job = makeJob({
      status: "pending",
      startedAt: null,
      completedAt: null,
    });
    const state = buildResearchRouteState({
      hasResearchData: false,
      latestJob: job,
    });

    expect(state.kind).toBe("active");
    expect(state.hasResearchData).toBe(false);
    expect(state.completedExecutor).toBeNull();
    expect(state.activeJob).not.toBeNull();
    expect(state.activeJob!.status).toBe("pending");
    expect(state.latestJob).toBe(job);
    expect(state.recoveryAction).toBeNull();
  });

  it("RS-5: hasResearchData=false with in_progress job returns kind='active', status='in_progress'", () => {
    const job = makeJob({
      status: "in_progress",
      completedAt: null,
    });
    const state = buildResearchRouteState({
      hasResearchData: false,
      latestJob: job,
    });

    expect(state.kind).toBe("active");
    expect(state.activeJob!.status).toBe("in_progress");
    expect(state.recoveryAction).toBeNull();
  });

  // ---- failed branch ----

  it("RS-6: hasResearchData=false with failed job returns kind='failed', recoveryAction.type='retry'", () => {
    const job = makeJob({
      status: "failed",
      error: "OpenRouter timeout",
    });
    const state = buildResearchRouteState({
      hasResearchData: false,
      latestJob: job,
    });

    expect(state.kind).toBe("failed");
    expect(state.hasResearchData).toBe(false);
    expect(state.completedExecutor).toBeNull();
    expect(state.activeJob).toBeNull();
    expect(state.latestJob).toBe(job);
    expect(state.recoveryAction).toEqual({ type: "retry", executor: "claude" });
  });

  it("RS-7: hasResearchData=false with failed openrouter job sets recoveryAction.executor='openrouter'", () => {
    const job = makeJob({
      executor: "openrouter",
      status: "failed",
      error: "rate limit",
    });
    const state = buildResearchRouteState({
      hasResearchData: false,
      latestJob: job,
    });

    expect(state.kind).toBe("failed");
    expect(state.recoveryAction).toEqual({
      type: "retry",
      executor: "openrouter",
    });
  });

  // ---- idle branch ----

  it("RS-8: hasResearchData=false with no jobs returns kind='idle', recoveryAction.type='request'", () => {
    const state = buildResearchRouteState({
      hasResearchData: false,
      latestJob: null,
    });

    expect(state.kind).toBe("idle");
    expect(state.hasResearchData).toBe(false);
    expect(state.completedExecutor).toBeNull();
    expect(state.activeJob).toBeNull();
    expect(state.latestJob).toBeNull();
    expect(state.recoveryAction).toEqual({ type: "request" });
  });

  it("RS-9: hasResearchData=false with completed job (no data -- edge case) returns kind='idle'", () => {
    const job = makeJob({ status: "completed" });
    const state = buildResearchRouteState({
      hasResearchData: false,
      latestJob: job,
    });

    // completed status is not active and not failed, so falls through to idle
    expect(state.kind).toBe("idle");
    expect(state.latestJob).toBe(job);
    expect(state.recoveryAction).toEqual({ type: "request" });
  });
});
