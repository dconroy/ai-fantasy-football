import { describe, expect, it } from "vitest";
import { yahooGuidFromTokens } from "@/adapters/yahoo/oauth";

describe("yahooGuidFromTokens", () => {
  it("prefers xoauth_yahoo_guid", () => {
    expect(
      yahooGuidFromTokens({
        access_token: "opaque-token",
        expires_in: 3600,
        xoauth_yahoo_guid: "GUID123",
      }),
    ).toBe("GUID123");
  });

  it("reads JWT sub when guid is absent", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "jwt-sub" })).toString("base64url");
    expect(
      yahooGuidFromTokens({
        access_token: `hdr.${payload}.sig`,
        expires_in: 3600,
      }),
    ).toBe("jwt-sub");
  });
});
