/**
 * SyndicateForm component test.
 *
 * jsdom doesn't ship fetch, so we stub it to control the responses
 * for the slug-availability check and the create POST.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SyndicateForm } from "@/app/syndicates/new/SyndicateForm";

let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  if (originalFetch) global.fetch = originalFetch;
});

describe("<SyndicateForm />", () => {
  it("renders the core form fields", () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ available: true, reason: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    render(<SyndicateForm />);
    expect(screen.getByLabelText(/Syndicate name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Syndicate URL/i)).toBeTruthy();
    expect(screen.getByLabelText(/Your email/i)).toBeTruthy();
    expect(screen.getByLabelText(/Your phone/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create my syndicate/i }),
    ).toBeTruthy();
  });

  it("auto-derives the slug from the name", () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ available: true, reason: "ok" }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    render(<SyndicateForm />);
    const name = screen.getByLabelText(/Syndicate name/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Dave's Mates" } });
    const slug = screen.getByLabelText(/Syndicate URL/i) as HTMLInputElement;
    expect(slug.value).toBe("dave-s-mates");
  });

  it("disables submit until terms are accepted", () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ available: true, reason: "ok" }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    render(<SyndicateForm />);
    const name = screen.getByLabelText(/Syndicate name/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Dave's Mates" } });
    const btn = screen.getByRole("button", { name: /Create my syndicate/i });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("shows a success card when the POST returns 200", async () => {
    let postCalled = false;
    global.fetch = vi.fn(async (url) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/available")) {
        return new Response(JSON.stringify({ available: true, reason: "ok" }), {
          status: 200,
        });
      }
      postCalled = true;
      return new Response(
        JSON.stringify({
          syndicate_id: "syn-1",
          slug: "daves-mates",
          share_url: "https://play.tournamental.com/s/daves-mates",
          share_guid: "abcdef0123456789",
          ghl_status: "synced",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    render(<SyndicateForm />);
    fireEvent.change(screen.getByLabelText(/Syndicate name/i), {
      target: { value: "Dave's Mates" },
    });
    fireEvent.change(screen.getByLabelText(/Your email/i), {
      target: { value: "dave@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Your phone/i), {
      target: { value: "211234567" },
    });
    // Last checkbox is the terms (after marketing). Click only that one.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[checkboxes.length - 1]!);
    fireEvent.submit(
      screen.getByRole("button", { name: /Create my syndicate/i }).closest("form")!,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Your syndicate is live/i)).toBeTruthy();
    });
    expect(postCalled).toBe(true);
  });

  it("shows a slug error when the POST returns 409 reserved", async () => {
    global.fetch = vi.fn(async (url) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/available")) {
        return new Response(JSON.stringify({ available: true, reason: "ok" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: "slug_unavailable",
          reason: "reserved",
          message: "That name is reserved.",
        }),
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    render(<SyndicateForm />);
    fireEvent.change(screen.getByLabelText(/Syndicate name/i), {
      target: { value: "Admin Pool" },
    });
    fireEvent.change(screen.getByLabelText(/Your email/i), {
      target: { value: "x@y.com" },
    });
    fireEvent.change(screen.getByLabelText(/Your phone/i), {
      target: { value: "211234567" },
    });
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[checkboxes.length - 1]!);
    fireEvent.submit(
      screen.getByRole("button", { name: /Create my syndicate/i }).closest("form")!,
    );

    await waitFor(() => {
      expect(screen.queryByText(/reserved/i)).toBeTruthy();
    });
  });
});
