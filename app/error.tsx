"use client";

export default function GlobalError({
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
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        style={{
          padding: "var(--space-3) var(--space-6)",
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
    </div>
  );
}
