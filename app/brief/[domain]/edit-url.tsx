"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import styles from "./page.module.css";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles["edit-url__btn"]} disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function EditableUrl({
  domain,
  currentUrl,
  saveAction,
}: {
  domain: string;
  currentUrl: string | null;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span className={styles["edit-url"]}>
        {currentUrl ? (
          <a
            href={currentUrl.startsWith("http") ? currentUrl : `https://${currentUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.hero__domain}
          >
            {(() => {
              try { return new URL(currentUrl.startsWith("http") ? currentUrl : `https://${currentUrl}`).hostname; }
              catch { return domain; }
            })()} ↗
          </a>
        ) : (
          <span className={styles["hero__domain"]} style={{ opacity: 0.5 }}>
            {domain}
          </span>
        )}
        <button
          type="button"
          className={styles["edit-url__edit-btn"]}
          onClick={() => setEditing(true)}
          title="Edit URL"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <form
      className={styles["edit-url__form"]}
      action={async (formData) => {
        await saveAction(formData);
        setEditing(false);
      }}
    >
      <input
        name="url"
        type="url"
        defaultValue={currentUrl ?? `https://${domain}`}
        placeholder="https://example.com"
        className={styles["edit-url__input"]}
        autoFocus
        required
      />
      <SaveButton />
      <button
        type="button"
        className={styles["edit-url__btn"]}
        onClick={() => setEditing(false)}
      >
        Cancel
      </button>
    </form>
  );
}
