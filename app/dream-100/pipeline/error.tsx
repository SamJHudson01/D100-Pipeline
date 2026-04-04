"use client";

import styles from "./page.module.css";

export default function PipelineError({ reset }: { reset: () => void }) {
  return (
    <div className={styles.page}>
      <div className={styles.empty}>
        <p className={`type-body-md ${styles.error__text}`}>
          Failed to load the pipeline board.
        </p>
        <button onClick={reset} className={styles.error__btn}>
          Retry
        </button>
      </div>
    </div>
  );
}
