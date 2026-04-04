import { describe, it, expect } from "vitest";
import {
  boardReducer,
  initBoardState,
  applyStageMove,
  groupByStage,
  type PipelineCompany,
  type BoardState,
} from "./board-reducer";

const makeCompany = (overrides: Partial<PipelineCompany> = {}): PipelineCompany => ({
  domain: "acme.com",
  name: "Acme",
  description: null,
  score: 75,
  pipelineStage: "backlog",
  notes: null,
  lastTouchDate: null,
  ...overrides,
});

const makeState = (overrides: Partial<BoardState> = {}): BoardState => ({
  ...initBoardState([makeCompany()]),
  ...overrides,
});

// ─── applyStageMove ─────────────────────────────────────────────────────────

describe("applyStageMove", () => {
  it("moves a company and sets lastMove", () => {
    const state = makeState();
    const result = applyStageMove(state, "acme.com", "outreach");
    expect(result.companies[0].pipelineStage).toBe("outreach");
    expect(result.lastMove).toEqual({
      domain: "acme.com",
      fromStage: "backlog",
      toStage: "outreach",
    });
    expect(result.undoToastVisible).toBe(true);
  });

  it("is a no-op when moving to the same stage", () => {
    const state = makeState();
    const result = applyStageMove(state, "acme.com", "backlog");
    expect(result).toBe(state);
  });

  it("is a no-op for unknown domain", () => {
    const state = makeState();
    const result = applyStageMove(state, "unknown.com", "outreach");
    expect(result).toBe(state);
  });
});

// ─── boardReducer ───────────────────────────────────────────────────────────

describe("boardReducer", () => {
  describe("MOVE_CARD", () => {
    it("moves a company to a new stage", () => {
      const state = makeState();
      const result = boardReducer(state, { type: "MOVE_CARD", domain: "acme.com", toStage: "call" });
      expect(result.companies[0].pipelineStage).toBe("call");
      expect(result.lastMove?.toStage).toBe("call");
    });
  });

  describe("STAGE_CHANGED_FROM_PANEL", () => {
    it("uses the same applyStageMove logic as MOVE_CARD", () => {
      const state = makeState();
      const result = boardReducer(state, {
        type: "STAGE_CHANGED_FROM_PANEL",
        domain: "acme.com",
        toStage: "follow_up",
      });
      expect(result.companies[0].pipelineStage).toBe("follow_up");
      expect(result.lastMove?.fromStage).toBe("backlog");
    });
  });

  describe("MOVE_FAILED", () => {
    it("reverts the company to the fromStage", () => {
      const state = makeState({
        companies: [makeCompany({ pipelineStage: "outreach" })],
        lastMove: { domain: "acme.com", fromStage: "backlog", toStage: "outreach" },
        undoToastVisible: true,
      });
      const result = boardReducer(state, { type: "MOVE_FAILED", domain: "acme.com", fromStage: "backlog" });
      expect(result.companies[0].pipelineStage).toBe("backlog");
      expect(result.lastMove).toBeNull();
      expect(result.undoToastVisible).toBe(false);
    });
  });

  describe("UNDO_MOVE", () => {
    it("reverts to the fromStage when lastMove exists", () => {
      const state = makeState({
        companies: [makeCompany({ pipelineStage: "outreach" })],
        lastMove: { domain: "acme.com", fromStage: "backlog", toStage: "outreach" },
        undoToastVisible: true,
      });
      const result = boardReducer(state, { type: "UNDO_MOVE" });
      expect(result.companies[0].pipelineStage).toBe("backlog");
      expect(result.lastMove).toBeNull();
    });

    it("is a no-op when lastMove is null", () => {
      const state = makeState();
      const result = boardReducer(state, { type: "UNDO_MOVE" });
      expect(result).toBe(state);
    });
  });

  describe("DISMISS_UNDO", () => {
    it("hides the undo toast", () => {
      const state = makeState({ undoToastVisible: true });
      const result = boardReducer(state, { type: "DISMISS_UNDO" });
      expect(result.undoToastVisible).toBe(false);
    });
  });

  describe("OPEN_DETAIL", () => {
    it("sets detailDomain and initialises notes from the company", () => {
      const state = makeState({ companies: [makeCompany({ notes: "existing notes" })] });
      const result = boardReducer(state, { type: "OPEN_DETAIL", domain: "acme.com" });
      expect(result.detailDomain).toBe("acme.com");
      expect(result.editingNotes).toBe("existing notes");
      expect(result.notesSaveStatus).toBe("idle");
    });

    it("defaults notes to empty string when company has no notes", () => {
      const state = makeState();
      const result = boardReducer(state, { type: "OPEN_DETAIL", domain: "acme.com" });
      expect(result.editingNotes).toBe("");
    });
  });

  describe("CLOSE_DETAIL", () => {
    it("clears detail state", () => {
      const state = makeState({
        detailDomain: "acme.com",
        editingNotes: "some notes",
        notesSaveStatus: "saved",
      });
      const result = boardReducer(state, { type: "CLOSE_DETAIL" });
      expect(result.detailDomain).toBeNull();
      expect(result.editingNotes).toBeNull();
      expect(result.notesSaveStatus).toBe("idle");
    });
  });

  describe("UPDATE_NOTE", () => {
    it("updates editingNotes and syncs to the company", () => {
      const state = makeState({
        detailDomain: "acme.com",
        editingNotes: "",
      });
      const result = boardReducer(state, { type: "UPDATE_NOTE", text: "new note" });
      expect(result.editingNotes).toBe("new note");
      expect(result.companies[0].notes).toBe("new note");
    });

    it("is a no-op when no detail panel is open", () => {
      const state = makeState();
      const result = boardReducer(state, { type: "UPDATE_NOTE", text: "new note" });
      expect(result).toBe(state);
    });
  });

  describe("note save status transitions", () => {
    it("NOTE_SAVING sets status to saving", () => {
      const state = makeState({ notesSaveStatus: "idle" });
      expect(boardReducer(state, { type: "NOTE_SAVING" }).notesSaveStatus).toBe("saving");
    });

    it("NOTE_SAVED sets status to saved", () => {
      const state = makeState({ notesSaveStatus: "saving" });
      expect(boardReducer(state, { type: "NOTE_SAVED" }).notesSaveStatus).toBe("saved");
    });

    it("NOTE_FAILED sets status to failed", () => {
      const state = makeState({ notesSaveStatus: "saving" });
      expect(boardReducer(state, { type: "NOTE_FAILED" }).notesSaveStatus).toBe("failed");
    });

    it("NOTE_RETRY sets status back to saving", () => {
      const state = makeState({ notesSaveStatus: "failed" });
      expect(boardReducer(state, { type: "NOTE_RETRY" }).notesSaveStatus).toBe("saving");
    });
  });

  describe("error message", () => {
    it("MOVE_ERROR sets errorMessage", () => {
      const state = makeState();
      const result = boardReducer(state, { type: "MOVE_ERROR", message: "Something failed" });
      expect(result.errorMessage).toBe("Something failed");
    });

    it("DISMISS_ERROR clears errorMessage", () => {
      const state = makeState({ errorMessage: "Something failed" });
      const result = boardReducer(state, { type: "DISMISS_ERROR" });
      expect(result.errorMessage).toBeNull();
    });
  });
});

