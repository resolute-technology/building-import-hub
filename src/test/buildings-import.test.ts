import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  MAX_BASE64_LENGTH,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  parseBuildings,
} from "../../supabase/functions/_shared/buildings";
import {
  MAX_FILE_BYTES as CLIENT_MAX_FILE_BYTES,
  TEMPLATE_COLUMNS,
} from "@/lib/buildings-template";
import { createImportHandler } from "../../supabase/functions/import-buildings/handler";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), insert: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

function spreadsheet(rows: unknown[][], bookType: XLSX.BookType = "xlsx") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Buildings");
  return XLSX.write(book, { type: "base64", bookType }) as string;
}
const validFile = () =>
  spreadsheet([
    [...TEMPLATE_COLUMNS],
    ["Example Tower", "1 Main St", "Athens", "Greece", 12, 1998],
  ]);

describe("Excel parsing", () => {
  it.each(["xlsx", "xls", "csv"] as const)("preserves the template in %s format", (format) => {
    const result = parseBuildings(
      spreadsheet([[...TEMPLATE_COLUMNS], [" Tower ", " A ", " B ", " C ", 12, 1998]], format),
      "owner",
    );
    expect(result).toEqual({
      rows: [
        {
          user_id: "owner",
          name: "Tower",
          address: "A",
          city: "B",
          country: "C",
          floors: 12,
          year_built: 1998,
        },
      ],
      skipped: 0,
    });
  });
  it("normalizes headers, skips unnamed rows and preserves integer conversion", () => {
    const result = parseBuildings(
      spreadsheet([
        [" Name ", "Year Built", "floors"],
        ["Tower", "1998", 2.9],
        [null, 2000, 3],
      ]),
      "owner",
    );
    expect(result.skipped).toBe(1);
    expect(result.rows[0]).toMatchObject({ name: "Tower", year_built: 1998, floors: 2 });
  });
  it("does not accept an uploaded owner", () => {
    expect(
      parseBuildings(
        spreadsheet([
          ["name", "user_id"],
          ["Tower", "attacker"],
        ]),
        "verified",
      ).rows[0]?.user_id,
    ).toBe("verified");
  });
  it.each([undefined, "", "!!!=", "a", "a".repeat(MAX_BASE64_LENGTH + 4)])(
    "rejects invalid or oversized base64 (%#)",
    (value) => {
      expect(() => parseBuildings(value, "owner")).toThrow();
    },
  );
  it("rejects missing name headers and integer overflow", () => {
    expect(() => parseBuildings(spreadsheet([["wrong"], ["Tower"]]), "owner")).toThrow(
      /name column/,
    );
    expect(() =>
      parseBuildings(
        spreadsheet([
          ["name", "floors"],
          ["Tower", 2147483648],
        ]),
        "owner",
      ),
    ).toThrow(/integer/);
  });
  it("accepts 1000 rows and rejects 1001 before inserting anything", () => {
    const rows = Array.from({ length: 1000 }, () => ["Tower"]);
    expect(parseBuildings(spreadsheet([["name"], ...rows]), "owner").rows).toHaveLength(1000);
    expect(() => parseBuildings(spreadsheet([["name"], ...rows, ["overflow"]]), "owner")).toThrow(
      /1000/,
    );
  });
  it("rejects oversized text and excessive columns", () => {
    expect(() => parseBuildings(spreadsheet([["name"], ["x".repeat(2001)]]), "owner")).toThrow(
      /2000/,
    );
    expect(() =>
      parseBuildings(spreadsheet([["name", ...Array(64).fill("extra")], ["Tower"]]), "owner"),
    ).toThrow(/64 columns/);
  });
  it("keeps the frontend and backend file limits aligned", () =>
    expect(CLIENT_MAX_FILE_BYTES).toBe(MAX_FILE_BYTES));
});

describe("Import HTTP handler (mock Auth and database)", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_test"}',
  };
  const handler = createImportHandler((name) => env[name]);
  const request = (body: unknown = { fileBase64: validFile() }, headers = {}) =>
    new Request("https://example.test/import", {
      method: "POST",
      headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
      from: () => ({ insert: mocks.insert }),
    });
  });
  it("answers preflight and rejects unsupported methods", async () => {
    expect(
      (await handler(new Request("https://example.test", { method: "OPTIONS" }))).headers.get(
        "Access-Control-Allow-Methods",
      ),
    ).toContain("POST");
    expect((await handler(new Request("https://example.test"))).status).toBe(405);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects missing or invalid authentication before parsing uploads", async () => {
    expect((await handler(request({}, { Authorization: "" }))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("bad token") });
    expect((await handler(request())).status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("inserts with the caller JWT, verified owner, and public key", async () => {
    const res = await handler(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1, skipped: 0 });
    expect(mocks.getUser).toHaveBeenCalledWith("user-jwt");
    expect(mocks.createClient).toHaveBeenCalledWith(
      env["SUPABASE_URL"],
      "sb_publishable_test",
      expect.objectContaining({ global: { headers: { Authorization: "Bearer user-jwt" } } }),
    );
    expect(mocks.insert.mock.calls[0]?.[0][0].user_id).toBe("verified-user");
  });
  it("reports all skipped rows without making an empty insert", async () => {
    const res = await handler(
      request({
        fileBase64: spreadsheet([
          ["name", "city"],
          [null, "Athens"],
        ]),
      }),
    );
    expect(await res.json()).toEqual({ inserted: 0, skipped: 1 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects oversized bodies, wrong content types and malformed JSON", async () => {
    expect(
      (await handler(request({}, { "Content-Length": String(MAX_BODY_BYTES + 1) }))).status,
    ).toBe(400);
    expect((await handler(request({}, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect(
      (
        await handler(
          new Request("https://example.test", {
            method: "POST",
            headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies even without Content-Length", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
        controller.close();
      },
    });
    const req = new Request("https://example.test", {
      method: "POST",
      body,
      duplex: "half",
      headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    } as RequestInit);
    expect((await handler(req)).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not expose database errors or return success on failure", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "sensitive internal detail" } });
    const res = await handler(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Database import failed" });
  });
  it("contains invalid configuration errors", async () => {
    const res = await createImportHandler(() => "{broken")(request());
    expect(res.status).toBe(500);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
