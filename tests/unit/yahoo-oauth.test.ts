import { afterEach, describe, expect, it } from "vitest";
import { createYahooAuthorizationUrl } from "@/adapters/yahoo/oauth";

const original = {
  clientId: process.env.YAHOO_CLIENT_ID,
  redirectUri: process.env.YAHOO_REDIRECT_URI,
};

afterEach(() => {
  process.env.YAHOO_CLIENT_ID = original.clientId;
  process.env.YAHOO_REDIRECT_URI = original.redirectUri;
});

describe("Yahoo OAuth", () => {
  it("builds an authorization-code URL with state and least-privilege scope", () => {
    process.env.YAHOO_CLIENT_ID = "test-client";
    process.env.YAHOO_REDIRECT_URI = "https://draft.example.com/api/yahoo/callback";

    const url = createYahooAuthorizationUrl("unpredictable-state");

    expect(url.origin + url.pathname).toBe(
      "https://api.login.yahoo.com/oauth2/request_auth",
    );
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://draft.example.com/api/yahoo/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("fspt-r");
    expect(url.searchParams.get("state")).toBe("unpredictable-state");
  });
});
