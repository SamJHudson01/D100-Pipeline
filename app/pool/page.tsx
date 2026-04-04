import { createCaller } from "@/lib/trpc/server";
import { DEFAULT_REGION, REGIONS, ALL_REGIONS, POOL_SORT_OPTIONS } from "@/lib/domain";
import type { PoolSort } from "@/lib/domain";
import Link from "next/link";
import { ScoreBadge, StateChip, ResearchBadge } from "@/components/badges";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    source?: string;
    state?: string;
    q?: string;
    page?: string;
    min_score?: string;
    region?: string;
    sort?: string;
    archived?: string;
  }>;
};

export default async function PoolPage({ searchParams }: Props) {
  const params = await searchParams;
  const trpc = await createCaller();

  const source = params.source || undefined;
  const stateFilter = (params.state || undefined) as Parameters<typeof trpc.company.pool>[0]["state"];
  const query = params.q || undefined;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const minScore = parseInt(params.min_score || "0", 10);
  const region = params.region || DEFAULT_REGION;
  const sortBy = (POOL_SORT_OPTIONS as readonly string[]).includes(params.sort || "")
    ? (params.sort as PoolSort)
    : "score";
  const showArchived = params.archived === "true";

  const data = await trpc.company.pool({
    source,
    state: stateFilter,
    q: query,
    page,
    minScore,
    region,
    sortBy,
    showArchived,
  });

  function buildUrl(newParams: Record<string, string>) {
    const merged = { ...params, ...newParams };
    const qs = Object.entries(merged)
      .filter(([, v]) => v && v !== "0")
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return `/pool${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className={styles.page} data-cy="pool-page">
      <h1 className={`type-heading-lg ${styles.page__title}`}>
        Pool Explorer
      </h1>
      <div className={styles.page__context}>
        <div className={`type-body-sm ${styles.page__subtitle}`}>
          Showing{" "}
          <span className="type-mono-md">{data.totalFiltered.toLocaleString()}</span> of{" "}
          <span className="type-mono-md">{data.totalPool.toLocaleString()}</span>{" "}
          {region === ALL_REGIONS
            ? "companies"
            : `${REGIONS.find((r) => r.value === region)?.label ?? region} companies`}
        </div>
        <div className={styles.page__regions}>
          {REGIONS.map((r) => (
            <Link
              key={r.value}
              href={buildUrl({ region: r.value, page: "1" })}
              className={`${styles.filters__region} ${
                region === r.value ? styles["filters__region--active"] : ""
              }`}
              aria-current={region === r.value ? "true" : undefined}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className={styles.filters}>
        <form action="/pool" method="get" style={{ display: "contents" }}>
          {source && <input type="hidden" name="source" value={source} />}
          {stateFilter && <input type="hidden" name="state" value={stateFilter} />}
          <input type="hidden" name="region" value={region} />
          <input
            type="text"
            name="q"
            placeholder="Search companies..."
            defaultValue={query}
            data-cy="pool-search"
            className={styles.filters__search}
          />
        </form>

        {source && (
          <Link href={buildUrl({ source: "", page: "1" })} className={styles.filters__chip}>
            Source: {source} ✕
          </Link>
        )}
        {stateFilter && (
          <Link href={buildUrl({ state: "", page: "1" })} className={styles.filters__chip}>
            State: {stateFilter} ✕
          </Link>
        )}
        {minScore > 0 && (
          <Link href={buildUrl({ min_score: "0", page: "1" })} className={styles.filters__chip}>
            Score ≥ {minScore} ✕
          </Link>
        )}

        {!stateFilter && (
          <Link
            href={buildUrl({ state: "qualified", page: "1" })}
            className={styles.filters__quick}
          >
            Qualified only
          </Link>
        )}

        <Link
          href={buildUrl({ sort: sortBy === "team_size_asc" ? "score" : "team_size_asc", page: "1" })}
          className={`${styles.filters__quick} ${sortBy === "team_size_asc" ? styles["filters__quick--active"] : ""}`}
        >
          Smallest teams first
        </Link>

        <Link
          href={buildUrl({ archived: showArchived ? "" : "true", page: "1" })}
          className={`${styles.filters__quick} ${showArchived ? styles["filters__quick--active"] : ""}`}
        >
          Show archived
        </Link>
      </div>

      {/* Results */}
      <div className={styles.content}>
        <div className={styles.results}>
          {data.items.length === 0 ? (
            <div className={styles.results__empty} data-cy="pool-empty-state">
              <div className={styles["results__empty-title"]}>No companies found</div>
              <div className={styles["results__empty-message"]}>
                {query || source || stateFilter || minScore > 0
                  ? "Try adjusting your filters or search query."
                  : showArchived
                    ? "No archived companies yet."
                    : "Run a gather script to discover companies."}
              </div>
            </div>
          ) : (
          <div className={styles.results__list} data-cy="pool-list">
            {data.items.map((c, i) => {
              // Detect cluster boundary: last researched row before first non-researched
              const isClusterBoundary =
                c.hasResearch &&
                i < data.items.length - 1 &&
                !data.items[i + 1].hasResearch;

              return (
                <Link
                  key={c.domain}
                  href={`/brief/${encodeURIComponent(c.domain)}`}
                  data-cy="pool-row"
                  className={`${styles.results__row} ${c.hasResearch ? styles["results__row--researched"] : ""} ${isClusterBoundary ? styles["results__row--cluster-boundary"] : ""}`}
                >
                  <div className={styles.results__info}>
                    <div className={`type-heading-sm ${styles.results__name}`} data-cy="pool-company-name">
                      {c.name}
                    </div>
                    <div className={`type-body-sm ${styles.results__description}`}>
                      {c.description || c.domain}
                    </div>
                  </div>
                  <StateChip state={c.state} />
                  {(c.score ?? 0) > 0 && <ScoreBadge score={c.score ?? 0} />}
                  <span className={styles.results__research}>
                    {c.hasResearch && <ResearchBadge hasResearch={c.hasResearch} />}
                  </span>
                  <span className={`type-body-sm ${styles.results__team}`}>
                    {c.teamSize ? `${c.teamSize} emp` : ""}
                  </span>
                </Link>
              );
            })}
          </div>
          )}

          {data.totalPages > 1 && (
            <div className={styles.pagination} data-cy="pool-pagination">
              {page > 1 && (
                <Link
                  href={buildUrl({ page: String(page - 1) })}
                  data-cy="pool-prev"
                  className={`type-body-sm ${styles.pagination__button}`}
                >
                  ← Prev
                </Link>
              )}
              <span className={`type-body-sm ${styles.pagination__current}`}>
                Page {page} of {data.totalPages}
              </span>
              {page < data.totalPages && (
                <Link
                  href={buildUrl({ page: String(page + 1) })}
                  data-cy="pool-next"
                  className={`type-body-sm ${styles.pagination__button}`}
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
