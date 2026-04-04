import styles from "./page.module.css";

export default function PipelineLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.page__header}>
        <div className={styles.skeleton__title} />
      </div>
      <div className={styles.skeleton__board}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.skeleton__column}>
            <div className={styles.skeleton__columnHeader} />
            {Array.from({ length: i < 2 ? 3 : i < 4 ? 1 : 0 }).map((_, j) => (
              <div key={j} className={styles.skeleton__card} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
