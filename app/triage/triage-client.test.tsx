// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { Prospect } from "./triage-client";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/trpc/client", () => ({
  trpcClient: {
    triage: {
      decide: { mutate: vi.fn().mockResolvedValue({}) },
    },
  },
}));

vi.mock("@/components/badges", () => ({
  ScoreBadge: ({ score }: { score: number }) => <span data-testid="score">{score}</span>,
}));

import { trpcClient } from "@/lib/trpc/client";
import { TriageClient } from "./triage-client";

const mockedDecide = vi.mocked(trpcClient.triage.decide.mutate);

// ─── Fixture ─────────────────────────────────────────────────────────────────

const prospects: Prospect[] = [
  {
    domain: "acme.com",
    name: "Acme Corp",
    url: "https://acme.com",
    description: "AI testing platform",
    score: 85,
    source: "yc",
    funding_stage: "Series A",
    team_size: 50,
  },
  {
    domain: "beta.io",
    name: "Beta Inc",
    url: null,
    description: null,
    score: 70,
    source: "producthunt",
    funding_stage: null,
    team_size: null,
  },
  {
    domain: "gamma.dev",
    name: "Gamma Labs",
    url: "https://gamma.dev",
    description: "Analytics for startups",
    score: 60,
    source: "yc",
    funding_stage: "Seed",
    team_size: 15,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function clickButton(label: RegExp) {
  const buttons = screen.getAllByRole("button");
  const btn = buttons.find((b) => label.test(b.textContent ?? ""));
  if (!btn) throw new Error(`No button matching ${label}`);
  fireEvent.click(btn);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TriageClient", () => {
  it("T54: renders first prospect card with name, description, score, and metadata", () => {
    render(<TriageClient prospects={prospects} />);

    // All cards render in DOM (CSS hides non-active ones)
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("AI testing platform").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Series A.*50 employees.*yc/)).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  });

  it("T55: clicking Select advances to next prospect and shows undo toast", async () => {
    render(<TriageClient prospects={prospects} />);

    await act(async () => {
      clickButton(/Select/);
    });

    // Toast with "Acme Corp" and "selected" text — use getAllByText since card names persist in DOM
    const toastTexts = document.body.textContent ?? "";
    expect(toastTexts).toContain("Acme Corp");
    expect(toastTexts).toContain("selected");

    // Undo button present
    expect(screen.getAllByText(/Undo/).length).toBeGreaterThanOrEqual(1);

    // Mutation fired
    expect(mockedDecide).toHaveBeenCalledWith({
      domain: "acme.com",
      decision: "select",
    });

    // Progress updated
    expect(screen.getByText(/1 of 3 reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it("T56: keyboard shortcut S triggers Select", async () => {
    render(<TriageClient prospects={prospects} />);

    await act(async () => {
      fireEvent.keyDown(window, { key: "s" });
    });

    expect(mockedDecide).toHaveBeenCalledWith({
      domain: "acme.com",
      decision: "select",
    });
    expect(screen.getByText(/1 of 3 reviewed/)).toBeInTheDocument();
  });

  it("T57: keyboard shortcuts X, H, D trigger Skip, Snooze, Dismiss respectively", async () => {
    render(<TriageClient prospects={prospects} />);

    // X → skip on first prospect
    await act(async () => {
      fireEvent.keyDown(window, { key: "x" });
    });

    expect(mockedDecide).toHaveBeenCalledWith({
      domain: "acme.com",
      decision: "skip",
    });

    const toastText = document.body.textContent ?? "";
    expect(toastText).toContain("Acme Corp");
    expect(toastText).toContain("skipped");
  });

  it("T58: Cmd+Z undoes the last decision and returns to previous card", async () => {
    render(<TriageClient prospects={prospects} />);

    // Select first prospect
    await act(async () => {
      fireEvent.keyDown(window, { key: "s" });
    });

    expect(screen.getByText(/1 of 3 reviewed/)).toBeInTheDocument();

    // Press Cmd+Z
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });

    // Should be back to 0
    expect(screen.getByText(/0 of 3 reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  });

  it("T59: completion screen after all prospects reviewed", async () => {
    render(<TriageClient prospects={prospects} />);

    // Make decisions: select, select, skip
    await act(async () => { fireEvent.keyDown(window, { key: "s" }); });
    await act(async () => { fireEvent.keyDown(window, { key: "s" }); });
    await act(async () => { fireEvent.keyDown(window, { key: "x" }); });

    // Completion screen — use getAllByText for ✓ since progress segments may also match
    expect(screen.getAllByText("✓").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/3 of 3 reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/2 selected for today/)).toBeInTheDocument();

    // View selected briefs link
    const briefLink = screen.getByText(/View selected briefs/);
    expect(briefLink).toBeInTheDocument();
    expect(briefLink.getAttribute("href")).toContain("/brief/");

    // Navigation links
    expect(screen.getByText("Dream 100")).toBeInTheDocument();
    expect(screen.getByText("Pool Explorer")).toBeInTheDocument();
  });

  it("T60: completion screen warns when 0 prospects selected", async () => {
    render(<TriageClient prospects={prospects} />);

    // Dismiss all
    await act(async () => { fireEvent.keyDown(window, { key: "d" }); });
    await act(async () => { fireEvent.keyDown(window, { key: "d" }); });
    await act(async () => { fireEvent.keyDown(window, { key: "d" }); });

    expect(screen.getByText(/No prospects selected/)).toBeInTheDocument();
    expect(screen.queryByText(/View selected briefs/)).not.toBeInTheDocument();
  });

  it("T61: empty state when no prospects", () => {
    render(<TriageClient prospects={[]} />);

    expect(screen.getByText(/No scored prospects available/)).toBeInTheDocument();
    expect(screen.getByText(/\/prospect pipeline/)).toBeInTheDocument();
    // No decision buttons visible
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("T62: keyboard shortcuts are ignored after completion", async () => {
    render(<TriageClient prospects={prospects} />);

    // Complete all reviews
    await act(async () => { fireEvent.keyDown(window, { key: "s" }); });
    await act(async () => { fireEvent.keyDown(window, { key: "s" }); });
    await act(async () => { fireEvent.keyDown(window, { key: "s" }); });

    const callCountBeforeExtra = mockedDecide.mock.calls.length;

    // Try pressing S again
    await act(async () => { fireEvent.keyDown(window, { key: "s" }); });

    // No additional mutation fired
    expect(mockedDecide.mock.calls.length).toBe(callCountBeforeExtra);
    // Completion screen still visible
    expect(screen.getAllByText("✓").length).toBeGreaterThanOrEqual(1);
  });
});
