import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RevealPii } from "@/components/RevealPii";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("<RevealPii>", () => {
  it("shows the masked value and a Show button by default", () => {
    render(<RevealPii userId="u_42" kind="email" masked="us***@example.test" />);
    expect(screen.getByText("us***@example.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show email \(this is logged\)/ })).toBeInTheDocument();
  });

  it("renders a dash when there is no value, with no button", () => {
    render(<RevealPii userId="u_42" kind="phone" masked="" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("posts the kind to the reveal route and swaps in the full value, then can hide it", async () => {
    const user = userEvent.setup();
    const f = fetchReturning({ ok: true, kind: "email", value: "user42@example.test" });
    render(<RevealPii userId="u_42" kind="email" masked="us***@example.test" fetchImpl={f} />);
    await user.click(screen.getByRole("button", { name: /Show email/ }));
    await waitFor(() => expect(screen.getByText("user42@example.test")).toBeInTheDocument());
    expect(f).toHaveBeenCalledWith("/api/users/u_42/reveal", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "email" }) }));
    await user.click(screen.getByRole("button", { name: /Hide email/ }));
    expect(screen.getByText("us***@example.test")).toBeInTheDocument();
  });

  it("uses a custom reveal URL when given", async () => {
    const user = userEvent.setup();
    const f = fetchReturning({ ok: true, kind: "phone", value: "+6421535832" });
    render(<RevealPii userId="hl1" kind="phone" masked="+64****5832" revealUrl="/api/highlevel/contacts/hl1/reveal" fetchImpl={f} />);
    await user.click(screen.getByRole("button", { name: /Show phone/ }));
    await waitFor(() => expect(screen.getByText("+6421535832")).toBeInTheDocument());
    expect(f).toHaveBeenCalledWith("/api/highlevel/contacts/hl1/reveal", expect.anything());
  });

  it("keeps the mask and reports when the route refuses", async () => {
    const user = userEvent.setup();
    const f = fetchReturning({ error: "forbidden" }, 403);
    render(<RevealPii userId="u_42" kind="email" masked="us***@example.test" fetchImpl={f} />);
    await user.click(screen.getByRole("button", { name: /Show email/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("us***@example.test")).toBeInTheDocument();
  });
});
