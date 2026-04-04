"use client";

import { useReducer, useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { trpcClient } from "@/lib/trpc/client";
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
} from "@/lib/domain";
import {
  boardReducer,
  initBoardState,
  groupByStage,
  type PipelineCompany,
  type SaveStatus,
} from "./board-reducer";
import styles from "./pipeline-board.module.css";

// ─── Column Hints ───────────────────────────────────────────────────────────

const COLUMN_HINTS: Record<PipelineStage, string> = {
  backlog: "Companies you haven\u2019t reached out to yet",
  outreach: "Active first-touch outreach in progress",
  follow_up: "Waiting for or sending follow-up messages",
  call: "Call or meeting scheduled or completed",
  closed: "Won \u2014 deal closed or engagement started",
  not_closed: "Lost, went dark, or not a fit right now",
};

// ─── Draggable Card ─────────────────────────────────────────────────────────

function DraggableCard({
  company,
  onClick,
}: {
  company: PipelineCompany;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: company.domain,
  });

  const daysSince = company.lastTouchDate
    ? Math.floor((Date.now() - new Date(company.lastTouchDate).getTime()) / 86400000)
    : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-cy="board-card"
      className={`${styles.card} ${isDragging ? styles["card--dragging"] : ""}`}
      onClick={(e) => {
        // Only fire click if not dragging (pointer sensor handles threshold)
        if (!isDragging) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      <div className={styles.card__name} data-cy="card-company-name">{company.name}</div>
      {company.description && (
        <div className={styles.card__desc}>
          {company.description}
        </div>
      )}
      <div className={styles.card__footer}>
        <span className={styles.card__meta}>
          {daysSince !== null ? `${daysSince}d ago` : "\u2014"}
        </span>
        {(company.score ?? 0) > 0 && (
          <span className={styles.card__score}>{company.score}</span>
        )}
      </div>
    </div>
  );
}

// ─── Card Overlay (shown while dragging) ────────────────────────────────────

function CardOverlay({ company }: { company: PipelineCompany }) {
  return (
    <div className={`${styles.card} ${styles["card--overlay"]}`}>
      <div className={styles.card__name}>{company.name}</div>
      {company.description && (
        <div className={styles.card__desc}>
          {company.description}
        </div>
      )}
    </div>
  );
}

// ─── Droppable Column ───────────────────────────────────────────────────────

