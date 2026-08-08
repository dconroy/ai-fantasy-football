import { describe, expect, it } from "vitest";

import {
  normalizePlayerName,
  normalizeTeam,
  resolvePlayerIdentity,
  type Player,
} from "../../src/domain";

const players: readonly Player[] = [
  {
    id: "aj-brown",
    name: "A.J. Brown",
    position: "WR",
    team: "PHI",
    aliases: ["Arthur Juan Brown"],
  },
  {
    id: "gabe-davis-buf",
    name: "Gabriel Davis",
    position: "WR",
    team: "BUF",
    aliases: ["Gabe Davis"],
  },
  {
    id: "gabe-davis-jax",
    name: "Gabe Davis",
    position: "WR",
    team: "JAX",
  },
  {
    id: "sf-def",
    name: "San Francisco 49ers",
    position: "DEF",
    team: "SF",
  },
  {
    id: "nyj-def",
    name: "New York Jets",
    position: "DEF",
    team: "NYJ",
  },
];

describe("identity normalization", () => {
  it("normalizes initials, punctuation, accents, and suffixes", () => {
    expect(normalizePlayerName("A.J. Brown Jr.")).toBe("aj brown");
    expect(normalizePlayerName("A-J Brown, II")).toBe("aj brown");
    expect(normalizePlayerName("A. J. Brown")).toBe("aj brown");
    expect(normalizePlayerName("José O’Connell Sr")).toBe("jose oconnell");
  });

  it("normalizes canonical, historical, and city team names", () => {
    expect(normalizeTeam("San Francisco 49ers")).toBe("SF");
    expect(normalizeTeam("SFO")).toBe("SF");
    expect(normalizeTeam("Oakland Raiders")).toBe("LV");
  });
});

describe("player identity resolution", () => {
  it("resolves punctuation variants and explicit aliases", () => {
    expect(resolvePlayerIdentity("AJ Brown Jr.", players)).toMatchObject({
      status: "resolved",
      player: { id: "aj-brown" },
      matchedBy: "name",
    });
    expect(resolvePlayerIdentity("Arthur Juan Brown", players)).toMatchObject({
      status: "resolved",
      player: { id: "aj-brown" },
      matchedBy: "alias",
    });
  });

  it("resolves defense names, abbreviations, and D/ST labels", () => {
    expect(resolvePlayerIdentity("49ers D/ST", players)).toMatchObject({
      status: "resolved",
      player: { id: "sf-def" },
      matchedBy: "defense",
    });
    expect(resolvePlayerIdentity("NY Jets Defense", players)).toMatchObject({
      status: "resolved",
      player: { id: "nyj-def" },
    });
  });

  it("never silently chooses duplicate or alias-colliding identities", () => {
    const result = resolvePlayerIdentity("Gabe Davis", players);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        "gabe-davis-buf",
        "gabe-davis-jax",
      ]);
    }
  });

  it("uses team context to disambiguate and reports misses", () => {
    expect(resolvePlayerIdentity("Gabe Davis", players, { team: "Buffalo" })).toMatchObject({
      status: "resolved",
      player: { id: "gabe-davis-buf" },
    });
    expect(resolvePlayerIdentity("Unknown Player", players)).toEqual({
      status: "notFound",
      normalizedQuery: "unknown player",
    });
  });
});
