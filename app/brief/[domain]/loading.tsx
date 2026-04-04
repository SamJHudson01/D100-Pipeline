import styles from "./page.module.css";

export default function BriefLoading() {
  return (
    <div className={styles.brief}>
      <div className={styles.brief__hero}>
        <div className={styles.hero}>
          <div className={styles.hero__main}>
            <div style={{ height: 32, width: 200, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }} />
            <div style={{ height: 18, width: 140, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", marginTop: 8 }} />
          </div>
        </div>
      </div>
      <div className={styles.brief__snapshot}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: 72, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
