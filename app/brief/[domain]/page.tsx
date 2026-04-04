import { createCaller } from "@/lib/trpc/server";
import { ScoreBadge } from "@/components/badges";
import { notFound } from "next/navigation";
import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import styles from "./page.module.css";
import { ResearchActions } from "./research-button";
import { EditableUrl } from "./edit-url";
import { MANUAL_AGENT_LABEL } from "@/lib/manual-agent";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ domain: string }> };

export default async function BriefPage({ params }: Props) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);
  const trpc = await createCaller();

  let data;
  try {
    data = await trpc.company.brief({ domain: decodedDomain });
  } catch (error: unknown) {
    // Only 404 for actual NOT_FOUND — transient errors should propagate to error.tsx
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const {
    name, url, description, source, effectiveScore: score,
    teamSize, fundingStage, fundingAmount, fundingDate, foundedYear, hqLocation,
    atsPlatform, totalAtsRoles,
    touchpoints, keyPeople, infrastructure, dream100, archived,
    structuredSources, detectedTools, growthMaturity,
    pricing, signup, socialProof, cta, content, contact, latestNews,
    researchState,
  } = data;

  // Fetch research summary only if research exists (parallel would be ideal
  // but we need the brief data first to know if research exists)
  let researchSummary: string | null = null;
  let researchHookCount = 0;
  if (researchState.hasResearchData) {
    try {
      const research = await trpc.research.summary({ domain: decodedDomain });
      researchSummary = research?.summary ?? null;
      researchHookCount = research?.personalizationHookCount ?? 0;
    } catch {
      // Research data fetch failed — don't crash the brief page
    }
  }

  // Compute layout modifier
  const hasTimeline = latestNews.length > 0 || touchpoints.length > 0;
  const hasRefs = !!(pricing?.pageFound || signup?.pageFound || socialProof ||
    detectedTools.length > 0 || content?.communityChannels?.length || researchSummary);
  const layoutMod = !hasTimeline && !hasRefs ? styles["brief--minimal"]
    : !hasTimeline ? styles["brief--no-timeline"]
    : !hasRefs ? styles["brief--no-refs"]
    : "";

  const maturityLevels = ["pre-data-driven", "data-aware", "behaviour-informed", "sophisticated"];
  const maturityIndex = growthMaturity ? maturityLevels.indexOf(growthMaturity.level) : -1;

  // Score color
  const scoreColor = score >= 70 ? "var(--badge-high-text)"
    : score >= 50 ? "var(--badge-medium-text)"
    : score > 0 ? "var(--badge-low-text)"
    : "var(--text-tertiary)";

  const founder = keyPeople.find(p => p.role === "founder" || p.role === "ceo") || keyPeople[0];

  return (
    <div data-cy="brief-page" className={`${styles.brief} ${layoutMod}`}>
      {archived && (
        <div className={styles["archived-banner"]}>
          This company is archived and hidden from the pool.
        </div>
      )}
      {/* ═══ HERO ZONE ═══════════════════════════════════════════════════ */}
      <div className={styles.brief__hero}>
        <div className={styles.hero}>
          <div className={styles.hero__main}>
            {/* Header: name + domain */}
            <div className={styles.hero__header}>
              <h1 data-cy="brief-company-name" className={`${styles.hero__name} ${instrumentSerif.className}`}>{name}</h1>
              <EditableUrl
                domain={decodedDomain}
                currentUrl={url}
                saveAction={async (formData: FormData) => {
                  "use server";
                  const newUrl = formData.get("url") as string;
                  const { createCaller: sc } = await import("@/lib/trpc/server");
                  const t = await sc();
                  await t.company.updateUrl({ domain: decodedDomain, url: newUrl });
                  const { revalidatePath: rv } = await import("next/cache");
                  rv(`/brief/${decodedDomain}`);
                }}
              />
            </div>

            {/* Description + Key Person — side by side */}
            <div className={styles.hero__context}>
              {description && (
                <div className={styles.hero__description}>
                  {description}
                </div>
              )}

              {founder && (
                <div className={styles["key-person"]}>
                  <div className={styles["key-person__header"]}>
                    <div className={styles["key-person__name"]}>{founder.name}</div>
                    {founder.title && <div className={styles["key-person__title"]}>{founder.title}</div>}
                  </div>
                  {founder.podcastAppearances?.[0] && (
                    <div className={styles["key-person__hook"]}>
                      Appeared on {founder.podcastAppearances[0].podcast || "podcast"}
                    </div>
                  )}
                  <div className={styles["key-person__links"]}>
                    {founder.linkedinUrl && <a href={founder.linkedinUrl} target="_blank" rel="noopener noreferrer" className={styles["key-person__link"]}>LinkedIn</a>}
                    {founder.twitterHandle && <a href={`https://twitter.com/${founder.twitterHandle}`} target="_blank" rel="noopener noreferrer" className={styles["key-person__link"]}>X</a>}
                    {founder.githubUsername && <a href={`https://github.com/${founder.githubUsername}`} target="_blank" rel="noopener noreferrer" className={styles["key-person__link"]}>GitHub</a>}
                  </div>
                  {contact?.founderEmail && (
                    <div className={styles["key-person__email"]}>{contact.founderEmail}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Score (top-right) */}
          <div className={styles.hero__score}>
            <div data-cy="brief-score" className={styles["hero__score-value"]} style={{ color: scoreColor }}>
              {score}
            </div>
            <div className={styles["hero__score-label"]}>/100</div>
          </div>
        </div>
      </div>

      {/* ═══ SNAPSHOT GRID ═══════════════════════════════════════════════ */}
      <div className={styles.brief__snapshot}>
        {/* Growth Maturity (full-width card) */}
        {growthMaturity && (
          <div className={styles.maturity}>
            <div className={styles.maturity__header}>
              <span className={styles.maturity__label}>Growth maturity</span>
              <span className={styles.maturity__level}>{growthMaturity.level.replace(/-/g, " ")}</span>
            </div>
            <div className={styles.maturity__bar}>
              {maturityLevels.map((level, i) => (
                <div key={level} className={`${styles.maturity__step} ${i <= maturityIndex ? styles["maturity__step--active"] : ""}`} />
              ))}
            </div>
            {detectedTools.length > 0 && (
              <div className={styles.maturity__tools}>
                {detectedTools.map((t, i) => (
                  <span key={i} className={styles["tool-chip"]}>
                    <span className={styles["tool-chip__category"]}>{t.category.replace(/_/g, " ")}</span>
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stat cards grid */}
        <div className={styles["snapshot-grid"]}>
          {teamSize && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>Team</div>
              <div className={`${styles["stat-card__value"]} ${styles["stat-card__value--mono"]}`}>{teamSize}</div>
              <div className={styles["stat-card__sub"]}>employees</div>
            </div>
          )}
          {fundingStage && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>Funding</div>
              <div className={styles["stat-card__value"]}>{fundingStage}</div>
              {fundingAmount && <div className={styles["stat-card__sub"]}>{fundingAmount}{fundingDate ? ` · ${fundingDate}` : ""}</div>}
            </div>
          )}
          {foundedYear && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>Founded</div>
              <div className={`${styles["stat-card__value"]} ${styles["stat-card__value--mono"]}`}>{foundedYear}</div>
            </div>
          )}
          {hqLocation && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>HQ</div>
              <div className={styles["stat-card__value"]}>{hqLocation}</div>
            </div>
          )}
          {structuredSources?.yc?.batch && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>YC Batch</div>
              <div className={styles["stat-card__value"]}>{structuredSources.yc.batch}</div>
            </div>
          )}
          {cta?.type && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>GTM Motion</div>
              <div className={styles["stat-card__value"]}>
                {cta.type === "plg" ? "Product-led" : cta.type === "hybrid" ? "Hybrid" : "Sales-led"}
              </div>
            </div>
          )}
          {infrastructure?.hostingProvider && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>Hosting</div>
              <div className={styles["stat-card__value"]}>{infrastructure.hostingProvider}</div>
            </div>
          )}
          {infrastructure?.emailProvider && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>Email</div>
              <div className={styles["stat-card__value"]}>{infrastructure.emailProvider}</div>
            </div>
          )}
          {atsPlatform && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>ATS</div>
              <div className={styles["stat-card__value"]}>{atsPlatform}</div>
              {totalAtsRoles > 0 && <div className={styles["stat-card__sub"]}>{totalAtsRoles} open roles</div>}
            </div>
          )}
          {source && (
            <div className={styles["stat-card"]}>
              <div className={styles["stat-card__label"]}>Source</div>
              <div className={styles["stat-card__value"]}>{source}</div>
            </div>
          )}
        </div>

        {/* Score Breakdown — ICP criteria, not tool detection */}
        {score > 0 && (() => {
          const criteria = [
            { name: "Team size", value: teamSize ? `${teamSize} employees` : null, score: teamSize ? (teamSize <= 15 ? 5 : teamSize <= 30 ? 3 : 1) : 0, max: 5 },
            { name: "Funding", value: fundingStage ? `${fundingStage}${fundingAmount ? ` ${fundingAmount}` : ""}` : null, score: fundingStage ? 5 : 0, max: 5 },
            { name: "Growth motion", value: cta?.type === "plg" ? "Product-led" : cta?.type === "hybrid" ? "Hybrid" : cta?.type === "sales_led" ? "Sales-led" : null, score: cta?.type === "plg" ? 5 : cta?.type === "hybrid" ? 3 : cta?.type ? 1 : 0, max: 5 },
            { name: "Traction", value: (socialProof?.testimonialCount || socialProof?.customerLogoCount) ? `${socialProof.customerLogoCount || 0} logos, ${socialProof.testimonialCount || 0} testimonials` : null, score: (socialProof?.testimonialCount || socialProof?.customerLogoCount) ? 3 : 0, max: 5 },
            { name: "Growth hire absence", value: data.hasGrowthHire ? "Hiring for growth role" : "No growth hire", score: data.hasGrowthHire ? 5 : 3, max: 5 },
            { name: "Founder identified", value: keyPeople.length > 0 ? keyPeople[0].name : null, score: keyPeople.length > 0 ? 5 : 0, max: 5 },
            { name: "Timing signal", value: latestNews.length > 0 ? latestNews[0].title?.slice(0, 50) : null, score: latestNews.length > 0 ? 5 : 0, max: 5 },
          ];
          return (
            <details className={styles["score-section"]}>
              <summary className={styles["score-toggle"]}>
                Score breakdown
                <span className="type-mono-md" style={{ color: scoreColor }}>{score}/100</span>
              </summary>
              <div className={styles["score-breakdown"]}>
                {criteria.map((c, i) => (
                  <div key={i} className={styles["score-criterion"]}>
                    <div className={styles["score-criterion__name"]}>{c.name}</div>
                    <div className={styles["score-criterion__bar"]}>
                      <div className={styles["score-criterion__fill"]}
                           style={{ width: `${(c.score / c.max) * 100}%` }} />
                    </div>
                    <div className={styles["score-criterion__evidence"]}>
                      {c.value || "No data"}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })()}
      </div>

      {/* ═══ REFERENCE CARDS ═════════════════════════════════════════════ */}
      {hasRefs && (
        <div className={styles.brief__refs}>
          <div className={styles["section-title"]}>Intelligence</div>
          <div className={styles["ref-cards"]}>
            {pricing?.pageFound && (
              <div className={styles["ref-card"]}>
                <div className={styles["ref-card__title"]}>Pricing</div>
                {pricing.tierCount && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Tiers</span>
                    <span className={styles["ref-card__value"]}>{pricing.tierCount}</span>
                  </div>
                )}
                <div className={styles["ref-card__row"]}>
                  <span className={styles["ref-card__label"]}>Free tier</span>
                  <span className={`${styles["ref-card__value"]} ${pricing.hasFreeTier ? styles["ref-card__value--positive"] : ""}`}>
                    {pricing.hasFreeTier ? "Yes" : "No"}
                  </span>
                </div>
                {pricing.trialDays && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Trial</span>
                    <span className={styles["ref-card__value"]}>{pricing.trialDays} days</span>
                  </div>
                )}
                <div className={styles["ref-card__row"]}>
                  <span className={styles["ref-card__label"]}>Annual toggle</span>
                  <span className={`${styles["ref-card__value"]} ${pricing.hasAnnualToggle === false ? styles["ref-card__value--negative"] : ""}`}>
                    {pricing.hasAnnualToggle ? "Yes" : "Missing"}
                  </span>
                </div>
                {pricing.hasEnterpriseTier && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Enterprise</span>
                    <span className={styles["ref-card__value"]}>Contact sales</span>
                  </div>
                )}
              </div>
            )}

            {signup?.pageFound && (
              <div className={styles["ref-card"]}>
                <div className={styles["ref-card__title"]}>Signup Friction</div>
                {signup.formFieldCount && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Fields</span>
                    <span className={`${styles["ref-card__value"]} ${styles["ref-card__value--mono"]} ${(signup.formFieldCount || 0) > 4 ? styles["ref-card__value--negative"] : ""}`}>
                      {signup.formFieldCount}
                    </span>
                  </div>
                )}
                <div className={styles["ref-card__row"]}>
                  <span className={styles["ref-card__label"]}>OAuth</span>
                  <span className={styles["ref-card__value"]}>
                    {signup.oauthProviders?.length ? signup.oauthProviders.join(", ") : "None"}
                  </span>
                </div>
                {signup.frictionLevel && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Friction</span>
                    <span className={`${styles["ref-card__value"]} ${signup.frictionLevel === "high" ? styles["ref-card__value--negative"] : ""}`}>
                      {signup.frictionLevel}
                    </span>
                  </div>
                )}
              </div>
            )}

            {socialProof && (socialProof.customerLogoCount || socialProof.testimonialCount || socialProof.caseStudyCount) ? (
              <div className={styles["ref-card"]}>
                <div className={styles["ref-card__title"]}>Social Proof</div>
                {(socialProof.customerLogoCount ?? 0) > 0 && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Customer logos</span>
                    <span className={`${styles["ref-card__value"]} ${styles["ref-card__value--mono"]}`}>{socialProof.customerLogoCount}</span>
                  </div>
                )}
                {(socialProof.testimonialCount ?? 0) > 0 && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Testimonials</span>
                    <span className={`${styles["ref-card__value"]} ${styles["ref-card__value--mono"]}`}>{socialProof.testimonialCount}</span>
                  </div>
                )}
                {(socialProof.caseStudyCount ?? 0) > 0 && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Case studies</span>
                    <span className={`${styles["ref-card__value"]} ${styles["ref-card__value--mono"]}`}>{socialProof.caseStudyCount}</span>
                  </div>
                )}
                {socialProof.reviewPlatforms && socialProof.reviewPlatforms.length > 0 && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Reviews</span>
                    <span className={styles["ref-card__value"]}>{socialProof.reviewPlatforms.join(", ")}</span>
                  </div>
                )}
              </div>
            ) : null}

            {content && (content.communityChannels?.length || content.blogPostsPerMonth != null || content.hasActiveChangelog) ? (
              <div className={styles["ref-card"]}>
                <div className={styles["ref-card__title"]}>Content</div>
                {content.blogPostsPerMonth != null && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Blog</span>
                    <span className={styles["ref-card__value"]}>~{content.blogPostsPerMonth}/month</span>
                  </div>
                )}
                {content.hasActiveChangelog && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Changelog</span>
                    <span className={`${styles["ref-card__value"]} ${styles["ref-card__value--positive"]}`}>Active</span>
                  </div>
                )}
                {content.communityChannels && content.communityChannels.length > 0 && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Community</span>
                    <span className={styles["ref-card__value"]}>{content.communityChannels.join(", ")}</span>
                  </div>
                )}
                {content.hasReferralProgram && (
                  <div className={styles["ref-card__row"]}>
                    <span className={styles["ref-card__label"]}>Referral</span>
                    <span className={`${styles["ref-card__value"]} ${styles["ref-card__value--positive"]}`}>Detected</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Research summary card — inside refs section */}
          {researchSummary && (
            <div className={styles["research-card"]}>
              <div className={styles["research-card__header"]}>Research Summary</div>
              <div className={styles["research-card__summary"]}>{researchSummary}</div>
              <div className={styles["research-card__footer"]}>
                {researchHookCount > 0 && (
                  <span className={styles["research-card__count"]}>
                    {researchHookCount} personalization hook{researchHookCount !== 1 ? "s" : ""} captured
                  </span>
                )}
                <Link
                  href={`/research/${encodeURIComponent(decodedDomain)}`}
                  className={styles["research-card__link"]}
                  target="_blank"
                >
                  View Full Research →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TIMELINE ═══════════════════════════════════════════════════ */}
      {hasTimeline && (
        <div className={styles.brief__timeline}>
          {latestNews.length > 0 && (
            <>
              <div className={styles.timeline__title}>Recent signals</div>
              <div className={styles.timeline}>
                {latestNews.map((news, i) => (
                  <div key={i} className={styles.timeline__item}>
                    <span className={styles.timeline__date}>{news.date || "—"}</span>
                    <div className={styles.timeline__content}>
                      {news.url ? (
                        <a href={news.url} target="_blank" rel="noopener noreferrer"
                           className={styles.timeline__headline} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                          {news.title} ↗
                        </a>
                      ) : (
                        <div className={styles.timeline__headline}>{news.title}</div>
                      )}
                      {news.source && <div className={styles.timeline__source}>{news.source}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {touchpoints.length > 0 && (
            <>
              <div className={styles.timeline__title} style={{ marginTop: latestNews.length > 0 ? "var(--space-6)" : 0 }}>
                Contact history
              </div>
              <div className={styles.timeline}>
                {touchpoints.map((tp) => (
                  <div key={tp.id} className={styles.timeline__item}>
                    <span className={styles.timeline__date}>{tp.touchDate.toISOString().slice(0, 10)}</span>
                    <div className={styles.timeline__content}>
                      <div className={styles.timeline__headline}>
                        {tp.type}{tp.notes ? ` — ${tp.notes}` : ""}
                      </div>
                      <div className={styles.timeline__source}>{tp.channel}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ STICKY ACTIONS ═════════════════════════════════════════════ */}
      <div className={styles.actions}>
        {url && (
          <a href={url.startsWith("http") ? url : `https://${url}`}
             target="_blank" rel="noopener noreferrer" className={styles.action}>
            Open Website
          </a>
        )}
        {!dream100 && (
          <form
            action={async () => {
              "use server";
              const { createCaller: sc } = await import("@/lib/trpc/server");
              const t = await sc();
              await t.dream100.addCompany({ domain: decodedDomain });
              const { revalidatePath } = await import("next/cache");
              revalidatePath(`/brief/${decodedDomain}`);
              revalidatePath("/dream-100");
            }}
          >
            <button type="submit" data-cy="brief-add-dream100" className={styles.action}>
              Add to Dream 100
            </button>
          </form>
        )}
        <ResearchActions
          researchState={researchState}
          manualAgentLabel={MANUAL_AGENT_LABEL}
          claudeFormAction={async () => {
            "use server";
            const { createCaller: sc } = await import("@/lib/trpc/server");
            const t = await sc();
            await t.research.request({ domain: decodedDomain });
            const { revalidatePath: rv } = await import("next/cache");
            rv(`/brief/${decodedDomain}`);
            rv(`/research/${decodedDomain}`);
          }}
          openRouterFormAction={async () => {
            "use server";
            const { createCaller: sc } = await import("@/lib/trpc/server");
            const t = await sc();
            await t.research.requestOpenRouter({ domain: decodedDomain });
            const { revalidatePath: rv } = await import("next/cache");
            rv(`/brief/${decodedDomain}`);
            rv(`/research/${decodedDomain}`);
          }}
        />
        {archived ? (
          <form
            action={async () => {
              "use server";
              const { createCaller: sc } = await import("@/lib/trpc/server");
              const t = await sc();
              await t.company.unarchive({ domain: decodedDomain });
              const { revalidatePath: rv } = await import("next/cache");
              rv(`/brief/${decodedDomain}`);
              rv("/pool");
            }}
          >
            <button type="submit" data-cy="brief-unarchive" className={styles.action}>
              Unarchive
            </button>
          </form>
        ) : (
          <form
            action={async () => {
              "use server";
              const { createCaller: sc } = await import("@/lib/trpc/server");
              const t = await sc();
              await t.company.archive({ domain: decodedDomain });
              const { revalidatePath: rv } = await import("next/cache");
              rv(`/brief/${decodedDomain}`);
              rv("/pool");
            }}
          >
            <button type="submit" data-cy="brief-archive" className={`${styles.action} ${styles["action--muted"]}`}>
              Archive
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
