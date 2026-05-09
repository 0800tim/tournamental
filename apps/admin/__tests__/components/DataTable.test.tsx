import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";

interface Row {
  name: string;
  age: number;
}

const ROWS: Row[] = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Carol", age: 35 },
];

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "age", header: "Age" },
];

describe("<DataTable>", () => {
  it("renders all rows by default", () => {
    render(<DataTable data={ROWS} columns={COLUMNS} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("renders empty message when no rows", () => {
    render(
      <DataTable data={[]} columns={COLUMNS} emptyMessage="Nothing here yet." />,
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("filters via search when searchKeys is set", async () => {
    const user = userEvent.setup();
    render(<DataTable data={ROWS} columns={COLUMNS} searchKeys={["name"]} />);
    const search = screen.getByLabelText("Search table");
    await user.type(search, "ali");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
  });

  it("sorts when a header button is clicked", async () => {
    const { container } = render(<DataTable data={ROWS} columns={COLUMNS} />);
    const ageHeader = screen.getByRole("button", { name: /Age/i });

    // Click cycles: none -> sorted (one direction) -> reversed -> none.
    // After one click, the first body row should change from the
    // input order; after a second click it's the opposite extreme.
    const before = container.querySelectorAll("tbody tr")[0].textContent ?? "";
    fireEvent.click(ageHeader);
    const afterFirst = container.querySelectorAll("tbody tr")[0].textContent ?? "";
    fireEvent.click(ageHeader);
    const afterSecond = container.querySelectorAll("tbody tr")[0].textContent ?? "";
    // At least one click must change the order.
    expect([afterFirst, afterSecond]).toEqual(
      expect.arrayContaining([expect.stringMatching(/Bob/)]),
    );
    // And the two sort directions yield different first rows.
    expect(afterFirst).not.toEqual(afterSecond);
    expect(before).toMatch(/Alice/);
  });

  it("paginates when more than initialPageSize rows", async () => {
    const many: Row[] = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}`, age: i }));
    render(<DataTable data={many} columns={COLUMNS} initialPageSize={5} />);
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });
});
