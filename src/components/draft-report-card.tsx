import { useState } from "react";
import type { DraftBoardReport, TeamReportCard } from "@/domain/draft-report";
import { PLAYER_POSITIONS } from "@/domain/types";

export function DraftReportCard({
  report,
  userSlot,
  teamLabel,
  onClose,
}: {
  report: DraftBoardReport;
  userSlot: number;
  teamLabel: (slot: number) => string;
  onClose: () => void;
}) {
  const [openSlot, setOpenSlot] = useState(userSlot);

  return (
    <div className="launcher-overlay" onClick={onClose}>
      <section
        className="launcher report-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-card-title"
      >
        <header className="launcher-head">
          <div>
            <p className="eyebrow">Final grades</p>
            <h2 id="report-card-title">Draft report card</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="report-grid">
          {report.teams.map((team) => (
            <TeamCard
              key={team.slot}
              team={team}
              label={teamLabel(team.slot)}
              mine={team.slot === userSlot}
              expanded={team.slot === openSlot}
              onToggle={() =>
                setOpenSlot((current) =>
                  current === team.slot ? 0 : team.slot,
                )
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TeamCard({
  team,
  label,
  mine,
  expanded,
  onToggle,
}: {
  team: TeamReportCard;
  label: string;
  mine: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`report-team grade-${team.grade[0]} ${mine ? "mine" : ""} ${expanded ? "open" : ""}`}>
      <button type="button" className="report-team-head" onClick={onToggle}>
        <strong className="report-grade">{team.grade}</strong>
        <span>
          <b>
            {label}
            {mine ? " · you" : ""}
          </b>
          <small>Slot {team.slot} · {team.headline}</small>
        </span>
      </button>
      <p className="report-pos">
        {PLAYER_POSITIONS.map((position) => (
          <i key={position}>
            {team.positionCounts[position]} {position}
          </i>
        ))}
      </p>
      {team.steal && (
        <p className="report-note steal">
          Steal · {team.steal.name} <span>{team.steal.detail}</span>
        </p>
      )}
      {team.reach && (
        <p className="report-note reach">
          Reach · {team.reach.name} <span>{team.reach.detail}</span>
        </p>
      )}
      {team.byeAlert && <p className="report-note bye">{team.byeAlert}</p>}
      {team.holes.length > 0 && (
        <p className="report-note hole">{team.holes.join(" · ")}</p>
      )}
      {expanded && (
        <ol className="report-roster">
          {team.picks.map((pick) => (
            <li key={`${pick.overall}-${pick.player.id}`}>
              <em>
                {pick.round}.{pick.slot}
              </em>
              <b>{pick.player.name}</b>
              <small>
                {pick.player.position}
                {pick.player.chenRank ? ` · Chen ${pick.player.chenRank}` : ""}
                {pick.player.byeWeek ? ` · Bye ${pick.player.byeWeek}` : ""}
              </small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
