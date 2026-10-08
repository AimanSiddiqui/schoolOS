import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppWorkspace } from "./app-workspace";

vi.mock("./auth-workspace", () => ({
  AuthWorkspace: () => <div>Access module mounted</div>,
}));

vi.mock("./school-setup-workspace", () => ({
  SchoolSetupWorkspace: () => <div>Academics module mounted</div>,
}));

vi.mock("./attendance-workspace", () => ({
  AttendanceWorkspace: () => <div>Attendance module mounted</div>,
}));

describe("AppWorkspace", () => {
  it("shows one primary module at a time", async () => {
    const user = userEvent.setup();

    render(<AppWorkspace />);

    expect(screen.getByText("Access module mounted")).toBeInTheDocument();
    expect(screen.queryByText("Academics module mounted")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance module mounted")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Academics/ }));

    expect(screen.queryByText("Access module mounted")).not.toBeInTheDocument();
    expect(screen.getByText("Academics module mounted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Attendance/ }));

    expect(screen.queryByText("Academics module mounted")).not.toBeInTheDocument();
    expect(screen.getByText("Attendance module mounted")).toBeInTheDocument();
  });
});
