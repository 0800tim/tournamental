import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GeoMap } from "@/components/GeoMap";

describe("<GeoMap>", () => {
  it("renders the title", () => {
    render(<GeoMap data={[{ country: "NZ", users: 100 }]} />);
    expect(screen.getByText(/Users by country/i)).toBeInTheDocument();
  });

  it("has an aria-label", () => {
    render(<GeoMap data={[]} />);
    expect(screen.getByLabelText(/User distribution by country/i)).toBeInTheDocument();
  });
});
