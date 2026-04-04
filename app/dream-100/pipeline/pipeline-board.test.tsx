// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import type { PipelineCompany } from "./board-reducer";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/trpc/client", () => ({
  trpcClient: {
    dream100: {
      moveStage: { mutate: vi.fn().mockResolvedValue({}) },
      updateNotes: { mutate: vi.fn().mockResolvedValue({}) },
    },
  },
}));

import { trpcClient } from "@/lib/trpc/client";
import { PipelineBoardClient } from "./pipeline-board";

const mockedMoveStage = vi.mocked(trpcClient.dream100.moveStage.mutate);
const mockedUpdateNotes = vi.mocked(trpcClient.dream100.updateNotes.mutate);

// ─── Fixture ─────────────────────────────────────────────────────────────────

const companies: PipelineCompany[] = [
  {
    domain: "acme.com",
    name: "Acme Corp",
    description: "AI testing",
    score: 85,
    pipelineStage: "backlog",
    notes: "Good prospect",
    lastTouchDate: "2026-03-20T00:00:00Z",
  },
  {
    domain: "beta.io",
    name: "Beta Inc",
    description: null,
    score: 70,
    pipelineStage: "outreach",
    notes: null,
    lastTouchDate: null,
  },
  {
    domain: "gamma.dev",
    name: "Gamma Labs",
    description: "Analytics",
    score: 60,
    pipelineStage: "backlog",
    notes: null,
    lastTouchDate: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-27T00:00:00Z"));
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function openDetail(name: string) {
  const cards = screen.getAllByText(name);
  fireEvent.click(cards[0]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PipelineBoardClient", () => {
  it("T25: renders all 6 pipeline columns with labels", () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Outreach")).toBeInTheDocument();
    expect(screen.getByText("Follow Up")).toBeInTheDocument();
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("Not Closed")).toBeInTheDocument();

    // Backlog = 2, Outreach = 1
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("T26: renders company cards with name, description, and score", () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("AI testing").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("85").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Beta Inc").length).toBeGreaterThanOrEqual(1);
  });

  it("T27: clicking a card opens the detail panel", async () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    await act(async () => {
      openDetail("Acme Corp");
    });

    // Panel should have notes textarea
    const textarea = screen.getByPlaceholderText(/Add notes/);
    expect(textarea).toHaveValue("Good prospect");

    // Stage select shows Backlog
    const select = screen.getByDisplayValue("Backlog");
    expect(select).toBeInTheDocument();

    // Brief link
    const briefLink = screen.getByText(/View Full Brief/);
    expect(briefLink).toHaveAttribute("href", "/brief/acme.com");
  });

  it("T28: closing the detail panel via X button", async () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    await act(async () => {
      openDetail("Acme Corp");
    });

    // Find the close button — it renders × (\u00d7) in the panel
    const panelHeading = screen.getAllByText("Acme Corp").find((el) =>
      el.tagName === "H2",
    );
    expect(panelHeading).toBeTruthy();
    const panelHeader = panelHeading!.parentElement!;
    const closeBtn = panelHeader.querySelector("button");
    expect(closeBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(closeBtn!);
    });

    expect(screen.queryByPlaceholderText(/Add notes/)).not.toBeInTheDocument();
  });

  it("T29: Escape key closes the detail panel (when notes are idle)", async () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    await act(async () => {
      openDetail("Acme Corp");
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.queryByPlaceholderText(/Add notes/)).not.toBeInTheDocument();
  });

  it("T30: empty columns show hint text", () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    expect(
      screen.getAllByText("Call or meeting scheduled or completed").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/deal closed/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("T31: card shows 'days ago' when lastTouchDate is set", () => {
    render(<PipelineBoardClient initialCompanies={companies} />);
    expect(screen.getAllByText("7d ago").length).toBeGreaterThanOrEqual(1);
  });

  it("T32: card shows dash when lastTouchDate is null", () => {
    render(<PipelineBoardClient initialCompanies={companies} />);
    const dashes = screen.getAllByText("\u2014");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("T33: stage change via detail panel shows undo toast and fires mutation", async () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    await act(async () => {
      openDetail("Acme Corp");
    });

    const select = screen.getByDisplayValue("Backlog");
    await act(async () => {
      fireEvent.change(select, { target: { value: "outreach" } });
    });

    // Toast with undo button
    expect(screen.getByText(/Undo/)).toBeInTheDocument();

    // Mutation fired
    expect(mockedMoveStage).toHaveBeenCalledWith({
      domain: "acme.com",
      stage: "outreach",
    });
  });

  it("T34: notes change triggers debounced save", async () => {
    render(<PipelineBoardClient initialCompanies={companies} />);

    await act(async () => {
      openDetail("Acme Corp");
    });

    const textarea = screen.getByPlaceholderText(/Add notes/);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Updated notes" } });
    });

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(mockedUpdateNotes).toHaveBeenCalledWith({
        domain: "acme.com",
        notes: "Updated notes",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });
});
