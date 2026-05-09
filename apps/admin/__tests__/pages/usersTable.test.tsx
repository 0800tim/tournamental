import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsersTable } from "@/app/(authed)/users/UsersTable";
import type { UserRow } from "@/lib/api";

const ROWS: UserRow[] = [
  {
    id: "u_1",
    display_name: "Alice",
    email: "a@x.com",
    country: "NZ",
    humanness: 80,
    joined_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    predictions_count: 5,
    status: "active",
  },
  {
    id: "u_2",
    display_name: "Bob",
    email: "b@x.com",
    country: "AU",
    humanness: 30,
    joined_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    predictions_count: 1,
    status: "banned",
  },
];

describe("<UsersTable>", () => {
  beforeEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch;
  });

  it("shows Ban for active users with mod role", () => {
    render(<UsersTable initial={ROWS} role="mod" />);
    expect(screen.getByRole("button", { name: /^Ban$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unban/ })).toBeInTheDocument();
  });

  it("hides ban controls for viewer role", () => {
    render(<UsersTable initial={ROWS} role="viewer" />);
    expect(screen.queryByRole("button", { name: /Ban/i })).toBeNull();
  });

  it("opens ban dialog and posts to /api/users/:id/ban on confirm", async () => {
    const user = userEvent.setup();
    render(<UsersTable initial={ROWS} role="mod" />);
    fireEvent.click(screen.getByRole("button", { name: /^Ban$/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "fraud abuse");
    await user.click(screen.getByRole("button", { name: /Ban user/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/users/u_1/ban",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("calls /unban when clicking Unban", async () => {
    render(<UsersTable initial={ROWS} role="mod" />);
    fireEvent.click(screen.getByRole("button", { name: /Unban/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/users/u_2/unban",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
