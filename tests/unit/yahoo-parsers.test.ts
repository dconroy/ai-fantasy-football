import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import {
  parseLeagueMeta,
  parseLeaguePlayers,
  parseRoster,
  parseScoreboard,
  parseStandings,
  parseTeams,
  parseTransactions,
} from "@/adapters/yahoo/parsers";

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

function parse(xml: string) {
  return parser.parse(xml);
}

describe("parseTeams", () => {
  it("extracts team keys and flags the signed-in manager's team", () => {
    const body = parse(`
      <fantasy_content><league><teams count="2">
        <team>
          <team_key>461.l.1.t.1</team_key><name>Cobra Kai</name>
          <is_owned_by_current_login>1</is_owned_by_current_login>
          <managers><manager><nickname>Dave</nickname></manager></managers>
        </team>
        <team>
          <team_key>461.l.1.t.2</team_key><name>Eagle Fang</name>
        </team>
      </teams></league></fantasy_content>`);
    const teams = parseTeams(body);
    expect(teams).toHaveLength(2);
    expect(teams[0]).toMatchObject({
      teamKey: "461.l.1.t.1",
      name: "Cobra Kai",
      isMine: true,
      managerNickname: "Dave",
    });
    expect(teams[1].isMine).toBe(false);
  });
});

describe("parseRoster", () => {
  it("extracts selected positions, injury status, and bye weeks", () => {
    const body = parse(`
      <fantasy_content><team><roster><players count="2">
        <player>
          <player_key>461.p.100</player_key>
          <name><full>Bijan Robinson</full></name>
          <editorial_team_abbr>Atl</editorial_team_abbr>
          <bye_weeks><week>5</week></bye_weeks>
          <display_position>RB</display_position>
          <status>Q</status><status_full>Questionable</status_full>
          <selected_position><position>RB</position></selected_position>
        </player>
        <player>
          <player_key>461.p.200</player_key>
          <name><full>Backup Guy</full></name>
          <editorial_team_abbr>Phi</editorial_team_abbr>
          <bye_weeks><week>9</week></bye_weeks>
          <display_position>WR</display_position>
          <selected_position><position>BN</position></selected_position>
        </player>
      </players></roster></team></fantasy_content>`);
    const roster = parseRoster(body);
    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({
      playerKey: "461.p.100",
      name: "Bijan Robinson",
      team: "ATL",
      position: "RB",
      selectedPosition: "RB",
      status: "Q",
      byeWeek: 5,
    });
    expect(roster[1].selectedPosition).toBe("BN");
    expect(roster[1].status).toBeUndefined();
  });
});

describe("parseStandings", () => {
  it("returns rows sorted by rank with records and points", () => {
    const body = parse(`
      <fantasy_content><league><standings><teams count="2">
        <team>
          <team_key>461.l.1.t.2</team_key><name>Eagle Fang</name>
          <team_standings>
            <rank>2</rank>
            <outcome_totals><wins>5</wins><losses>8</losses><ties>0</ties></outcome_totals>
            <points_for>1200.5</points_for><points_against>1250</points_against>
          </team_standings>
        </team>
        <team>
          <team_key>461.l.1.t.1</team_key><name>Cobra Kai</name>
          <team_standings>
            <rank>1</rank>
            <outcome_totals><wins>10</wins><losses>3</losses><ties>0</ties></outcome_totals>
            <points_for>1400</points_for><points_against>1100</points_against>
          </team_standings>
        </team>
      </teams></standings></league></fantasy_content>`);
    const standings = parseStandings(body);
    expect(standings[0]).toMatchObject({ rank: 1, name: "Cobra Kai", wins: 10, pointsFor: 1400 });
    expect(standings[1].name).toBe("Eagle Fang");
  });
});

