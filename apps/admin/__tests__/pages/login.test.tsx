import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  beforeEach(() => {
    process.env.ADMIN_PHONE_E164 = "";
    process.env.ADMIN_ALLOWED_USER_IDS = "";
  });

  it("renders the brand heading", () => {
    render(<LoginPage searchParams={{}} />);
    expect(screen.getByText("Tournamental Admin")).toBeInTheDocument();
  });

  it("warns when login is disabled (no phone / allowlist)", () => {
    render(<LoginPage searchParams={{}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/login is disabled/i);
  });

  it("does not warn when both phone and allowlist are set", () => {
    process.env.ADMIN_PHONE_E164 = "+6421535832";
    process.env.ADMIN_ALLOWED_USER_IDS = "u_test_tim";
    render(<LoginPage searchParams={{}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows error for expired session", () => {
    process.env.ADMIN_PHONE_E164 = "+6421535832";
    process.env.ADMIN_ALLOWED_USER_IDS = "u_test_tim";
    render(<LoginPage searchParams={{ error: "expired" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
  });
});
