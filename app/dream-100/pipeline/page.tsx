import { createCaller } from "@/lib/trpc/server";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/domain";
import Link from "next/link";
import { PipelineBoardClient } from "./pipeline-board";
import type { PipelineCompany } from "./board-reducer";
import styles from "./page.module.css";

const validStages = new Set<string>(PIPELINE_STAGES);

export const dynamic = "force-dynamic";

export default async function PipelineBoardPage() {
  const trpc = await createCaller();
  const raw = await trpc.dream100.pipeline();

  // Serialize dates for the client boundary
  const companies: PipelineCompany[] = raw.map((c) => ({
    domain: c.domain,
    name: c.name,
    description: c.description,
    score: c.score,
    pipelineStage: (validStages.has(c.pipelineStage) ? c.pipelineStage : "backlog") as PipelineStage,
    notes: c.notes,
    lastTouchDate: c.lastTouchDate ? c.lastTouchDate.toISOString() : null,
  }));

  return (
    <div className={styles.page}>
      <div className={styles.page__header}>
        <h1 className="type-heading-lg">Pipeline Board</h1>
        <Link href="/dream-100" className={`type-body-sm ${styles.page__back}`}>
          &larr; Today&apos;s Actions
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className={styles.empty}>
          <p className={`type-body-md ${styles.empty__text}`}>
            No companies in your Dream 100 yet. Select prospects from{" "}
            <Link href="/triage">Morning Briefing</Link> or add them from the{" "}
            <Link href="/pool">Pool Explorer</Link>.
          </p>
        </div>
      ) : (
        <PipelineBoardClient initialCompanies={companies} />
      )}
    </div>
  );
}
