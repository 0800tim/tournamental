import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-xs uppercase tracking-wider text-accent-400 mb-2">
          404
        </div>
        <h1 className="text-2xl font-display font-semibold mb-2">Not found</h1>
        <p className="text-sm text-ink-200 mb-4">
          That admin page doesn't exist. It may have been renamed.
        </p>
        <Link href="/" className="text-accent-400 hover:underline text-sm">
          Back to overview →
        </Link>
      </div>
    </div>
  );
}
