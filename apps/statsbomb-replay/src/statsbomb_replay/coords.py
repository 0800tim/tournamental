"""Coordinate-system helpers.

StatsBomb uses a 120 x 80 pitch with origin at top-left corner. The +x axis
always points toward the goal of the team currently in possession (the
"attacking direction"), so the orientation flips between possessions and
also at half-time when teams swap ends.

The VTorn spec uses a fixed 105 x 68 pitch-centred coordinate system:

  - origin at pitch centre
  - +x toward team[1]'s goal
  - +y across the pitch
  - units = metres

In this producer:
  - team[0] = Argentina (home), defends -x
  - team[1] = France  (away), defends +x

Argentina attacks +x, France attacks -x. So when a StatsBomb event's
*possessing* team is ``ARG`` we apply no flip; when it's ``FRA`` we flip
through the centre.

The pitch dimensions in StatsBomb are nominal (120 x 80 yards-equivalent
units). The spec's 105 x 68 metres is the FIFA standard so we rescale by
105/120 on x and 68/80 on y.

Note also that the StatsBomb y-axis runs top-to-bottom (y=0 is one
sideline, y=80 is the other) which after centring (y - 40) flips the sign
of "left" vs "right" relative to a normal "x increases east, y increases
north" convention. The renderer treats spec y consistently so we don't
need to negate y here, only translate.
"""
from __future__ import annotations

from typing import Literal

PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0
SB_PITCH_LENGTH = 120.0
SB_PITCH_WIDTH = 80.0

ScaleX = PITCH_LENGTH_M / SB_PITCH_LENGTH
ScaleY = PITCH_WIDTH_M / SB_PITCH_WIDTH

Side = Literal["home_left_to_right", "home_right_to_left"]


def sb_to_spec_xy(
    loc: tuple[float, float] | list[float],
    *,
    possessing_team_is_home: bool,
) -> tuple[float, float]:
    """Map a StatsBomb [x, y] location to spec-pitch metres.

    ``possessing_team_is_home``: if True, the team currently in possession
    is the home team (ARG) which attacks +x in spec coordinates so no flip.
    If False, the possessing team attacks +x in StatsBomb coords but -x in
    spec coords, so we flip both axes through the pitch centre.

    StatsBomb x grows toward the attacking goal of the possessing team
    along the pitch's long axis; y grows across the pitch. We:

      1. Centre to (-60..60, -40..40) in StatsBomb units.
      2. Rescale to metres (-52.5..52.5, -34..34).
      3. Flip if the possessing team is the away team.
    """
    x_sb, y_sb = float(loc[0]), float(loc[1])
    # Centre.
    x_c = x_sb - SB_PITCH_LENGTH / 2.0  # -60..60
    y_c = y_sb - SB_PITCH_WIDTH / 2.0  # -40..40
    # Scale to metres.
    x = x_c * ScaleX
    y = y_c * ScaleY
    # Flip when possessing team is the away team (attacks -x in spec).
    if not possessing_team_is_home:
        x = -x
        y = -y
    return (x, y)


def sb_to_spec_xyz(
    loc: tuple[float, float, float] | list[float],
    *,
    possessing_team_is_home: bool,
) -> tuple[float, float, float]:
    """Map a 3D StatsBomb location ``[x, y, z]`` (e.g. shot end) to spec.

    The z coordinate (height) is in StatsBomb yards-equivalent units; we
    rescale roughly the same way (z * 105/120) although in practice spec
    consumers only care that z > 0 for "off the ground". We pass it through
    in metres for downstream rendering.
    """
    if len(loc) == 2:
        x, y = sb_to_spec_xy(tuple(loc), possessing_team_is_home=possessing_team_is_home)
        return (x, y, 0.0)
    x_xy = (loc[0], loc[1])
    x, y = sb_to_spec_xy(x_xy, possessing_team_is_home=possessing_team_is_home)
    z = float(loc[2]) * ScaleX  # treat z roughly as metres
    return (x, y, z)


def absolute_sb_to_spec_xy(
    loc: tuple[float, float] | list[float],
    *,
    home_attacks_left_to_right: bool,
) -> tuple[float, float]:
    """Map a StatsBomb 360 freeze-frame coordinate to spec.

    StatsBomb 360 frames use the *match* orientation rather than possession
    orientation: the home team attacks left-to-right in period 1, and the
    teams switch ends at half-time. So we need to know which way the home
    team is attacking *in this period*.

    Spec convention: home team (team[0], ARG) defends -x and attacks +x
    always, regardless of period. If ``home_attacks_left_to_right`` then
    StatsBomb +x already aligns with spec +x (no flip). Otherwise flip
    through the centre.
    """
    x_sb, y_sb = float(loc[0]), float(loc[1])
    x_c = x_sb - SB_PITCH_LENGTH / 2.0
    y_c = y_sb - SB_PITCH_WIDTH / 2.0
    x = x_c * ScaleX
    y = y_c * ScaleY
    if not home_attacks_left_to_right:
        x = -x
        y = -y
    return (x, y)
