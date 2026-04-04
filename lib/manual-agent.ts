const DEFAULT_MANUAL_AGENT_LABEL = "Codex";
const DEFAULT_MANUAL_RESEARCH_COMMAND = "/research";
const DEFAULT_MANUAL_PROSPECT_COMMAND = "/prospect pipeline";

function readSetting(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const MANUAL_AGENT_LABEL = readSetting(
  process.env.MANUAL_AGENT_LABEL,
  DEFAULT_MANUAL_AGENT_LABEL,
);

export const MANUAL_RESEARCH_COMMAND = readSetting(
  process.env.MANUAL_RESEARCH_COMMAND,
  DEFAULT_MANUAL_RESEARCH_COMMAND,
);

export const MANUAL_PROSPECT_COMMAND = readSetting(
  process.env.MANUAL_PROSPECT_COMMAND,
  DEFAULT_MANUAL_PROSPECT_COMMAND,
);