// ─── groupByStage ───────────────────────────────────────────────────────────

describe("groupByStage", () => {
  it("groups companies into the correct stages", () => {
    const companies: PipelineCompany[] = [
      makeCompany({ domain: "a.com", pipelineStage: "backlog" }),
      makeCompany({ domain: "b.com", pipelineStage: "outreach" }),
      makeCompany({ domain: "c.com", pipelineStage: "backlog" }),
    ];
    const grouped = groupByStage(companies);
    expect(grouped.get("backlog")?.length).toBe(2);
    expect(grouped.get("outreach")?.length).toBe(1);
    expect(grouped.get("call")?.length).toBe(0);
  });

  it("returns empty arrays for all stages when no companies exist", () => {
    const grouped = groupByStage([]);
    expect(grouped.get("backlog")).toEqual([]);
    expect(grouped.get("closed")).toEqual([]);
    expect(grouped.size).toBe(6);
  });
});

// ─── Multi-company interactions ──────────────────────────────────────────────

describe("boardReducer -- multi-company interactions", () => {
  const makeMultiState = () =>
    makeState({
      companies: [
        makeCompany({ domain: "a.com", name: "Company A", pipelineStage: "backlog", notes: "notes for A" }),
        makeCompany({ domain: "b.com", name: "Company B", pipelineStage: "outreach", notes: "notes for B" }),
      ],
    });

  it("MOVE_CARD on company A does not affect company B", () => {
    const state = makeMultiState();
    const result = boardReducer(state, { type: "MOVE_CARD", domain: "a.com", toStage: "call" });
    expect(result.companies[0].pipelineStage).toBe("call");
    expect(result.companies[1].pipelineStage).toBe("outreach");
    expect(result.companies[1].domain).toBe("b.com");
  });

  it("OPEN_DETAIL on company B initializes notes from B, not A", () => {
    const state = makeMultiState();
    const result = boardReducer(state, { type: "OPEN_DETAIL", domain: "b.com" });
    expect(result.detailDomain).toBe("b.com");
    expect(result.editingNotes).toBe("notes for B");
  });

  it("UPDATE_NOTE only updates the detailed company, not others", () => {
    const state = makeState({
      companies: [
        makeCompany({ domain: "a.com", notes: null }),
        makeCompany({ domain: "b.com", notes: null }),
      ],
      detailDomain: "a.com",
      editingNotes: "",
    });
    const result = boardReducer(state, { type: "UPDATE_NOTE", text: "updated" });
    expect(result.companies[0].notes).toBe("updated");
    expect(result.companies[1].notes).toBeNull();
  });
});
