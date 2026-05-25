"use client";

/**
 * JoinFlowClient — the client state machine behind /s/[guid]/join.
 *
 * STUB: the full sign-in -> onboarding -> payment flow is built in a
 * follow-up. For now it renders a minimal branded shell so the route
 * compiles and resolves; do not ship to prod until the flow is complete.
 */

export interface JoinFlowClientProps {
  readonly slug: string;
  readonly initialName: string;
}

export function JoinFlowClient({ slug, initialName }: JoinFlowClientProps): JSX.Element {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e0e12",
        color: "#e7ecf7",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 20,
        textAlign: "center",
      }}
    >
      <div>
        <p style={{ color: "#fbbf24", letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 12 }}>
          Join
        </p>
        <h1 style={{ fontSize: 24, margin: "8px 0" }}>{initialName}</h1>
        <p style={{ color: "#9aa6c2" }}>Sign-in and onboarding for {slug} is being set up.</p>
      </div>
    </main>
  );
}
