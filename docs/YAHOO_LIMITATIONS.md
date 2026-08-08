# Yahoo Fantasy API boundaries

Verified against Yahoo's published Fantasy Sports API resource model before this
implementation.

## Supported read operations used by the adapter

- League settings: `GET /fantasy/v2/league/{league_key}/settings`
- League teams: `GET /fantasy/v2/league/{league_key}/teams`
- Draft results: `GET /fantasy/v2/league/{league_key}/draftresults`
- Available players: the league players collection with `status=A`
- Team rosters: available through the documented team roster resource (not yet
  wired into the simulation-first UI)

All private league access requires Yahoo OAuth. Responses are XML unless another
documented representation is requested. The API does not promise that draft
results are published with real-time latency, so callers must retain a last
successful sync timestamp and treat stale or conflicting data as unsafe.

## Deliberately unsupported

Yahoo does not document a Fantasy Sports API operation for submitting a live
draft selection. Transaction endpoints cover adds, drops, and trades; roster
endpoints cover lineup changes. Neither is a draft-pick endpoint.

This project therefore:

- has no `makePick` Yahoo adapter method;
- never submits the Confirm Pick action to Yahoo;
- keeps all future automatic behavior disabled by default;
- will not add browser automation without explicit user approval;
- treats Yahoo ADP as optional because no stable ADP field is assumed.

## Before enabling live sync

Test the exact 2026 league response shapes in a non-critical session, measure
draft-result latency, add secure encrypted token persistence, reconcile Yahoo
player IDs, and verify rate/error behavior. Never enable future automatic
selection when sync is stale, unavailable, or conflicting.
