import { PIPELINE_STAGES, type PipelineStage } from "@/lib/domain";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PipelineCompany = {
  domain: string;
  name: string;
  description: string | null;
  score: number | null;
  pipelineStage: PipelineStage;
  notes: string | null;
  lastTouchDate: string | null; // serialized from Date
};

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export type BoardState = {
  companies: PipelineCompany[];
  detailDomain: string | null;
  editingNotes: string | null; // current textarea value when detail is open
  notesSaveStatus: SaveStatus;
  lastMove: { domain: string; fromStage: PipelineStage; toStage: PipelineStage } | null;
  undoToastVisible: boolean;
  errorMessage: string | null;
};

export type BoardAction =
  | { type: "MOVE_CARD"; domain: string; toStage: PipelineStage }
  | { type: "MOVE_FAILED"; domain: string; fromStage: PipelineStage }
  | { type: "OPEN_DETAIL"; domain: string }
  | { type: "CLOSE_DETAIL" }
  | { type: "UPDATE_NOTE"; text: string }
  | { type: "NOTE_SAVED" }
  | { type: "NOTE_FAILED" }
  | { type: "NOTE_SAVING" }
  | { type: "NOTE_RETRY" }
  | { type: "UNDO_MOVE" }
  | { type: "DISMISS_UNDO" }
  | { type: "STAGE_CHANGED_FROM_PANEL"; domain: string; toStage: PipelineStage }
  | { type: "MOVE_ERROR"; message: string }
  | { type: "DISMISS_ERROR" };

// ─── Shared Helpers ─────────────────────────────────────────────────────────

export function applyStageMove(state: BoardState, domain: string, toStage: PipelineStage): BoardState {
  const company = state.companies.find((c) => c.domain === domain);
  if (!company) return state;
  if (company.pipelineStage === toStage) return state;
  return {
    ...state,
    companies: state.companies.map((c) =>
      c.domain === domain ? { ...c, pipelineStage: toStage } : c
    ),
    lastMove: { domain, fromStage: company.pipelineStage, toStage },
    undoToastVisible: true,
  };
}

// ─── Reducer ────────────────────────────────────────────────────────────────

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "MOVE_CARD":
      return applyStageMove(state, action.domain, action.toStage);

    case "MOVE_FAILED": {
      return {
        ...state,
        companies: state.companies.map((c) =>
          c.domain === action.domain ? { ...c, pipelineStage: action.fromStage } : c
        ),
        lastMove: null,
        undoToastVisible: false,
      };
    }

    case "UNDO_MOVE": {
      if (!state.lastMove) return state;
      const { domain, fromStage } = state.lastMove;
      return {
        ...state,
        companies: state.companies.map((c) =>
          c.domain === domain ? { ...c, pipelineStage: fromStage } : c
        ),
        lastMove: null,
        undoToastVisible: false,
      };
    }

    case "DISMISS_UNDO":
      return { ...state, undoToastVisible: false };

    case "STAGE_CHANGED_FROM_PANEL":
      return applyStageMove(state, action.domain, action.toStage);

    case "OPEN_DETAIL": {
      const company = state.companies.find((c) => c.domain === action.domain);
      return {
        ...state,
        detailDomain: action.domain,
        editingNotes: company?.notes ?? "",
        notesSaveStatus: "idle",
      };
    }

    case "CLOSE_DETAIL":
      return {
        ...state,
        detailDomain: null,
        editingNotes: null,
        notesSaveStatus: "idle",
      };

    case "UPDATE_NOTE": {
      if (state.detailDomain === null) return state;
      return {
        ...state,
        editingNotes: action.text,
        // Also update the company's notes in the flat list for consistency
        companies: state.companies.map((c) =>
          c.domain === state.detailDomain ? { ...c, notes: action.text } : c
        ),
      };
    }

    case "NOTE_SAVING":
      return { ...state, notesSaveStatus: "saving" };

    case "NOTE_SAVED":
      return { ...state, notesSaveStatus: "saved" };

    case "NOTE_FAILED":
      return { ...state, notesSaveStatus: "failed" };

    case "NOTE_RETRY":
      return { ...state, notesSaveStatus: "saving" };

    case "MOVE_ERROR":
      return { ...state, errorMessage: action.message };

    case "DISMISS_ERROR":
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function initBoardState(companies: PipelineCompany[]): BoardState {
  return {
    companies,
    detailDomain: null,
    editingNotes: null,
    notesSaveStatus: "idle",
    lastMove: null,
    undoToastVisible: false,
    errorMessage: null,
  };
}

export function groupByStage(companies: PipelineCompany[]): Map<PipelineStage, PipelineCompany[]> {
  const grouped = new Map<PipelineStage, PipelineCompany[]>();
  for (const stage of PIPELINE_STAGES) grouped.set(stage, []);
  for (const c of companies) {
    grouped.get(c.pipelineStage)?.push(c);
  }
  return grouped;
}
