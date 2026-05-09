import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
}));

import { Sidebar } from "@/components/Sidebar";

describe("<Sidebar>", () => {
  it("renders the brand and user info", () => {
    render(<Sidebar email="tim@vtourn.com" role="super-admin" />);
    expect(screen.getByText("VTourn")).toBeInTheDocument();
    expect(screen.getByText("tim@vtourn.com")).toBeInTheDocument();
    expect(screen.getByText(/super admin/i)).toBeInTheDocument();
  });

  it("highlights the active route", () => {
    render(<Sidebar email="t@v.com" role="super-admin" />);
    const usersLink = screen.getByRole("link", { name: "Users" });
    expect(usersLink).toHaveAttribute("aria-current", "page");
  });

  it("hides super-admin-only items from a viewer", () => {
    render(<Sidebar email="v@v.com" role="viewer" />);
    expect(screen.queryByRole("link", { name: "API keys" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("hides mod+ items from a viewer", () => {
    render(<Sidebar email="v@v.com" role="viewer" />);
    expect(screen.queryByRole("link", { name: "Tournaments" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Content" })).toBeNull();
  });

  it("shows mod-level items to a mod", () => {
    render(<Sidebar email="m@v.com" role="mod" />);
    expect(screen.getByRole("link", { name: "Tournaments" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Content" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "API keys" })).toBeNull();
  });

  it("renders sign-out form", () => {
    render(<Sidebar email="t@v.com" role="super-admin" />);
    expect(screen.getByRole("button", { name: /Sign out/i })).toBeInTheDocument();
  });
});
