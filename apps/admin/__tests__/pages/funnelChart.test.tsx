import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FunnelChart } from "@/app/(authed)/analytics/FunnelChart";

describe("<FunnelChart>", () => {
  it("renders without crashing on a populated dataset", () => {
    const { container } = render(
      <FunnelChart
        steps={[
          { step: "page_view", users: 100 },
          { step: "user_signup", users: 50 },
        ]}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with empty data", () => {
    const { container } = render(<FunnelChart steps={[]} />);
    expect(container.firstChild).toBeTruthy();
  });
});
