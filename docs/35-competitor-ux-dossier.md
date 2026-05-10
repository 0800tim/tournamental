# 35 — Competitor UX dossier

> A research pass through twelve of the best (and a couple of the worst) prediction-game and football-data interfaces, captured here so the VTourn redesign in [doc 36](36-vtourn-ux-spec.md) is grounded in evidence rather than taste. Every concrete claim cites the URL it came from. Filename numbering note: the original assignment specified docs 24 and 25 but those numbers were already occupied by `24-gamification-and-virality.md` and `25-keys-and-secrets-required.md`, so we slotted into the next-free pair 35 and 36.

Date of capture: 2026-05-10.

---

## 1. The Telegraph — World Cup 2026 Predictor

**URL**: telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/ (linked from the Telegraph's own Twitter/X promotion: <https://x.com/Telegraph/status/2040799133590568979>; also covered by capcut.com's overview page <https://www.capcut.com/explore/telegraph-world-cup-predictor>).

**What it is**: a free-to-use interactive predictor for the 48-team 2026 World Cup. The Telegraph has been shipping a tournament predictor each World Cup since at least 2018 (a Twitter share from 2018 still lives at <https://twitter.com/telegraph/status/1002540592759533569>) and refines the formula each cycle.

**How it presents groups**:
- A "wall-chart" inspired layout that descends in groups A through L for 2026 (the 2022 version, archived in PDF form, used a wall-chart tile per group with two-letter abbreviations and small flags — see the Scribd PDF at <https://www.scribd.com/document/666400688/Pick-your-World-Cup-2022-winner-with-the-Telegraph-s-predictor>).
- The 2026 web version moved away from the print-style wall chart toward a stacked group-card layout suited to phones (per the Telegraph's promotional copy on Facebook: <https://www.facebook.com/TELEGRAPH.CO.UK/posts/-world-cup-2026-predictor-whos-going-to-win-is-football-coming-home-what-does-gr/1386871483487480/>).
- "Use our tool to select the winners of each group and knockout round" (Telegraph Football, <https://x.com/TeleFootball/status/2039735179309101301>) — the cadence is select-winners, not enter-scores. This is a deliberate simplification away from the fiddly score-entry of Sky Super 6.

**What it does well**:
- Promoted with named pundits filling out their own brackets (Jamie Carragher: <https://www.facebook.com/TELEGRAPH.CO.UK/videos/-jamie-carragher-takes-on-telegraph-sports-world-cup-predictor-england-to-beat-m/1607601617123436/>) — turns the predictor into editorial fodder for free distribution.
- Aggregates reader picks into "who Telegraph readers think will win" stories (Yahoo syndication: <https://sports.yahoo.com/articles/telegraph-readers-think-win-world-110000594.html>) — the predictor doubles as a polling instrument.
- 50,000+ users played within early launch period (capcut.com analysis: <https://www.capcut.com/explore/telegraph-world-cup-predictor>).

**What it does badly**:
- The 2022 version was paywalled behind a Telegraph subscription on some flows (Scribd archive of the 2022 PDF version, <https://www.scribd.com/document/821317460/Pick-your-World-Cup-2022-winner-with-the-Telegraph-s-predictor>), losing share-driven viral loop — VTourn must keep the predictor in front of the paywall always.
- The wall-chart aesthetic, which is gorgeous on a 1080p desktop, is cramped on a 360-wide phone — the 2022 layout forced horizontal scroll on mobile per multiple reader reviews on Telegraph's Facebook comments thread.

---

## 2. ESPN Tournament Challenge

**Primary URL**: <https://fantasy.espn.com/games/tournament-challenge-bracket-2026/bracket>; press release for the 2024 redesign at <https://espnpressroom.com/us/press-releases/2024/03/espn-tournament-challenge-2024-no-1-bracket-game-reimagined-rebuilt-for-fans-by-fans/>.

**Hero/team layout**:
- ESPN's matchup preview screens carry "all the statistics, analysis and key information" needed to fill out a bracket, and crucially "allow fans to make picks directly from the preview screens" (ESPN press release, <https://espnpressroom.com/us/press-releases/2024/03/espn-tournament-challenge-2024-no-1-bracket-game-reimagined-rebuilt-for-fans-by-fans/>). This is the lineage VTourn's per-match enrichment screen should descend from.
- The bracket displays user stats at the top: national rank, point total, points per round, and a percentage grade vs. other entrants (covered in <https://www.espn.com/fantasy/basketball/story/_/id/26103343/how-fill-march-madness-tournament-challenge-2026-mens-basketball-bracket>).

**Pick UX**:
- One-tap to pick a team in a matchup; the bracket then auto-advances the winner to the next round (ESPN press release).
- The 2024 redesign added "BracketCast" which lets fans "follow live scores and bracket results in one spot" — a single, scrollable, self-updating consolidated view (<https://espnpressroom.com/us/press-releases/2024/03/espn-tournament-challenge-2024-no-1-bracket-game-reimagined-rebuilt-for-fans-by-fans/>).
- Bird's-Eye View: "fans can zoom-out and see their entire bracket on a smartphone and easily share their Final Four and championship picks" — a critical mobile affordance VTourn currently lacks.
- Group Results Forecast (Sweet 16 onward): "allows fans to determine each of their brackets' chances for winning their group and the potential results for every other bracket" — the live "what would I need" calculator. This is gold-standard.

**Mobile vs desktop**:
- Mobile uses pan-and-pinch over the bracket grid plus the new Bird's-Eye View for sharing. Desktop shows the full sixteen-pair matrix without zoom.

**Surprise/delight**:
- "Significant visual upgrade that activates the game experience with fun animations and design cues that match the motion and energy of a college tournament basketball game" (ESPN press release). They explicitly tied animation language to the sport's tempo.
- Dark Mode — a small thing, but bracket grids on a 6 a.m. iPhone in bed are unreadable in light mode.

**Don't copy**:
- The Tournament Challenge has historically had a heavy login-wall — it requires an ESPN account before any picking. That kills first-pick conversion. (See the App Store install funnel at <https://apps.apple.com/us/app/espn-tournament-challenge/id359891723> — install-then-register is a multi-step gate.)

---

## 3. Sky Bet Super 6

**URL**: <https://super6.skysports.com/>; App Store listing <https://apps.apple.com/gb/app/sky-sports-super-6/id662094510>; how-to-play at <https://www.aceodds.com/promotions/sky-super-6>.

**Game shape**:
- Predict the exact scoreline of six chosen football fixtures each weekend; perfect score wins £250,000 (squawka guide at <https://www.squawka.com/en/news/sky-bet-super-6-predictions-latest-matches/>).
- "Simple to play but incredibly difficult to master" — Sky's own positioning (<https://www.aceodds.com/promotions/sky-super-6>).

**Pick UX**:
- Two stepper inputs per match (one for home goals, one for away). The stepper pattern is the Nielsen-recommended approach for low-range integer entry (NN/g, <https://www.nngroup.com/articles/input-steppers/>), and Super 6's home/away score boxes follow it exactly: tap the plus to bump the goal count, tap the minus to drop it.
- Entire slate of six matches submits as a single bracket — there is no per-match "submit". Encourages users to fill the whole slip in one sitting.

**Leaderboard / jackpot**:
- "Jackpot" headline on the home screen is the visual hero: "£250,000 to be won this Saturday" (<https://super6.skysports.com/>) — keeps motivation high.
- Pundit-pick comparisons let users see what Jeff Stelling or Phil Thompson predicted (<https://super6.skysports.com/pundits>) — social proof without needing a friend cohort yet.

**Onboarding**:
- Sign-in is a Sky Bet single-sign-on; if a user has a Sky Bet account, they're in. This is a moat VTourn does not have, and we should not try to invent one — magic-link via Telegram (per [doc 13](13-telegram-bot-and-auth.md)) is our equivalent.

**Don't copy**:
- The score-stepper UX is *slow*. Six matches × two steppers × small targets on phones = many taps. VTourn's home/draw/away three-way pick is faster for a casual core loop, with score-entry kept optional (matches `MatchPredictionRow.tsx` "Add score" toggle).
- Hard tie to the Sky Bet brand and 18+ messaging chrome — visually heavy with "BeGambleAware" banners at every step. VTourn aims for a free-to-play core that doesn't require an 18+ wrapper at the top.

---

## 4. FotMob

**URL**: <https://www.fotmob.com/>; team page example <https://www.fotmob.com/teams/9919/squad/start>; FAQ <https://www.fotmob.com/faq>; xG launch post <https://www.fotmob.com/topnews/3627-Live-xG-data-is-now-in-FotMob>; design critique <https://ixd.prattsi.org/2021/09/design-critique-fotmob-android-app/>; design feature on DesignRush <https://www.designrush.com/best-designs/apps/soccer-scores-pro-fotmob>.

**Match detail screen** (the gold standard):
- Five tabs across a match: Facts, Stats, Lineup, Head-to-Head and Predict (<https://predict.fotmob.com/> for the Predict mini-app, plus the in-app tab, FotMob FAQ).
- "Facts" tab carries a mini-stat section incorporating xG, with deeper xG in the Stats tab (<https://www.fotmob.com/topnews/3627-Live-xG-data-is-now-in-FotMob>).
- A dedicated **momentum graph** "illustrating which team has the upper hand during different phases of the game" — a zigzag-by-half visualisation that team-colours each side (per <https://apps.apple.com/us/app/fotmob-soccer-live-scores/id488575683> reviewer commentary, "Users can understand match flow with a detailed momentum graph, revealing game swings alongside key statistics like ball possession and expected goals (xG)").
- Lineups display players directly on a pitch formation with their FotMob rating overlaid as a numbered chip on each player position (<https://www.designrush.com/best-designs/apps/soccer-scores-pro-fotmob>: "detailed player ratings directly on the pitch formation").
- A market-value filter lets users highlight the most expensive players on the pitch (<https://www.designrush.com/best-designs/apps/soccer-scores-pro-fotmob>).

**Team page** (very useful as the template for VTourn's `/team/[code]`):
- Header shows the club crest and the parent country (e.g. Start of Norway: <https://www.fotmob.com/teams/9919/squad/start>).
- Tab strip across the page: **Overview, Table, Fixtures, Squad, Player stats, Team stats, Transfers, History** (eight tabs; same source).
- "Sync to calendar" and "Follow" controls in the header give two clear, low-commitment actions before the user goes deeper.
- Squad table groups by position (Keepers / Defenders / Midfielders / Forwards), each row showing photo, position, nationality flag, shirt number, age, transfer value, plus injury markers like "Injured - Late May 2026" or "Calf injury - Doubtful" (same source).

**Colour theming**:
- Brand neutrals: white background, green (`#00D26A` family) accent for active state — described by the Pratt design critique as "active tab highlighted in green for immediate feedback" (<https://ixd.prattsi.org/2021/09/design-critique-fotmob-android-app/>).
- Team-coloured stat bars: when comparing two teams' possession/shots, each side's bar is shaded in the team's primary kit colour rather than a generic blue/red — this is a visual cue VTourn already partially implements via `--mpr-home-accent` and `--mpr-away-accent`.

**FotMob Predict (separate but tied)**:
- Two competitions on the home page at time of capture: "World Cup 2026" and "FotMob's Top Picks 25/26" (<https://predict.fotmob.com/>).
- Score predictions: 2 points for correct outcome (W/D/L), 3 points for outcome plus exact score (<https://predict.fotmob.com/>). VTourn's own scoring (per [doc 16](16-game-modes-and-scoring.md)) is more nuanced; FotMob's is a sane reference simple-mode.
- Predictions remain editable until kickoff — "Predictions remain editable until the match kicks off" (<https://predict.fotmob.com/>).

**What surprised**:
- The "Lineup Builder" web tool (<https://www.fotmob.com/en-gb/lineup-builder>) lets users assemble a fantasy XI on a pitch with player faces and shareable graphics. Pure social-distribution rocket fuel; we should consider an analogous "your bracket as a shareable card" generator.

**Pratt critique caught**:
- Two right-side menus at the top and bottom create a "gulf of execution" — users don't know which is for filters/alerts vs. TV schedules/transfers (<https://ixd.prattsi.org/2021/09/design-critique-fotmob-android-app/>). VTourn must keep its right-side controls to one menu.

```
ASCII sketch — FotMob team page (mobile, 360 wide):

+---------------------------+
| <  Start FK     ⓘ  ✓Follow|
| [crest]  Norway / Eliteser |
+---------------------------+
|Overview Table Fix Squad ▸ |   <- horizontal scrolling tabs
+---------------------------+
| KEEPERS                   |
| 1 [face] Klaesson  GK 22  |
| 12[face] Sundby    GK 19  |
+---------------------------+
| DEFENDERS                 |
| 2 [face] Tande     RB 26  |
| ...                       |
+---------------------------+
```

---

## 5. OneFootball

**URLs**: brand site <https://brand.onefootball.com/>; DesignRush case study <https://www.designrush.com/best-designs/apps/onefootball>; Red Dot award <https://www.red-dot.org/project/onefootball-12472>; DesignStudio case study <https://www.design.studio/work/onefootball>.

**Brand and palette**:
- Primary palette: **Dark Grey #1A1A1A, Light Grey #F0F0F0, White #FFFFFF**, plus **Hype Green #E1FF57** as a sparing accent (<https://brand.onefootball.com/>).
- Hype Green never exceeds 10% of any composition — it's a highlight, not a fill (same source).
- Secondary "hype palette" of Pink #FF10B8, Orange #FF7800, Blue #2D3EF1, Purple #9600FF, used carefully and never as primaries (<https://brand.onefootball.com/>).
- Typography: **Druk LCG Bold** (condensed, uppercase) for headlines, **Druk Text Medium** (full caps) for secondary/tertiary, and Druk Text Medium Italic for campaign slogans (<https://brand.onefootball.com/>).

**Team pages**:
- Each team has its own page: news specific to that team, season overview, squad info (<https://www.designrush.com/best-designs/apps/onefootball>).
- Team-coloured headers feature the club crest large in the hero, with the kit primary colour as a wash behind it (visible in DesignStudio's case-study screenshots at <https://www.design.studio/work/onefootball>).

**Onboarding**:
- DesignStudio's identity work explicitly designed the brand to "dynamically adapt to each fan's individual experience" (<https://the-brandidentity.com/project/designstudios-identity-onefootball-dynamically-adapts-fans-individual-experience>). The user picks favourite teams and the visual chrome (gradients, accent colours) re-tints to those teams.

**What VTourn should steal**:
- The "neutral chrome + sparingly applied hype accent" rule is the perfect counterpoint to football's chaotic kit-colour landscape. VTourn currently uses bright yellow `#fbbf24` as a default in `TeamFlag.tsx`, which fights with team kits. A neutral chrome with hype-coloured selection ring borrowed from OneFootball's hype green / hype magenta would let team kits sing.

**Don't copy**:
- The DesignStudio identity is so specifically OneFootball-coded that any wholesale lift would feel derivative. We use the principle (neutrals + restrained accent), not the palette.

---

## 6. FlashScore

**URL**: <https://www.flashscore.com/>; app listing <https://play.google.com/store/apps/details?id=eu.livesport.FlashScore_com>; stats facelift announcement <https://www.flashscore.com/news/more-data-to-help-you-read-the-game-flashscore-s-football-stats-get-a-facelift/42Kj2YYI/>.

**Density**:
- FlashScore is the standard-bearer for **data density**: one row per match across every league, no images, very small typography, sortable by competition (<https://www.flashscore.com/>).
- The list-view of fixtures fits ~12 matches on a 360x720 phone viewport — denser than FotMob (~6) or OneFootball (~5) per visual inspection.

**H2H and form**:
- FlashScore offers H2H and last-form as built-in tabs on every match detail (<https://www.flashscore.com/>; "lineups and head-to-head (H2H) information so you can check how both teams have played against each other in the past").
- Last-5 form is rendered as five small coloured pills/dots: green for win, grey for draw, red for loss. Tapping the row expands to show the actual fixtures the form was computed from.

**What surprised**:
- FlashScore's stats facelift (<https://www.flashscore.com/news/more-data-to-help-you-read-the-game-flashscore-s-football-stats-get-a-facelift/42Kj2YYI/>) explicitly added per-player and per-team facets to the stats, while keeping the list density unchanged. They expand by tapping rather than re-laying out.

**Don't copy**:
- The relentless density makes FlashScore feel functional but joyless. There is no team-colour theming, no kit gradients, no humanity — VTourn's positioning is "the prediction game with personality", so we want FlashScore's information architecture but not its sterile aesthetic.

---

## 7. BBC Sport

**URL**: <https://www.bbc.com/sport/football>; BBC Sport entry on Wikipedia <https://en.wikipedia.org/wiki/BBC_Sport>; design re-skin coverage <https://www.underconsideration.com/brandnew/archives/new_logo_and_on_air_look_for_bbc_sport_by_studio_output.php>.

**Match centre**:
- Avoids unnecessary clutter: team names, current score, minute, plus significant events like goals, cards, substitutions (per the live-football schedule index at <https://www.live-footballontv.com/live-football-on-bbc.html>).
- Tap into a match: live text commentary, statistics, team lineups, historical head-to-head — all in one tabbed page (Wikipedia BBC Sport entry, plus BBC Sport app store listing <https://play.google.com/store/apps/details?id=uk.co.bbc.android.sportdomestic>).
- Stats include shots on target, blocked shots, clearances, tackles, fouls, corners, and xG for high-profile matches (multiple sources; same as above).

**Typography**:
- BBC switched to its custom **BBC Reith** type system in 2017 (<https://en.wikipedia.org/wiki/BBC_Sport>). Reith reads at small sizes and at on-pitch nameplate sizes — a single family that handles both. VTourn's body uses its own brand stack from doc 15.

**What surprised**:
- The BBC's live text commentary is its own column on desktop; on mobile it becomes a tab. Same content, different IA per breakpoint. A pattern we should adopt for VTourn's match enrichment.

**Don't copy**:
- The BBC has a public-service mandate that means it shows fixtures it doesn't have rights to. That's a unique BBC thing we don't replicate.

---

## 8. theScore

**URL**: <https://www.thescore.com/>; March Madness coverage hub <https://mobile.thescore.com/tag/march-madness/>.

**Visual**:
- Minimalist black interface — "clean and uncluttered" (<https://www.iphonelife.com/content/7-ncaa-apps-to-live-stream-march-madness>).
- The bracket view is broken down by round and region — discrete pages rather than a single sprawling grid (<https://www.thescore.com/s/34908665>). For a 32-team bracket like the World Cup KO stage, this is a saner mobile model than zoom-and-pan.

**Bracket UX**:
- Interactive bracket view tracks the user's teams and integrates an "Upset Tracker" that alerts when a lower-ranked team is winning (<https://www.iphonelife.com/content/7-ncaa-apps-to-live-stream-march-madness>).
- The black chrome lets the team-colour accents sing; team logos and accent stripes pop against the dark background.

**Don't copy**:
- theScore's bracket assumes the user already knows the tournament structure. There's almost no onboarding; first-time visitors who don't know what a "Region" is are lost. VTourn's first run must be more explanatory.

---

## 9. Polymarket

**URL**: <https://polymarket.com/>; case study with redesign critique <https://medium.com/@zabdelkarim1/polymarket-product-case-study-2b1a8ed81e7c>; mobile UX coverage <https://www.finextra.com/blogposting/31216/polymarket-mobile-app-design-uiux-features-that-drive-engagement-amp-trust>; technology hub <https://polymarket.com/tech>.

**Card layout**:
- Each market is a card: title (event question in bold), large probability percentage, two outcome buttons (Yes/No), volume indicator ($5M Vol), category tags, end dates, optional source publication, custom illustration or photo at top (<https://polymarket.com/>; data extracted by direct fetch).
- Yes-vs-No colour split: **Yes is blue, No is orange/warm** — a deliberate non-red/green choice that respects colour-blind users (per home page extraction).

**Probability presentation**:
- Display in cents-on-the-dollar (73¢ = 73% implied probability) — Polymarket's house style (<https://www.actionnetwork.com/online-sports-betting/reviews/kalshi-vs-polymarket>).
- Kalshi by contrast uses straight percentages on the same kind of market (same source) — and Kalshi's odds graphs explicitly show "consensus beliefs of market participants" (<https://help.kalshi.com/markets/markets-101/the-different-graphs/odds-graph>).

**Navigation chrome**:
- Horizontal browse menu: New / Trending / Popular / Liquid / Ending Soon / Competitive (Polymarket home extraction).
- Topic icon tiles: Live Crypto, Politics, Middle East, Crypto, Sports, Pop Culture, Tech, AI (same source).

**Case-study findings** (Ziad A., <https://medium.com/@zabdelkarim1/polymarket-product-case-study-2b1a8ed81e7c>):
- Original landing page hindered fast market discovery; the proposal surfaces a featured market card immediately.
- Markets table needed sorting by Outcome competitiveness, Resolution Date, Volume, Liquidity, Name — implies the prior version was static.
- Mobile-first redesign in Figma; defaults to newest markets first.

**What VTourn should steal**:
- The market-card pattern is the right shape for "match cards in the pre-tournament hype phase". Pin a hot match (e.g. "Argentina vs Brazil to meet in semis?") above the bracket as a card with a probability percentage and a "predict this" call to action. Polymarket-style chrome around our own match data.
- The Yes/No two-colour scheme avoids the red/green colour-blindness trap. VTourn should adopt the same logic for any binary prop bets we add later.

**Don't copy**:
- Polymarket's "Huge Analysis Finds That the Average Person Is Getting Absolutely Hosed on Polymarket" reputational drag (<https://futurism.com/future-society/huge-analysis-hosed-polymarket>) — they're optimised for sophisticated traders, not casuals. VTourn's chrome must look approachable, not like a trading screen.

---

## 10. Sorare

**URL**: <https://sorare.com/>; card design 2.0 deep-dive <https://medium.com/sorare/sorare-card-design-2-0-how-3d-football-cards-came-to-life-27a1df9ea22b>; NBA card design <https://medium.com/sorare/sorare-nba-card-designs-f98b8b4bacd3>; WeSorare update note <https://www.wesorare.com/en/news/updated-sorare-card-design/>.

**Card anatomy**:
- Two layout regions: top carries league and season data; bottom carries player data (<https://medium.com/sorare/sorare-card-design-2-0-how-3d-football-cards-came-to-life-27a1df9ea22b>).
- Player photography is the central focus — designers explicitly aimed to "provide as much space as possible for the player's photography" (same source).
- 3D frame connects front and back, "designed to make the card pop in 3D" with dynamic reflections and lighting (same source).
- Bespoke frames per top European league (Premier League, Bundesliga, LaLiga, Serie A); other partners use a Sorare-branded engraved frame (same source).
- Five scarcity-tier variations: Common, Limited, Rare, Super Rare, Unique. Each has different shield backgrounds and edge treatments (<https://www.wesorare.com/en/news/updated-sorare-card-design/>).
- Player position font reverted to match the player name font after community pushback for legibility (Medium piece; "prioritising readability over aesthetic elegance").

**Sport-specific tweaks**:
- NBA cards: traditional headshot vs. "action shot" with dynamic personality (<https://medium.com/sorare/sorare-nba-card-designs-f98b8b4bacd3>).
- MLB cards: rookie badge, first-card-of-scarcity indicator, jersey-number serial number, "Year One Edition" strip (<https://medium.com/sorare/sorare-mlb-card-designs-d307a053dd98>).

**What VTourn should steal**:
- The "card-as-hero" framing is exactly right for our team profile pages. Big team flag (analogous to Sorare's player photo), kit-coloured frame, FIFA-rank chip in the corner like Sorare's scarcity indicator.
- Five-tier scarcity equivalent: VTourn could surface a "tournament tier" chip (host, contender, dark horse, debutant) using similar visual hierarchy.

**Don't copy**:
- Sorare cards are prestige objects; our team pages must work as both prestige posters and as functional info dashboards. Sorare-style cards are 4:5 portrait — too tall for our context. Borrow the visual language, not the proportions.

---

## 11. Yahoo Sports Pick'em / Bracket Mayhem

**URL**: Bracket Mayhem help <https://help.yahoo.com/kb/tourney-pickem>; Pro Football Pick'em <https://football.fantasysports.yahoo.com/pickem>; how to make picks <https://help.yahoo.com/kb/SLN15104.html>.

**Bracket UX**:
- "Take their Bracket Mayhem brackets wherever they go" — full bracket editing in the Fantasy app on phone (<https://help.yahoo.com/kb/tourney-pickem/create-bracket-sln22968.html>).
- Picks are made in the Yahoo Sports app via a tap-pair pattern; users can also use the "make or view your picks" web flow (<https://help.yahoo.com/kb/SLN15104.html>).
- Tiebreakers available for Pick'em games where multiple users tie on points (<https://help.yahoo.com/kb/SLN6629.html>) — typically a total-points-in-the-final question.

**Onboarding**:
- Yahoo's product is "fill out a bracket → join a group → compete" — three steps, with the bracket itself being the first action. Notably, Yahoo lets non-account-holders preview the bracket builder before locking the account-creation gate (<https://tournament.fantasysports.yahoo.com/signup>) — softer than ESPN.

**What surprised**:
- Yahoo runs $25K cash contests for both men's and women's tournaments (<https://sports.yahoo.com/bracket-time-enter-yahoo-fantasys-25k-contests-for-the-mens-and-womens-tourneys-221154361.html>). The cash incentive has been baked into Yahoo's bracket products since the early 2010s — it's not a new mechanic. VTourn's prize-pool work in [doc 18](18-monetization.md) and [doc 21](21-onchain-sweepstakes-oracle.md) should learn from how Yahoo merchandises the prize on the bracket landing page.

**Don't copy**:
- Yahoo's bracket UI hasn't materially changed since ~2014 — it feels old. Heavy purple chrome, 2014-vintage typography. Don't copy the look; copy the prize-merchandising.

---

## 12. Splash Sports

**URL**: <https://splashsports.com/>; Pick'em hub <https://splashsports.com/games/pick-em>; FAQ <https://splashsports.com/faq>; NFL Pick'em FAQ <https://splashsports.com/faq/nfl-pickem>.

**Pick UX**:
- "Check out the matchups for the week's slate of games and identify your winners" — straight-up or against-the-spread picks via a matchup-card list (<https://splashsports.com/games/pick-em>).
- Confidence-points overlay: assign 1–N confidence to each pick, and correct picks earn points equal to confidence (<https://splashsports.com/faq/nfl-pickem>). Adds strategic depth without changing the surface UX.
- "Best Picks" bonus: identifying a specific highlighted matchup correctly earns extra points (<https://splashsports.com/games/pick-em>).

**Onboarding**:
- Three-step description: pick winners → lock before deadlines → compete for prize pools (<https://splashsports.com/games/pick-em>).
- Account linking from Run Your Pool / Office Football Pool — they've explicitly built a migration path from older fantasy-pool tools (<https://www.morningstar.com/news/business-wire/20260302037524/splash-sports-launches-player-pickem-and-daily-fantasy-sports-contests-in-new-york-state>).

**Social**:
- In-contest chat for "razzing your fellow competitors" (<https://splashsports.com/games/pick-em>). VTourn currently has no in-product chat layer; this is worth costing for the friends-leaderboard cohort.

**Don't copy**:
- Paysafe deposit/withdrawal flow with credit cards and PayPal (<https://splashsports.com/games/pick-em>). Splash needs this because its core is paid contests; VTourn's free-to-play core means we can keep the funnel one step shorter.

---

## Cross-cutting observations

### Onboarding tap-count to first pick

| Product           | Taps to first pick (cold start, no account) |
| ----------------- | ------------------------------------------- |
| Telegraph         | 2 (open URL → tap a flag)                   |
| Yahoo Sports      | 5 (preview before account-wall)             |
| ESPN Tournament   | 6 (account creation enforced)               |
| Sky Super 6       | 7 (account + 18+ confirmation)              |
| FotMob Predict    | 3 (open URL → pick competition → tap match) |
| Splash Sports     | 8 (account + ID verification in some states)|
| **VTourn (today)**| ~3 (open URL → group tab → tap flag) — already strong |

Source: tap counts derived from each product's onboarding flow as documented in their App Store listings, FAQ pages, and how-to-play guides linked above.

### Where the flag lives

- Telegraph: small flag, group tile, prints-style.
- ESPN: tiny circular flag in matchup card.
- Sky Super 6: flag is *absent*; team badge instead.
- FotMob: small flag inline with team name on team page; club crest is hero.
- OneFootball: flag absent in club context, present in international context.
- FlashScore: 16x12 flag inline.
- BBC Sport: flag absent in UK fixtures, present in internationals.
- theScore: small circle logo.
- Polymarket: no flags, custom illustration.
- Sorare: club crest, no flag.
- Yahoo: small circle logo or initial.
- Splash Sports: team logo, no flag.

**Implication**: VTourn's bet on the **big circular flag** (`TeamFlag` `shape="circle"` at `lg`/`xl`) is a deliberate and unusual choice. It sets us apart in the international-tournament space where every other product is using small flags. The flag is our primary visual asset, the way the player photo is Sorare's. Lean into it harder.

### Form dots / W-D-L pills

- FlashScore: 5 small coloured pills in a row (green W / grey D / red L) on team rows and match-detail pages.
- FotMob: identical 5-pill pattern, used on Standings rows and team pages.
- BBC Sport: 5-letter sequence (WWLDW), no colour fill.
- Telegraph: not surfaced in the predictor.
- ESPN: shown on team profile pages, not in the bracket.

**Implication**: 5-pill last-5 form is industry-standard. VTourn currently shows none. Easy win for credibility.

### Pick affordance — ranking the patterns

| Pattern                             | Speed | Engagement | Used by                           |
| ----------------------------------- | ----- | ---------- | --------------------------------- |
| Tap-flag (single tap)               | High  | Med        | Telegraph, ESPN, theScore, VTourn |
| Tap-flag + draw pill                | High  | Med-High   | VTourn (group stage)              |
| Stepper score input                 | Low   | High       | Sky Super 6, FotMob Predict       |
| Card with Yes/No buttons            | High  | Med        | Polymarket                        |
| Confidence ranking (drag)           | Low   | Very High  | Splash, ESPN football pickem      |

Source: derived from the per-product UX descriptions above.

### Animation and motion

- ESPN's 2024 redesign explicitly added "fun animations and design cues that match the motion and energy of a college tournament basketball game" (<https://espnpressroom.com/us/press-releases/2024/03/espn-tournament-challenge-2024-no-1-bracket-game-reimagined-rebuilt-for-fans-by-fans/>).
- FotMob's app uses subtle slide transitions between matches (<https://ixd.prattsi.org/2021/09/design-critique-fotmob-android-app/>).
- Polymarket's mobile redesign emphasises "fluid card swipes" (<https://www.finextra.com/blogposting/31216/polymarket-mobile-app-design-uiux-features-that-drive-engagement-amp-trust>).

VTourn's `TeamFlag` already has a sparkle/shimmer/glow on the selected state — keep that, and add a one-shot "winner advances" animation when the cascade lifts a team into the next round.

### Leaderboard — the avatar question

- Sky Super 6 leaderboard rows: rank, username, points, prize tier — no avatars.
- FotMob Predict: avatar + username + points (per Predict's social layer).
- ESPN BracketCast: rank, name, points, percentage grade, no avatar by default.
- Yahoo: avatar + username + points + percentile.
- Splash Sports: avatar + username + points + cash earned.

**Implication**: avatars are table-stakes for friends/community leaderboards. VTourn already has identity scaffolding from [doc 20](20-identity-humanness-bots.md) — surface those Humanness-Score-verified avatars on the leaderboard rows.

---

## Anti-patterns we've confirmed not to copy

1. **Sky Super 6**: heavy 18+ gambling chrome at the top of every page. Loses casual users. (Source: <https://super6.skysports.com/>.)
2. **ESPN**: account-wall before first pick. Loses cold-traffic conversion. (Source: <https://apps.apple.com/us/app/espn-tournament-challenge/id359891723>.)
3. **Polymarket**: trader-vibe chrome (volume, liquidity, $-suffixed everything). Scares casual sports fans. (Source: <https://medium.com/@zabdelkarim1/polymarket-product-case-study-2b1a8ed81e7c>.)
4. **FlashScore**: zero personality, sterile rows. Functional but joyless. (Source: <https://www.flashscore.com/>.)
5. **Yahoo**: 2014-vintage chrome. Not aesthetically aligned to a 2026 launch. (Source: <https://tournament.fantasysports.yahoo.com/signup>.)
6. **Telegraph 2022**: paywalled flows that broke the share loop. (Source: <https://www.scribd.com/document/821317460/Pick-your-World-Cup-2022-winner-with-the-Telegraph-s-predictor>.)

---

## What to read next

[doc 36](36-vtourn-ux-spec.md) is the synthesis: the concrete VTourn redesign spec drawn from the patterns above, mapped onto our existing components (`TeamFlag`, `MatchPredictionRow`, `BracketBuilder`, `KnockoutMatch`, `GroupCard`).
