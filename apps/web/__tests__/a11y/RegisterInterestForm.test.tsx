/**
 * Accessibility contract for the hub register-interest form: every
 * field labelled, errors announced and tied to their field, the
 * honeypot invisible to assistive tech, focus moved to the thank-you
 * state, and new-tab links saying so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "./intl";
import { RegisterInterestForm, fieldFor } from "@/app/hub/RegisterInterestForm";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const props = { tournamentName: "Rugby World Cup 2027™", defaultCountry: "NZ", inviteBase: "https://play.tournamental.com" };

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RegisterInterestForm, labels", () => {
  it("labels every visible field and marks the required ones", () => {
    render(<RegisterInterestForm {...props} />);
    expect(screen.getByLabelText("First name")).toBeTruthy();
    expect(screen.getByLabelText("Country")).toBeTruthy();
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.required).toBe(true);
    expect(email.getAttribute("aria-required")).toBe("true");
    expect(screen.getByLabelText(/Mobile/)).toBeTruthy();
    const consent = screen.getByLabelText(/Email me when/) as HTMLInputElement;
    expect(consent.type).toBe("checkbox");
    expect(consent.getAttribute("aria-required")).toBe("true");
  });

  it("explains the two-letter country field to screen readers", () => {
    render(<RegisterInterestForm {...props} />);
    const country = screen.getByLabelText("Country");
    const hintId = country.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)?.textContent).toMatch(/two-letter country code/i);
  });

  it("keeps the honeypot out of the tab order and out of the accessibility tree", () => {
    const { container } = render(<RegisterInterestForm {...props} />);
    const hp = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(hp.tabIndex).toBe(-1);
    expect(hp.closest('[aria-hidden="true"]')).not.toBeNull();
    // Excluded from the accessibility tree: no textbox named Website is exposed.
    expect(screen.queryByRole("textbox", { name: "Website" })).toBeNull();
  });

  it("has a submit button with a clear name", () => {
    render(<RegisterInterestForm {...props} />);
    expect(screen.getByRole("button", { name: "Register my interest" })).toBeTruthy();
  });
});

describe("RegisterInterestForm, errors", () => {
  it("announces an email error and ties it to the email field", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ ok: false, error: "email_invalid" }, 400));
    const { container } = render(<RegisterInterestForm {...props} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByLabelText(/Email me when/));
    fireEvent.submit(container.querySelector("form")!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/email does not look right/i);
    const email = screen.getByLabelText("Email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(alert.id);
    // The other fields are not blamed.
    expect(screen.getByLabelText(/Mobile/).getAttribute("aria-invalid")).toBeNull();
  });

  it("ties a phone error to the phone field and a consent error to the checkbox", () => {
    expect(fieldFor("phone_invalid")).toBe("phone");
    expect(fieldFor("consent_required")).toBe("consent");
    expect(fieldFor("rate_limited")).toBeNull();
    expect(fieldFor(undefined)).toBeNull();
  });

  it("marks the submit button busy while the request is in flight", async () => {
    let resolve: (r: Response) => void = () => {};
    vi.spyOn(global, "fetch").mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    const { container } = render(<RegisterInterestForm {...props} />);
    fireEvent.submit(container.querySelector("form")!);
    const btn = await screen.findByRole("button", { name: /Registering/ });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    resolve(jsonResponse({ ok: false, error: "store_failed" }, 500));
    await screen.findByRole("alert");
  });
});

describe("RegisterInterestForm, thank-you state", () => {
  it("moves focus to the heading, announces the state and labels the new-tab links", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, invite_code: "abc1234", invite_url: "https://play.tournamental.com/i/abc1234", referrals: 2 }),
    );
    const { container } = render(<RegisterInterestForm {...props} />);
    fireEvent.submit(container.querySelector("form")!);
    const heading = await screen.findByRole("heading", { name: "Now bring your crew." });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: /Share on WhatsApp \(opens in a new tab\)/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Telegram \(opens in a new tab\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy your invite link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More ways to share your invite link" })).toBeTruthy();
    expect(screen.getByText(/Friends joined through your link so far/).textContent).toContain("2");
  });
});
