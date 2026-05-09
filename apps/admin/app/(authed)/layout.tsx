import { Sidebar } from "@/components/Sidebar";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // requireAuth() is an async server-side helper that redirects to
  // /login if there is no valid session. It runs before any of the
  // child server components fetch data, so unauthenticated users
  // never see admin content.
  const session = await requireAuth();
  return (
    <div className="flex min-h-screen">
      <Sidebar email={session.email} role={session.role} />
      <main className="flex-1 p-6 overflow-x-hidden">{children}</main>
    </div>
  );
}
