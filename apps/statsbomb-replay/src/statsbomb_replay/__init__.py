"""StatsBomb open-data → VTourn spec stream producer.

Targets the 2022 FIFA World Cup Final (Argentina 3-3 France, ARG 4-2 on pens).
Emits messages conforming to ``@vtorn/spec`` ``SPEC_VERSION = "0.1.1"``.
"""

SPEC_VERSION = "0.1.1"

# Default match resolution metadata (FIFA World Cup 2022 final, ARG vs FRA).
DEFAULT_MATCH_SLUG = "fifa-wc-2022-final-arg-fra-2022-12-18"
DEFAULT_COMPETITION_ID = 43
DEFAULT_SEASON_ID = 106
DEFAULT_MATCH_DATE = "2022-12-18"

__version__ = "0.1.0"
__all__ = [
    "DEFAULT_COMPETITION_ID",
    "DEFAULT_MATCH_DATE",
    "DEFAULT_MATCH_SLUG",
    "DEFAULT_SEASON_ID",
    "SPEC_VERSION",
]
