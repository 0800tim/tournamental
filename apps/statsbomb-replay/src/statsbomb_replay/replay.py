"""CLI entry-point for the StatsBomb-replay producer.

Usage:
    uv run python -m statsbomb_replay.replay \
      --statsbomb-data /path/to/open-data \
      --time-scale 10 \
      --out ws --port 4001
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from . import (
    DEFAULT_COMPETITION_ID,
    DEFAULT_MATCH_DATE,
    DEFAULT_MATCH_SLUG,
    DEFAULT_SEASON_ID,
)
from .emitter import build_messages
from .loader import load_match, resolve_match_id

log = logging.getLogger("statsbomb-replay")


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="statsbomb-replay", description=__doc__)
    p.add_argument(
        "--match-id",
        default=DEFAULT_MATCH_SLUG,
        help="VTourn match slug to embed in MatchInit (default: AR-FR final).",
    )
    p.add_argument(
        "--statsbomb-data",
        default="./statsbomb-open-data",
        type=Path,
        help="Path to a local clone of github.com/statsbomb/open-data, or "
        "an empty directory we'll populate via fetch.",
    )
    p.add_argument(
        "--competition-id",
        type=int,
        default=DEFAULT_COMPETITION_ID,
        help="StatsBomb competition_id (43 = FIFA World Cup).",
    )
    p.add_argument(
        "--season-id",
        type=int,
        default=DEFAULT_SEASON_ID,
        help="StatsBomb season_id (106 = 2022).",
    )
    p.add_argument(
        "--match-date",
        default=DEFAULT_MATCH_DATE,
        help='Match date in "YYYY-MM-DD" form (default 2022-12-18).',
    )
    p.add_argument(
        "--home-team",
        default="Argentina",
        help='Home team name as recorded by StatsBomb (default "Argentina").',
    )
    p.add_argument(
        "--away-team",
        default="France",
        help='Away team name as recorded by StatsBomb (default "France").',
    )
    p.add_argument(
        "--time-scale",
        type=float,
        default=10.0,
        help="Wall-clock playback speed multiplier (default 10x).",
    )
    p.add_argument(
        "--out",
        choices=["ws", "file", "stdout"],
        default="stdout",
        help="Output sink.",
    )
    p.add_argument("--port", type=int, default=4001, help="WebSocket port.")
    p.add_argument(
        "--path", type=Path, default=Path("./out"), help="Output dir for --out=file."
    )
    p.add_argument(
        "--no-fetch",
        action="store_true",
        help="Disable remote fetch fallback for missing StatsBomb files.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the full message list and print stats; do not stream.",
    )
    p.add_argument(
        "--verbose", "-v", action="store_true", help="Verbose logging."
    )
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    log.info("resolving match id…")
    match_id = resolve_match_id(
        args.statsbomb_data,
        competition_id=args.competition_id,
        season_id=args.season_id,
        match_date=args.match_date,
        home_team=args.home_team,
        away_team=args.away_team,
        allow_fetch=not args.no_fetch,
    )
    log.info("loaded match_id=%s", match_id)

    match = load_match(args.statsbomb_data, match_id, allow_fetch=not args.no_fetch)
    messages, stats = build_messages(match, match_slug=args.match_id)
    log.info(
        "built %d messages (%d events, %d state frames). final score: %d-%d "
        "(%d-%d on pens)",
        len(messages),
        stats.n_events,
        stats.n_state_frames,
        stats.home_score,
        stats.away_score,
        stats.pen_score_home,
        stats.pen_score_away,
    )

    if args.dry_run:
        return 0

    if args.out == "stdout":
        for msg in messages:
            sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()
        return 0

    if args.out == "file":
        args.path.mkdir(parents=True, exist_ok=True)
        out_path = args.path / f"{args.match_id}.ndjson"
        with out_path.open("w", encoding="utf-8") as fh:
            for msg in messages:
                fh.write(json.dumps(msg) + "\n")
        log.info("wrote %d messages to %s", len(messages), out_path)
        return 0

    if args.out == "ws":
        return asyncio.run(_serve_ws(messages, port=args.port, time_scale=args.time_scale))

    parser.error(f"unknown out: {args.out}")
    return 2


async def _serve_ws(messages: list[dict], *, port: int, time_scale: float) -> int:
    """Serve a paced spec stream over WebSocket.

    Each new client triggers a fresh playback. ``init`` is sent
    immediately; subsequent messages pace by ``message.t / time_scale``
    wall-clock ms.
    """
    try:
        from websockets.asyncio.server import serve  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover
        log.error("websockets package missing: %s", exc)
        return 1

    async def handler(ws):
        log.info("client connected")
        if not messages:
            return
        init = messages[0]
        await ws.send(json.dumps(init))
        last_wall = asyncio.get_event_loop().time()
        last_match_t = 0
        for msg in messages[1:]:
            target_match_t = int(msg.get("t", last_match_t))
            delta_match = max(0, target_match_t - last_match_t)
            delta_wall = (delta_match / 1000.0) / max(0.0001, time_scale)
            now = asyncio.get_event_loop().time()
            elapsed_wall = now - last_wall
            sleep_for = max(0.0, delta_wall - elapsed_wall)
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)
            await ws.send(json.dumps(msg))
            last_match_t = target_match_t
            last_wall = asyncio.get_event_loop().time()
        log.info("playback complete")

    log.info("ws listening on :%d (time_scale=%g)", port, time_scale)
    async with serve(handler, "0.0.0.0", port):
        await asyncio.Future()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