function DroppableColumn({
  stage,
  items,
  onCardClick,
}: {
  stage: PipelineStage;
  items: PipelineCompany[];
  onCardClick: (domain: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      data-cy="kanban-column"
      className={`${styles.column} ${isOver ? styles["column--over"] : ""}`}
    >
      <div className={styles.column__header} data-cy="column-header">
        <span className={styles.column__label}>{PIPELINE_STAGE_LABELS[stage]}</span>
        <span className={styles.column__count}>{items.length}</span>
      </div>

      <div className={styles.column__cards}>
        {items.length === 0 ? (
          <div className={styles.column__empty}>{COLUMN_HINTS[stage]}</div>
        ) : (
          items.map((c) => (
            <DraggableCard
              key={c.domain}
              company={c}
              onClick={() => onCardClick(c.domain)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────────────

function DetailPanel({
  company,
  notes,
  saveStatus,
  onClose,
  onNotesChange,
  onStageChange,
  onRetryNotes,
}: {
  company: PipelineCompany;
  notes: string;
  saveStatus: SaveStatus;
  onClose: () => void;
  onNotesChange: (text: string) => void;
  onStageChange: (stage: PipelineStage) => void;
  onRetryNotes: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isDirty = saveStatus === "saving" || saveStatus === "failed";
  const [closeBlocked, setCloseBlocked] = useState(false);

  const guardedClose = useCallback(() => {
    if (!isDirty) {
      onClose();
    } else {
      setCloseBlocked(true);
      setTimeout(() => setCloseBlocked(false), 600);
    }
  }, [isDirty, onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") guardedClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [guardedClose]);

  return (
    <>
      <div className={styles.overlay} onClick={guardedClose} />
      <div ref={panelRef} className={styles.panel} data-cy="detail-panel">
        <div className={styles.panel__header}>
          <h2 className={styles.panel__name} data-cy="detail-company-name">{company.name}</h2>
          <button className={styles.panel__close} onClick={guardedClose} data-cy="close-detail">
            \u00d7
          </button>
        </div>

        {company.description && (
          <p className={styles.panel__desc}>{company.description}</p>
        )}

        <div className={styles.panel__section}>
          <label className={styles.panel__label}>Stage</label>
          <select
            className={styles.panel__select}
            data-cy="detail-stage-select"
            value={company.pipelineStage}
            onChange={(e) => onStageChange(e.target.value as PipelineStage)}
          >
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {PIPELINE_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.panel__section}>
          <div className={styles.panel__notesHeader}>
            <label className={styles.panel__label}>Notes</label>
            <span className={`${styles.panel__saveStatus} ${saveStatus === "failed" ? styles["panel__saveStatus--error"] : ""}`} data-cy="notes-status">
              {saveStatus === "saving"
                ? "Saving\u2026"
                : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "failed"
                ? "Failed to save"
                : ""}
              {saveStatus === "failed" && (
                <>
                  {" "}
                  <button className={styles.panel__retry} onClick={onRetryNotes}>
                    Retry
                  </button>
                </>
              )}
            </span>
          </div>
          {closeBlocked && (
            <div className={styles.panel__closeHint}>
              {saveStatus === "failed" ? "Save failed — retry or wait before closing" : "Notes are saving\u2026"}
            </div>
          )}
          <textarea
            data-cy="detail-notes"
            className={`${styles.panel__notes} ${saveStatus === "failed" ? styles["panel__notes--error"] : ""} ${closeBlocked ? styles["panel__notes--shake"] : ""}`}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Add notes about this prospect\u2026"
            rows={8}
            maxLength={5000}
          />
        </div>

        <div className={styles.panel__footer}>
          <a
            href={`/brief/${encodeURIComponent(company.domain)}`}
            className={styles.panel__link}
          >
            View Full Brief \u2192
          </a>
        </div>
      </div>
    </>
  );
}

// ─── Board Component ────────────────────────────────────────────────────────

export function PipelineBoardClient({
  initialCompanies,
}: {
  initialCompanies: PipelineCompany[];
}) {
  const [state, dispatch] = useReducer(boardReducer, initialCompanies, initBoardState);

  // Drag state — useState (not useRef) because DragOverlay needs a re-render to show
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Pointer sensor with activation distance to disambiguate drag from click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } })
  );

  // ── Persist stage changes ──────────────────────────────────────────────
  const lastMoveRef = useRef(state.lastMove);
  useEffect(() => {
    if (state.lastMove && state.lastMove !== lastMoveRef.current) {
      const { domain, toStage, fromStage } = state.lastMove;
      trpcClient.dream100.moveStage
        .mutate({ domain, stage: toStage })
        .catch(() => {
          dispatch({ type: "MOVE_FAILED", domain, fromStage });
          dispatch({ type: "MOVE_ERROR", message: "Could not save move — reverted" });
        });
    }
    lastMoveRef.current = state.lastMove;
  }, [state.lastMove]);

  // ── Debounced notes save ───────────────────────────────────────────────
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotesRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.detailDomain === null || state.editingNotes === null) return;
    if (state.editingNotes === lastSavedNotesRef.current) return;

    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      dispatch({ type: "NOTE_SAVING" });
      const domain = state.detailDomain;
      const text = state.editingNotes;
      if (domain === null || text === null) return;
      trpcClient.dream100.updateNotes
        .mutate({ domain, notes: text })
        .then(() => {
          lastSavedNotesRef.current = text;
          dispatch({ type: "NOTE_SAVED" });
        })
        .catch(() => {
          dispatch({ type: "NOTE_FAILED" });
        });
    }, 600);

    return () => {
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
  }, [state.editingNotes, state.detailDomain]);

  // ── Undo toast auto-dismiss ────────────────────────────────────────────
  useEffect(() => {
    if (!state.undoToastVisible) return;
    const timer = setTimeout(() => dispatch({ type: "DISMISS_UNDO" }), 5000);
    return () => clearTimeout(timer);
  }, [state.undoToastVisible, state.lastMove]);

  // ── Undo handler (shared by keyboard and button) ─────────────────────
  const handleUndo = useCallback(() => {
    if (!state.lastMove) return;
    const { domain, fromStage, toStage } = state.lastMove;
    dispatch({ type: "UNDO_MOVE" });
    trpcClient.dream100.moveStage
      .mutate({ domain, stage: fromStage })
      .catch(() => {
        // Undo failed — re-apply the move the server still has
        dispatch({ type: "MOVE_FAILED", domain, fromStage: toStage });
        dispatch({ type: "MOVE_ERROR", message: "Could not undo move — reverted" });
      });
  }, [state.lastMove]);

  // ── Keyboard: Cmd+Z for undo ──────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && state.undoToastVisible) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [state.undoToastVisible, handleUndo]);

  // ── DnD handlers ──────────────────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over) return;

      const domain = active.id as string;
      const toStage = over.id as PipelineStage;

      // Validate the drop target is a valid stage
      if (!PIPELINE_STAGES.includes(toStage)) return;

      dispatch({ type: "MOVE_CARD", domain, toStage });
    },
    []
  );

  const handleCardClick = useCallback((domain: string) => {
    dispatch({ type: "OPEN_DETAIL", domain });
  }, []);

  const handleRetryNotes = useCallback(() => {
    if (state.detailDomain === null || state.editingNotes === null) return;
    dispatch({ type: "NOTE_RETRY" });
    trpcClient.dream100.updateNotes
      .mutate({ domain: state.detailDomain, notes: state.editingNotes })
      .then(() => {
        lastSavedNotesRef.current = state.editingNotes;
        dispatch({ type: "NOTE_SAVED" });
      })
      .catch(() => {
        dispatch({ type: "NOTE_FAILED" });
      });
  }, [state.detailDomain, state.editingNotes]);

  const handleStageChangeFromPanel = useCallback(
    (stage: PipelineStage) => {
      if (state.detailDomain) {
        dispatch({ type: "STAGE_CHANGED_FROM_PANEL", domain: state.detailDomain, toStage: stage });
        // Persistence handled by the lastMove effect — one path for all stage moves
      }
    },
    [state.detailDomain]
  );

  // ── Derived data ──────────────────────────────────────────────────────
  const grouped = useMemo(() => groupByStage(state.companies), [state.companies]);
  const draggedCompany = activeDragId
    ? state.companies.find((c) => c.domain === activeDragId) ?? null
    : null;
  const detailCompany = state.detailDomain
    ? state.companies.find((c) => c.domain === state.detailDomain) ?? null
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={styles.board} data-cy="pipeline-board">
          {PIPELINE_STAGES.map((stage) => (
            <DroppableColumn
              key={stage}
              stage={stage}
              items={grouped.get(stage) || []}
              onCardClick={handleCardClick}
            />
          ))}
        </div>

        <DragOverlay>
          {draggedCompany ? <CardOverlay company={draggedCompany} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Detail panel */}
      {detailCompany && (
        <DetailPanel
          company={detailCompany}
          notes={state.editingNotes ?? ""}
          saveStatus={state.notesSaveStatus}
          onClose={() => dispatch({ type: "CLOSE_DETAIL" })}
          onNotesChange={(text) => dispatch({ type: "UPDATE_NOTE", text })}
          onStageChange={handleStageChangeFromPanel}
          onRetryNotes={handleRetryNotes}
        />
      )}

      {/* Undo toast */}
      {state.undoToastVisible && state.lastMove && (
        <div className={styles.toast} data-cy="undo-toast">
          <span>
            {state.companies.find((c) => c.domain === state.lastMove?.domain)?.name ?? "Company"}{" "}
            moved to {PIPELINE_STAGE_LABELS[state.lastMove.toStage]}
          </span>
          <button
            className={styles.toast__undo}
            onClick={handleUndo}
            data-cy="undo-button"
          >
            Undo \u2318Z
          </button>
        </div>
      )}

      {/* Error banner — persistent until dismissed */}
      {state.errorMessage && (
        <div className={styles.errorBanner} data-cy="error-banner">
          <span>{state.errorMessage}</span>
          <button
            className={styles.errorBanner__dismiss}
            onClick={() => dispatch({ type: "DISMISS_ERROR" })}
          >
            \u00d7
          </button>
        </div>
      )}
    </>
  );
}
