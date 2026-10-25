import { describe, expect, it, vi } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { Route } from "@/routes/_authenticated/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser } },
}));
const guard = Route.options.beforeLoad as () => Promise<{ user: { id: string } }>;

describe("Protected route guard (mock Auth)", () => {
  it("redirects a signed-out user to /auth", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    let caught: unknown;
    try {
      await guard();
    } catch (error) {
      caught = error;
    }
    expect(isRedirect(caught)).toBe(true);
    if (isRedirect(caught)) expect(caught.options.to).toBe("/auth");
  });
  it("returns the verified user as route context", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null });
    expect(await guard()).toEqual({ user: { id: "verified" } });
  });
});
