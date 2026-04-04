"use client";

export default function ResearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        gap: "var(--space-4)",
        padding: "var(--space-7)",
      }}
    >
      <h2 className="type-heading-lg">Something went wrong</h2>
      <p className="type-body-md" style={{ color: "var(--text-secondary)" }}>
        {error.message || "Could not load research data."}
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <button
          onClick={reset}
          style={{
            padding: "var(--space-2) var(--space-5)",
            background: "var(--accent-amber)",
            color: "#0D0F0E",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="javascript:history.back()"
          style={{
            padding: "var(--space-2) var(--space-5)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            fontSize: 14,
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          ← Back to Brief
        </a>
      </div>
    </div>
  );
}
