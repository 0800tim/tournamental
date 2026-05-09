import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BanDialog } from "@/components/BanDialog";

describe("<BanDialog>", () => {
  it("shows the user id and display name", () => {
    render(
      <BanDialog
        userId="u_42"
        displayName="Aroha Walker"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Aroha Walker")).toBeInTheDocument();
    expect(screen.getByText("u_42")).toBeInTheDocument();
  });

  it("disables the Ban button until reason is at least 3 chars", async () => {
    const user = userEvent.setup();
    render(
      <BanDialog userId="u_1" displayName="X" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const ban = screen.getByRole("button", { name: /Ban user/i });
    expect(ban).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "ab");
    expect(ban).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "c");
    expect(ban).not.toBeDisabled();
  });

  it("calls onConfirm with the trimmed reason", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <BanDialog userId="u_1" displayName="X" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    await user.type(screen.getByRole("textbox"), "  fraud  ");
    await user.click(screen.getByRole("button", { name: /Ban user/i }));
    expect(onConfirm).toHaveBeenCalledWith("fraud");
  });

  it("calls onCancel when Cancel clicked", () => {
    const onCancel = vi.fn();
    render(
      <BanDialog userId="u_1" displayName="X" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("uses an aria-modal dialog role", () => {
    render(
      <BanDialog userId="u_1" displayName="X" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
