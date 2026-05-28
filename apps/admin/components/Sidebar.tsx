"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/perms";

const ITEMS: {
  href: string;
  label: string;
  group: "ops" | "growth" | "system";
  // perm omitted on read-only pages everyone can see; set to a role
  // when an item is hidden from lower roles.
  minRole?: Role;
}[] = [
  { href: "/", label: "Overview", group: "ops" },
  { href: "/users", label: "Users", group: "ops" },
  { href: "/syndicates", label: "Syndicates", group: "ops" },
  { href: "/broadcast", label: "Broadcast", group: "ops", minRole: "super-admin" },
  { href: "/tournaments", label: "Tournaments", group: "ops", minRole: "mod" },
  { href: "/fixtures", label: "Fixtures", group: "ops", minRole: "mod" },
  { href: "/content", label: "Content", group: "ops", minRole: "mod" },
  { href: "/affiliate", label: "Affiliate", group: "growth" },
  { href: "/operators", label: "Operators", group: "growth" },
  { href: "/advertisers", label: "Advertisers", group: "growth" },
  { href: "/analytics", label: "Analytics", group: "growth" },
  { href: "/feature-flags", label: "Feature flags", group: "system" },
  { href: "/api-keys", label: "API keys", group: "system", minRole: "super-admin" },
  { href: "/audit-log", label: "Audit log", group: "system" },
  { href: "/system", label: "System health", group: "system" },
  { href: "/settings", label: "Settings", group: "system", minRole: "super-admin" },
];

const ROLE_RANK: Record<Role, number> = { viewer: 0, mod: 1, "super-admin": 2 };

const GROUPS: { id: "ops" | "growth" | "system"; label: string }[] = [
  { id: "ops", label: "Operations" },
  { id: "growth", label: "Growth" },
  { id: "system", label: "System" },
];

export interface SidebarProps {
  email: string;
  role: Role;
}

export function Sidebar({ email, role }: SidebarProps) {
  const pathname = usePathname();
  const visible = ITEMS.filter((it) => !it.minRole || ROLE_RANK[role] >= ROLE_RANK[it.minRole]);

  return (
    <aside
      className="w-60 shrink-0 border-r border-ink-700 bg-ink-800 px-4 py-6 flex flex-col gap-6"
      aria-label="Primary navigation"
    >
      <div>
        <div className="text-lg font-display font-semibold text-ink-50">Tournamental</div>
        <div className="text-xs uppercase tracking-wider text-accent-400">Admin console</div>
      </div>

      <nav className="flex flex-col gap-5 flex-1" aria-label="Sections">
        {GROUPS.map((g) => {
          const items = visible.filter((it) => it.group === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id}>
              <div className="text-[10px] uppercase tracking-widest text-ink-500 mb-2">
                {g.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {items.map((it) => {
                  const active = it.href === "/" ? pathname === "/" : pathname?.startsWith(it.href);
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "block rounded-md px-3 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-accent-700/40 text-ink-50"
                            : "text-ink-200 hover:bg-ink-700 hover:text-ink-50",
                        ].join(" ")}
                      >
                        {it.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-ink-700 pt-4 text-xs text-ink-200">
        <div className="truncate" title={email}>
          {email}
        </div>
        <div className="text-ink-500 capitalize">{role.replace("-", " ")}</div>
        <form action="/api/auth/logout" method="post" className="mt-3">
          <button
            type="submit"
            className="text-accent-400 hover:text-accent-500 text-xs"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
