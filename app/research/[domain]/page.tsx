import { createCaller } from "@/lib/trpc/server";
import {
  buildResearchEmptyStateView,
  getExecutorLabel,
} from "@/lib/research/presentation";
import Link from "next/link";
import { ScoreBadge } from "@/components/badges";
import type { ReactNode } from "react";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ domain: string }> };

type DetailRow = {
  label: string;
  value?: string | null;
};

type SourcedText = {
  text: string;
  source?: string;
  sourceUrl?: string;
};

type ReferenceItem = {
  title: string;
  url?: string;
  platform?: string;
  event?: string;
  date?: string;
  summary?: string;
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasSourcedItems(items: SourcedText[] | undefined): items is SourcedText[] {
  return Array.isArray(items) && items.length > 0;
}

function hasReferenceItems(
  items: ReferenceItem[] | undefined,
): items is ReferenceItem[] {
  return Array.isArray(items) && items.length > 0;
}

function renderDetailCard(
  title: string,
  rows: DetailRow[],
  extra?: ReactNode,
): ReactNode {
  const visibleRows = rows.filter((row) => hasText(row.value));
  if (visibleRows.length === 0 && !extra) {
    return null;
  }

  return (
    <div className={styles["founder-item"]}>
      <div className={styles["founder-item__title"]}>{title}</div>
      <div className={styles["detail-list"]}>
        {visibleRows.map((row) => (
          <div key={row.label} className={styles["detail-row"]}>
            <div className={styles["detail-label"]}>{row.label}</div>
            <div className={styles["detail-value"]}>{row.value}</div>
          </div>
        ))}
      </div>
      {extra}
    </div>
  );
}

function renderSourcedList(
  title: string,
  items: SourcedText[] | undefined,
): ReactNode {
  if (!hasSourcedItems(items)) {
    return null;
  }

  return (
    <div className={styles["founder-item"]}>
      <div className={styles["founder-item__title"]}>{title}</div>
      <div className={styles.challenges}>
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className={styles.challenge}>
            <div>
              <div className={styles.challenge__signal}>{item.text}</div>
              {item.source && (
                <div className={styles.challenge__implication}>{item.source}</div>
              )}
            </div>
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.challenge__source}
              >
                {item.source || new URL(item.sourceUrl).hostname} ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderReferenceCard(
  title: string,
  items: ReferenceItem[] | undefined,
): ReactNode {
  if (!hasReferenceItems(items)) {
    return null;
  }

  return (
    <div className={styles["founder-item"]}>
      <div className={styles["founder-item__title"]}>{title}</div>
      <div className={styles["founder-items"]}>
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className={styles["founder-item"]}>
            <div className={styles["founder-item__title"]}>{item.title}</div>
            <div className={styles["founder-item__meta"]}>
              {item.platform && <span>{item.platform}</span>}
              {item.event && <span>{item.event}</span>}
              {item.date && <span>{item.date}</span>}
            </div>
            {item.summary && (
              <div className={styles["founder-item__summary"]}>{item.summary}</div>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles["founder-item__source"]}
              >
                {new URL(item.url).hostname} ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ResearchPage({ params }: Props) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);

  let data;
  try {
    const trpc = await createCaller();
    data = await trpc.research.full({ domain: decodedDomain });
  } catch {
    return (
      <div data-cy="research-not-found" className={styles.page}>
        <div className={styles.empty}>
          <div className={styles.empty__title}>Company not found</div>
          <Link href="/pool" className={styles.empty__link}>← Back to Pool</Link>
        </div>
      </div>
    );
  }

  const { name, effectiveScore, researchData, researchState } = data;

  if (!researchData) {
    const emptyState = buildResearchEmptyStateView(researchState, name);

    return (
      <div data-cy="research-empty" className={styles.page}>
        <div className={styles.empty}>
          <div className={styles.empty__title}>{emptyState.title}</div>
          <div className={styles.empty__text}>{emptyState.message}</div>
          <Link href={`/brief/${encodeURIComponent(decodedDomain)}`} className={styles.empty__link}>
            ← Back to Brief
          </Link>
        </div>
      </div>
    );
  }

  const {
    summary,
    companyIntel,
    prospectIntel,
    painPointHypotheses,
    personalizationHooks,
    researchedAt,
  } = researchData;

  const hasCompanyIntel = Boolean(
    companyIntel?.productMarket ||
      companyIntel?.stageTraction ||
      companyIntel?.techStack ||
      companyIntel?.onlinePresence,
  );
  const hasProspectIntel = Boolean(
    prospectIntel?.background ||
      prospectIntel?.contentThoughtLeadership ||
      prospectIntel?.personalitySignals,
  );
  const hasPainPoints =
    Array.isArray(painPointHypotheses) && painPointHypotheses.length > 0;
  const hasHooks =
    Array.isArray(personalizationHooks) && personalizationHooks.length > 0;

  return (
    <div data-cy="research-page" className={styles.page}>
      <div className={styles.header}>
        <div className={styles.header__left}>
          <h1 data-cy="research-company-name" className={styles.header__name}>{name}</h1>
          <div className={styles.header__meta}>
            {decodedDomain}
            {researchedAt && <> · Researched {researchedAt.slice(0, 10)}</>}
            {researchState.completedExecutor && (
              <> · via {getExecutorLabel(researchState.completedExecutor)}</>
            )}
            {effectiveScore > 0 && <> · <ScoreBadge score={effectiveScore} /></>}
          </div>
        </div>
        <Link href={`/brief/${encodeURIComponent(decodedDomain)}`} className={styles.header__back}>
          ← Back to Brief
        </Link>
      </div>

      {summary && <div data-cy="research-summary" className={styles.summary}>{summary}</div>}

      {hasCompanyIntel && (
        <div data-cy="research-company-intel" className={styles.section}>
          <div className={styles.section__header}>Company Intel</div>
          <div className={styles["founder-items"]}>
            {renderDetailCard("Product & Market", [
              { label: "What they do", value: companyIntel?.productMarket?.whatTheyDo },
              { label: "Core product", value: companyIntel?.productMarket?.coreProductService },
              { label: "Target customer", value: companyIntel?.productMarket?.targetCustomer },
              { label: "Business model", value: companyIntel?.productMarket?.businessModel },
              { label: "Pricing model", value: companyIntel?.productMarket?.pricingModel },
              { label: "Key differentiator", value: companyIntel?.productMarket?.keyDifferentiator },
            ])}

            {renderDetailCard(
              "Stage & Traction",
              [
                { label: "Funding", value: companyIntel?.stageTraction?.fundingStageAmount },
                {
                  label: "Key investors",
                  value: companyIntel?.stageTraction?.keyInvestors?.join(", "),
                },
                {
                  label: "Estimated team size",
                  value: companyIntel?.stageTraction?.estimatedTeamSize,
                },
                { label: "Founded", value: companyIntel?.stageTraction?.founded },
              ],
              <>
                {renderSourcedList("Revenue Signals", companyIntel?.stageTraction?.revenueSignals)}
                {renderSourcedList("Growth Signals", companyIntel?.stageTraction?.growthSignals)}
              </>,
            )}

            {renderDetailCard(
              "Tech Stack",
              [
                { label: "Frontend", value: companyIntel?.techStack?.frontend?.join(", ") },
                { label: "Backend", value: companyIntel?.techStack?.backend?.join(", ") },
                {
                  label: "Infrastructure",
                  value: companyIntel?.techStack?.infrastructure?.join(", "),
                },
                {
                  label: "Tools / Integrations",
                  value: companyIntel?.techStack?.notableToolsIntegrations?.join(", "),
                },
              ],
              renderSourcedList("Tech Sources", companyIntel?.techStack?.sources),
            )}

            {renderDetailCard("Online Presence", [
              { label: "Website", value: companyIntel?.onlinePresence?.websiteUrl },
              {
                label: "Traffic estimate",
                value: companyIntel?.onlinePresence?.trafficEstimate,
              },
              {
                label: "Blog / content",
                value: companyIntel?.onlinePresence?.blogContentStrategy,
              },
              { label: "SEO presence", value: companyIntel?.onlinePresence?.seoPresence },
            ])}
          </div>
        </div>
      )}

      {hasProspectIntel && (
        <div data-cy="research-prospect-intel" className={styles.section}>
          <div className={styles.section__header}>Prospect Personal Intel</div>
          <div className={styles["founder-items"]}>
            {renderDetailCard("Background", [
              { label: "Name", value: prospectIntel?.background?.name },
              { label: "Role", value: prospectIntel?.background?.role },
              {
                label: "Career history",
                value: prospectIntel?.background?.careerHistory?.join(" | "),
              },
              {
                label: "Education",
                value: prospectIntel?.background?.education?.join(" | "),
              },
              {
                label: "Previous companies / exits",
                value: prospectIntel?.background?.previousCompaniesExits?.join(" | "),
              },
              {
                label: "Background type",
                value: prospectIntel?.background?.backgroundType,
              },
            ])}

            {renderDetailCard(
              "Content & Thought Leadership",
              [
                {
                  label: "LinkedIn posting",
                  value: prospectIntel?.contentThoughtLeadership?.linkedinPosting,
                },
                {
                  label: "Blog / newsletter",
                  value: prospectIntel?.contentThoughtLeadership?.blogNewsletter,
                },
                {
                  label: "Twitter / X",
                  value: prospectIntel?.contentThoughtLeadership?.twitterPresence,
                },
                {
                  label: "Key opinions",
                  value: prospectIntel?.contentThoughtLeadership?.keyOpinions?.join(" | "),
                },
              ],
              <>
                {renderReferenceCard(
                  "Podcast Appearances",
                  prospectIntel?.contentThoughtLeadership?.podcastAppearances,
                )}
                {renderReferenceCard(
                  "Conference Talks",
                  prospectIntel?.contentThoughtLeadership?.conferenceTalks,
                )}
              </>,
            )}

            {renderDetailCard("Interests & Personality Signals", [
              {
                label: "Interests outside work",
                value: prospectIntel?.personalitySignals?.interestsOutsideWork?.join(" | "),
              },
              {
                label: "Communication style",
                value: prospectIntel?.personalitySignals?.communicationStyle,
              },
              {
                label: "Values",
                value: prospectIntel?.personalitySignals?.values?.join(" | "),
              },
            ])}
          </div>
        </div>
      )}

      {hasPainPoints && (
        <div data-cy="research-pain-points" className={styles.section}>
          <div className={styles.section__header}>Pain Point Hypotheses</div>
          <div className={styles.angles}>
            {painPointHypotheses.map((item, index) => (
              <div key={index} className={styles.angle}>
                <div className={styles.angle__rank}>Pain Point {index + 1}</div>
                <div className={styles.angle__hook}>{item.painPoint}</div>
                {item.evidenceOrSignal && (
                  <div className={styles.angle__why}>{item.evidenceOrSignal}</div>
                )}
                {item.relevantCapability && (
                  <ul className={styles.angle__points}>
                    <li className={styles.angle__point}>{item.relevantCapability}</li>
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasHooks && (
        <div data-cy="research-hooks" className={styles.section}>
          <div className={styles.section__header}>Personalization Hooks</div>
          <div className={styles.challenges}>
            {personalizationHooks.map((item, index) => (
              <div key={index} className={styles.challenge}>
                <div>
                  <div className={styles.challenge__signal}>{item.hook}</div>
                  {item.source && (
                    <div className={styles.challenge__implication}>{item.source}</div>
                  )}
                </div>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.challenge__source}
                  >
                    {item.source || new URL(item.sourceUrl).hostname} ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
