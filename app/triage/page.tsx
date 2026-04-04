import { createCaller } from "@/lib/trpc/server";
import { TriageClient, type Prospect } from "./triage-client";
import { DEFAULT_REGION } from "@/lib/domain";
import {
  MANUAL_AGENT_LABEL,
  MANUAL_PROSPECT_COMMAND,
} from "@/lib/manual-agent";

export const dynamic = "force-dynamic";

export default async function TriagePage() {
  const trpc = await createCaller();

  const [prospects, stats] = await Promise.all([
    trpc.triage.prospects({ region: DEFAULT_REGION }),
    trpc.triage.stats({ region: DEFAULT_REGION }),
  ]);

  // Map to Prospect shape expected by TriageClient
  const mapped: Prospect[] = prospects.map((p) => {
    // Compute effective score (mirrors companies_scored view)
    let effectiveScore = p.score ?? 0;
    if (p.originalScore != null && p.scoredAt != null) {
      const days = (Date.now() - p.scoredAt.getTime()) / (1000 * 60 * 60 * 24);
      let decay = 0;
      if (days <= 30) decay = 1.0;
      else if (days <= 60) decay = 0.75;
      else if (days <= 90) decay = 0.5;
      effectiveScore = Math.floor(p.originalScore * decay);
    }

    return {
      domain: p.domain,
      name: p.name,
      url: p.url,
      description: p.description,
      score: effectiveScore,
      source: p.source ?? "",
      funding_stage: p.fundingStage,
      team_size: p.teamSize,
    };
  });

  return (
    <div data-cy="triage-page" style={{ padding: "var(--space-7)", maxWidth: 720, margin: "0 auto" }}>
      <h1 className="type-heading-lg">
        Morning Briefing
      </h1>
      <div className="type-body-sm" data-cy="triage-stats" style={{ marginBottom: "var(--space-6)" }}>
        Pool: <span className="type-mono-md">{stats.total.toLocaleString()}</span>
        {" · "}
        <span className="type-mono-md">{stats.qualified}</span> qualified
        {" · "}
        <span className="type-mono-md">{stats.discovered.toLocaleString()}</span> awaiting
      </div>

      <TriageClient
        prospects={mapped}
        manualAgentLabel={MANUAL_AGENT_LABEL}
        prospectCommand={MANUAL_PROSPECT_COMMAND}
      />
    </div>
  );
}
