// @vitest-environment jsdom

/**
 * useUser hook — subscribes to auth state and surfaces the profile.
 *
 * Coverage:
 *   - "unconfigured" status when Supabase env vars are missing.
 *   - "loading" → "guest" transition when getUser returns no user.
 *   - "loading" → "authenticated" transition with a profile row.
 *   - onAuthStateChange callback re-renders the hook.
 *
 * We assign the mock state to `globalThis.__mockSbState` so the
 * `vi.mock` factory (which is hoisted above the imports) can lazily
 * read it. The factory installs a getter on `globalThis` if missing,
 * so the test setup just needs to populate it via `beforeEach`.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

type AuthUser = { id: string; email: string | null; phone: string | null };
type AuthListener = (
  event: string,
  session: { user: AuthUser } | null,
) => void;
interface MockSbState {
  user: AuthUser | null;
  listeners: AuthListener[];
}
interface GlobalWithMock {
  __mockSbState?: MockSbState;
}

vi.mock("@/lib/auth/supabase", () => {
  const profileRow = (id: string) => ({
    id,
    handle: "tim",
    display_name: "Tim",
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    engagement_band: "warm",
    marketing_consent: false,
    analytics_consent: true,
    phone_match_consent: false,
    visit_count: 0,
    updated_at: new Date().toISOString(),
  });
  const getState = (): MockSbState => {
    const g = globalThis as GlobalWithMock;
    if (!g.__mockSbState) g.__mockSbState = { user: null, listeners: [] };
    return g.__mockSbState;
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: getState().user } }),
      onAuthStateChange: (cb: AuthListener) => {
        getState().listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const u = getState().user;
            return {
              data: u ? profileRow(u.id) : null,
              error: null,
            };
          },
        }),
      }),
    }),
  };
  return {
    browserClient: () => client,
    serverActionClient: () => null,
    serviceRoleClient: () => client,
  };
});

vi.mock("@/lib/auth/config", () => ({
  readPublicConfig: () => {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon",
      };
    }
    return null;
  },
  readServerConfig: () => ({
    url: "x",
    anonKey: "x",
    serviceRoleKey: "x",
    phoneHashSalt: "x",
    jwtSecret: "x",
    smsHookSecret: "x",
  }),
  isAuthAvailable: () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
}));

import { useUser } from "@/lib/auth/useUser";

function HookProbe({
  onState,
}: {
  onState: (s: ReturnType<typeof useUser>) => void;
}) {
  const state = useUser();
  React.useEffect(() => {
    onState(state);
  });
  return null;
}

function freshState(): MockSbState {
  const g = globalThis as GlobalWithMock;
  g.__mockSbState = { user: null, listeners: [] };
  return g.__mockSbState;
}

beforeEach(() => {
  freshState();
});

describe("useUser", () => {
  it("returns 'unconfigured' when Supabase env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const states: Array<ReturnType<typeof useUser>> = [];
    render(<HookProbe onState={(s) => states.push(s)} />);
    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last.status).toBe("unconfigured");
    });
  });

  it("returns 'guest' when no user", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const states: Array<ReturnType<typeof useUser>> = [];
    render(<HookProbe onState={(s) => states.push(s)} />);
    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last.status).toBe("guest");
      expect(last.loading).toBe(false);
    });
  });

  it("returns 'authenticated' with profile when signed in", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const s = freshState();
    s.user = { id: "u-1", email: "tim@x.com", phone: null };
    const states: Array<ReturnType<typeof useUser>> = [];
    render(<HookProbe onState={(s2) => states.push(s2)} />);
    await waitFor(() => {
      const last = states[states.length - 1];
      expect(last.status).toBe("authenticated");
      expect(last.user?.id).toBe("u-1");
      expect(last.profile?.handle).toBe("tim");
    });
  });

  it("re-renders when onAuthStateChange fires", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const s = freshState();
    s.user = null;
    const states: Array<ReturnType<typeof useUser>> = [];
    render(<HookProbe onState={(s2) => states.push(s2)} />);
    await waitFor(() => {
      expect(states[states.length - 1].status).toBe("guest");
    });
    expect(s.listeners.length).toBeGreaterThan(0);

    s.user = { id: "u-2", email: "x@y.com", phone: null };
    await act(async () => {
      for (const cb of s.listeners) {
        cb("SIGNED_IN", {
          user: { id: "u-2", email: "x@y.com", phone: null },
        });
      }
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(
      () => {
        const last = states[states.length - 1];
        expect(last.status).toBe("authenticated");
        expect(last.user?.id).toBe("u-2");
      },
      { timeout: 2000 },
    );
  });
});
