import styles from "./page.module.css";

export default function PoolLoading() {
  return (
    <div className={styles.page}>
      <h1 className={`type-heading-lg ${styles.page__title}`}>Pool Explorer</h1>
      <div className={styles.page__context}>
        <div className={`type-body-sm ${styles.page__subtitle}`}>Loading...</div>
      </div>
      <div className={styles.filters}>
        <div style={{ height: 36, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", width: 240 }} />
      </div>
      <div className={styles.content}>
        <div className={styles.results}>
          <div className={styles.results__list}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 56, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
