/**
 * Pages-router _error shim. The admin app routes everything through
 * the app router, but Next 14.2 prerenders /_error during the build
 * and uses its default class-component which imports `<Html>` from
 * `next/document`. We override with a tiny functional component that
 * doesn't pull in `next/document`.
 *
 * The real not-found / error UI lives in `app/not-found.tsx` and
 * `app/error.tsx`.
 */

interface ErrorProps {
  statusCode?: number;
}

function ErrorPage({ statusCode }: ErrorProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0e1a",
        color: "#e7ecf7",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1>{statusCode ?? "Error"}</h1>
        <p>Something went wrong.</p>
      </div>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: { res?: { statusCode?: number }; err?: { statusCode?: number } }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default ErrorPage;
