import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "";
  });

  it("renders the brand heading", () => {
    render(<LoginPage searchParams={{}} />);
    expect(screen.getByText("Tournamental Admin")).toBeInTheDocument();
  });

  it("warns when login is disabled (empty ADMIN_EMAILS)", () => {
    process.env.ADMIN_EMAILS = "";
    render(<LoginPage searchParams={{}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/login is disabled/i);
  });

  it("does not warn when ADMIN_EMAILS is set", () => {
    process.env.ADMIN_EMAILS = "tim@tournamental.com";
    render(<LoginPage searchParams={{}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a sent confirmation when sent=1", () => {
    process.env.ADMIN_EMAILS = "tim@tournamental.com";
    render(<LoginPage searchParams={{ sent: "1" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/sign-in link/i);
  });

  it("shows error for expired link", () => {
    process.env.ADMIN_EMAILS = "tim@tournamental.com";
    render(<LoginPage searchParams={{ error: "expired" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
  });
});