describe("parseScoreboard", () => {
  it("extracts matchup teams with actual and projected points", () => {
    const body = parse(`
      <fantasy_content><league><scoreboard><matchups count="1">
        <matchup>
          <week>3</week><status>midevent</status>
          <teams count="2">
            <team>
              <team_key>461.l.1.t.1</team_key><name>Cobra Kai</name>
              <team_points><total>88.4</total></team_points>
              <team_projected_points><total>112.2</total></team_projected_points>
            </team>
            <team>
              <team_key>461.l.1.t.2</team_key><name>Eagle Fang</name>
              <team_points><total>91.0</total></team_points>
              <team_projected_points><total>105.9</total></team_projected_points>
            </team>
          </teams>
        </matchup>
      </matchups></scoreboard></league></fantasy_content>`);
    const matchups = parseScoreboard(body);
    expect(matchups).toHaveLength(1);
    expect(matchups[0].week).toBe(3);
    expect(matchups[0].teams[0]).toMatchObject({ name: "Cobra Kai", points: 88.4, projectedPoints: 112.2 });
  });
});

describe("parseTransactions", () => {
  it("extracts add/drop players with team destinations", () => {
    const body = parse(`
      <fantasy_content><league><transactions count="1">
        <transaction>
          <transaction_key>461.l.1.tr.26</transaction_key>
          <type>add/drop</type><status>successful</status><timestamp>1758000000</timestamp>
          <players count="2">
            <player>
              <name><full>Hot Pickup</full></name>
              <display_position>WR</display_position>
              <editorial_team_abbr>Den</editorial_team_abbr>
              <transaction_data>
                <type>add</type><source_type>freeagents</source_type>
                <destination_team_name>Cobra Kai</destination_team_name>
              </transaction_data>
            </player>
            <player>
              <name><full>Cold Drop</full></name>
              <display_position>RB</display_position>
              <editorial_team_abbr>NYJ</editorial_team_abbr>
              <transaction_data>
                <type>drop</type>
                <source_team_name>Cobra Kai</source_team_name>
                <destination_type>waivers</destination_type>
              </transaction_data>
            </player>
          </players>
        </transaction>
      </transactions></league></fantasy_content>`);
    const transactions = parseTransactions(body);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe("add/drop");
    expect(transactions[0].players[0]).toMatchObject({
      name: "Hot Pickup",
      moveType: "add",
      destinationTeamName: "Cobra Kai",
    });
    expect(transactions[0].players[1]).toMatchObject({
      name: "Cold Drop",
      moveType: "drop",
      sourceTeamName: "Cobra Kai",
    });
  });
});

describe("parseLeaguePlayers", () => {
  it("extracts free agents with percent owned", () => {
    const body = parse(`
      <fantasy_content><league><players count="1">
        <player>
          <player_key>461.p.300</player_key>
          <name><full>Sleeper Back</full></name>
          <editorial_team_abbr>Chi</editorial_team_abbr>
          <bye_weeks><week>11</week></bye_weeks>
          <display_position>RB</display_position>
          <percent_owned><coverage_type>week</coverage_type><value>43</value></percent_owned>
        </player>
      </players></league></fantasy_content>`);
    const players = parseLeaguePlayers(body);
    expect(players[0]).toMatchObject({
      playerKey: "461.p.300",
      name: "Sleeper Back",
      team: "CHI",
      position: "RB",
      byeWeek: 11,
      percentOwned: 43,
    });
  });
});

describe("parseLeagueMeta", () => {
  it("extracts league name, current week, and roster slot counts", () => {
    const body = parse(`
      <fantasy_content><league>
        <name>Full Contact</name><current_week>7</current_week>
        <settings>
          <roster_positions>
            <roster_position><position>QB</position><count>1</count></roster_position>
            <roster_position><position>RB</position><count>2</count></roster_position>
            <roster_position><position>WR</position><count>3</count></roster_position>
            <roster_position><position>TE</position><count>1</count></roster_position>
            <roster_position><position>W/R/T</position><count>1</count></roster_position>
            <roster_position><position>K</position><count>1</count></roster_position>
            <roster_position><position>DEF</position><count>1</count></roster_position>
            <roster_position><position>BN</position><count>5</count></roster_position>
          </roster_positions>
        </settings>
      </league></fantasy_content>`);
    const meta = parseLeagueMeta(body);
    expect(meta.name).toBe("Full Contact");
    expect(meta.currentWeek).toBe(7);
    expect(meta.rosterSlots).toMatchObject({ QB: 1, RB: 2, "W/R/T": 1, BN: 5 });
  });
});
