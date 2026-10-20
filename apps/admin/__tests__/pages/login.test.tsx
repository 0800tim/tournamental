import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import LoginPage from "@/app/login/page";

// LoginPage is an async server component; React cannot render the
// promise it returns as a child, so resolve it first.
async function renderLogin(searchParams: Record<string, string>) {
  const tree = await LoginPage({ searchParams: Promise.resolve(searchParams) });
  return render(tree);
}

describe("LoginPage", () => {
  beforeEach(() => {
    process.env.ADMIN_PHONE_E164 = "";
    process.env.ADMIN_ALLOWED_USER_IDS = "";
  });

  it("renders the brand heading", async () => {
    await renderLogin({});
    expect(screen.getByText("Tournamental Admin")).toBeInTheDocument();
  });

  it("warns when login is disabled (no phone / allowlist)", async () => {
    await renderLogin({});
    expect(screen.getByRole("alert")).toHaveTextContent(/login is disabled/i);
  });

  it("does not warn when both phone and allowlist are set", async () => {
    process.env.ADMIN_PHONE_E164 = "+6421535832";
    process.env.ADMIN_ALLOWED_USER_IDS = "u_test_tim";
    await renderLogin({});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows error for expired session", async () => {
    process.env.ADMIN_PHONE_E164 = "+6421535832";
    process.env.ADMIN_ALLOWED_USER_IDS = "u_test_tim";
    await renderLogin({ error: "expired" });
    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
  });
});
