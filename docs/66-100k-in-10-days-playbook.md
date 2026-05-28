# 66, 100,000 players in 10 days, zero budget

> **Target: 100,000 registered players by 2026-06-10 (one day before
> WC kickoff).** Budget: NZ$0. Channels: every legal one with a
> measurable yield. Built on the assets already shipped: warm-invite
> URL with prefilled name/email/mobile, OTP via WhatsApp + email in
> 10 seconds, multilingual (EN/ES/PT/DE/IT/FR/NL), open source,
> non-betting. This doc is the ruthless prioritisation of HOW.

## The maths, so we're honest about it

100,000 players in 10 days = 10,000/day average. That's not a
viral-app accident. It comes from one of three engines, or a stack
of them:

| Engine | Players if it works | Probability |
|---|---:|---|
| 1 mega media hit (front of NZ Herald, Reddit r/soccer top, HN front page, X viral thread by a 1M-follower account) | 30,000-150,000 each | 5-15% per attempt |
| 50 federation-tier yeses (each forwarding to 100-2,000 affiliated clubs/members) | 25,000-75,000 cumulative | 30-50% if all 50 are tried |
| Tail of corporate / school / club / fan-page sends with 5-200 members per pool | 20,000-50,000 cumulative | 50-80% if 1,000+ sends attempted |
| Viral share/challenge mechanic on existing registrations (each registered player invites ~1.5) | 1.4x multiplier on whatever else lands | 100% (already built) |

**The realistic path to 100k:** ONE mega media hit + 30 federation-
tier yeses + 500 long-tail sends + 1.4x viral multiplier. Each leg
of that is plausible. None of them is solo-sufficient. So we run
ALL of them in parallel and let the dice fall.

Backstop assumption: even if we miss 100k and hit 25k, the
acquisition cost was zero. Every player past breakeven (which is
zero) is pure upside. The downside is the time spent. So spend it.

## The 7 attack vectors

Ordered by token-per-yield, highest first. Run all 7 starting today;
do not wait for any one of them to "land" before starting the next.

---

### Vector 1, The mega-media hit (one of these = 30-150k)

A single viral hit is the only path that COULD hit 100k from a
single event. We can't predict which fires, so we attempt several
in parallel.

**1.1 The Reddit play (today, ~2 hours)**

- **r/soccer** (4.7M members). Title: "I built a free, open-source
  World Cup prediction game with no app, no signup, no betting. We
  used it for our office sweepstake and it took 5 minutes." Body:
  founder story, screenshots, github link, demo URL. **Do NOT post
  on a Friday or Saturday US time** (low engagement); post at
  Tuesday 09:00 NZT = Monday 20:00 ET = peak r/soccer.
- **r/USsoccer + r/MLS** (combined 1M+) — adapted version focused
  on US co-hosting and the World Cup-on-home-soil hook.
- **r/Argentina_Futbol, r/futbol, r/brasileirao, r/BeisbolMexico**
  (combined 500k+) — Spanish/Portuguese versions of the same post.
- **r/programming + r/opensource + r/webdev** (combined 3M+) — the
  technical-launch angle: "Show: open-source WC2026 prediction game
  in Next.js + React Three Fiber, no app, no signup, fully
  multilingual." Different audience, different hook, same URL.

Risk: any of these posts can get removed for self-promo. Soften:
post under your own account, mention building it for your office
first, don't link the GitHub repo in the title (link it in a top
comment instead). If a mod removes one, that's fine, move on.

**1.2 Hacker News (today)**

- "Show HN: Tournamental, a free open-source FIFA WC2026 prediction
  game (no app, no signup, no betting)"
- Aim for HN front page in the first 2 hours of the day (US morning
  = late evening NZT). The HN audience won't all play, but the
  press follow-on is the prize: Verge, TechCrunch, Hacker Noon,
  HN itself = secondary press hits = secondary signups.

**1.3 X (Twitter) viral thread (today, plus daily until kickoff)**

- 10-tweet thread: "I spent the last 6 weeks building a free
  open-source FIFA World Cup 2026 prediction game. Here's the maths
  for why it might destroy DraftKings if it works." (Thread covers
  the maths, the screenshots, the source code, an invite to play.)
- Reply to every football journalist's WC2026 tweet for the next 10
  days with a one-line "FYI free open-source non-betting option
  exists if your readers want one: [URL]". Annoying-but-effective.
  Pick the right journos: Tariq Panja (NYT, 200k), Henry Winter
  (Times, 700k), Miguel Delaney (Indep., 200k), Sid Lowe
  (Guardian, 300k), Rory Smith (NYT, 400k).
- Reply to the Twitter accounts of fan media: The Athletic Football
  pod, The Rest is Football, Tifo Football, Stick to Football, etc.
  Same one-liner, never the same phrasing twice (Twitter
  shadow-bans repetition).

**1.4 NZ media (today + every day, daily pitch cycle)**

- **NZ Herald sports** — pitch the founder story angle: "Auckland
  consultant builds free, open-source WC2026 prediction tool;
  challenges the dominance of paid gambling apps." Email
  sport@nzherald.co.nz + LinkedIn DM the sports editor.
- **RNZ Mornings** — Anti-gambling angle: "A free, open-source
  alternative to TAB-sponsored sweepstakes." Email
  morningreport@rnz.co.nz.
- **Stuff sports** — Kiwi-built, going-global, multilingual angle.
- **The Spinoff** — Madeleine Chapman loves a Kiwi-founder-with-no-
  budget story. Email madeleine@thespinoff.co.nz with the VSL link.
- **NewsHub Sport / 1News Sport** — 90-second on-air package; demo
  on the studio TV. Pitch with screen-record + founder photo.
- **Seven Sharp / The Project / Breakfast** — light-and-bright
  segment, "this Kiwi built a free thing for the World Cup."
- **Newstalk ZB Sport (Jason Pine, Jason Reeves)** — 5-min phone
  interview, instant ~50k listener reach.
- **SENZ Breakfast (Tony Veitch + Mark Watson)** — football-mad
  audience, perfect resonance.

Pitch template lives at `docs/63-vsl-script-and-production-brief.md`
section "Distribution." Modify per outlet.

**1.5 International press (long-shots but each is 50k+ if it lands)**

- **The Athletic (UK/US)** — pitch tactic@theathletic.com with the
  "non-betting prediction game" angle.
- **Marca / AS (Spain)** — Spanish-language landing-page exists,
  pitch with screenshots.
- **Globo / UOL / GE.com (Brazil)** — Portuguese-language ditto.
- **The Guardian Football** — open-source angle would resonate.
- **TechCrunch / The Verge / Wired** — tech-launch angle, founder
  story. Pitch tips@techcrunch.com.

Hit rate is brutal (~1%). Volume cures that: 30 pitches → ~1 hit.

---

### Vector 2, Federation cascades (the 30-yes target = 25-75k)

The 7 outreach lists already in `tools/outreach-lists/` cover
~2,400 federation-tier and club-tier contacts. The maths:

- 2,400 contacts
- 20% open rate on cold email = 480 reads
- 10% reply rate of those = 48 replies
- 60% of replies become yeses = ~30 federation yeses

Each federation yes that actually forwards to its affiliated clubs
reaches between 50 (small regional FA) and 2,000 (London FA, FPF
Brazil, NRF Auckland). Average 300 clubs per federation. 30 yeses
= 9,000 clubs reached at the federation-forward level. At 20%
of clubs actually spinning up a pool and 30 members per pool that's
54,000 members. Conservative on every number = 25k. Optimistic
= 75k.

**This vector is already in motion.** What accelerates it:

**2.1 Send everything today, not over a week.** Speed is the only
moat. WC kickoff is non-negotiable; we have 10 days. Get all 2,400
sends out by Sunday EOD.

**2.2 Personal sends to Tier 1-3 of `docs/65-personal-call-list.md`.**
The 10 humans who get a phone call from Tim are worth 100 cold
emails each. Don't email them, call them.

**2.3 HighLevel voice AI to the 2,400 long tail.** 100 calls/day at
5-10% pickup, 10% positive response. Stacks. Script template
needs writing (one-page, 60-second pitch).

**2.4 Per-language SECOND pass.** Each market gets a follow-up at
day 5 if no response: "Hi again from Auckland, just resending in
case the first one got lost in your inbox; we'd love to set up an
[Org] pool for the WC." Reply rate doubles with a polite follow-up.

**2.5 LinkedIn message duplicate of every email.** If Tim has the
person's LinkedIn (the personal call list does), DM them the same
day. Two channels = 2-3x reply rate vs email alone.

---

### Vector 3, Workplace / corporate sweepstakes (target = 10-25k)

Every office in NZ that has 50+ staff will run a WC sweepstake.
Most will use a spreadsheet. We replace the spreadsheet for free.

**3.1 The big-employer hit list (already in playbook F2 of doc 62).**
NZ's 100 largest employers each have 1,000-30,000 staff. Even 5
yeses = 5,000-150,000 staff reached, of whom 20-40% will sign up.

Targets in priority order:
1. Air New Zealand (12k staff) — pitch via LinkedIn to People &
   Culture or the internal social-club lead
2. Fonterra (10k) — same
3. ANZ NZ (8k), Westpac NZ (5k), BNZ (4k), ASB (5k) — banks have
   formal "wellness" budgets that can sponsor a pool
4. Spark (5k), 2degrees (1.5k), One NZ (2.5k)
5. Foodstuffs / Countdown (40k+ combined across stores)
6. The Warehouse Group (12k)
7. Auckland Council (12k), Wellington City Council (2k)
8. Beca, Aurecon, Mott MacDonald (engineering, ~3k each)
9. PwC NZ, Deloitte NZ, KPMG NZ, EY NZ (consulting, ~1.5k each)
10. The big law firms (Russell McVeagh, Bell Gully, Buddle Findlay,
    Chapman Tripp, MinterEllison) ~600 each

Approach: LinkedIn search "social club" OR "office sweepstake" OR
"team engagement" + the company name. 70% of these companies have
a named "Social Club" group on Yammer or a formal internal social
committee. DM the lead.

**3.2 Real estate agencies (huge databases, motivated to use them).**

- Bayleys (1,400 agents nationally) — agents already mail clients
  monthly; a free "WC pool gift" for clients is a perfect touchpoint
- Barfoot & Thompson (Auckland, 1,500 agents) — same
- Harcourts (NZ-wide, 2,000+ agents) — same
- LJ Hooker, Ray White, Tall Poppy — same

Pitch: the agent's CLIENT database, not the agency's staff. Each
agent has 200-2,000 past-clients. 20 agents × 500 clients = 10,000
recipients. The agent gets a brand touchpoint, the client gets a
free WC pool. Pitch to head-of-marketing at each, ask if they'd
allow a co-branded pool template their agents can use.

**3.3 Trade groups / professional associations.**

- The Institute of Directors NZ (~10,000 members)
- Chartered Accountants ANZ (~30,000 NZ members)
- Engineering NZ (~10,000)
- NZ Law Society (~14,000)
- Te Pou Tāngata / HRNZ (~5,000)

Pitch their member-comms team: a free WC pool branded for members,
optional. Most will say no (compliance), but even one yes = 5-10k.

---

### Vector 4, Viral mechanics (1.4x multiplier on everything)

These are built into the platform already (per the codebase work
done over the last sprint). The point of this vector is to USE them
deliberately and make sharing as low-friction as possible.

**4.1 The "share your bracket" prompt on submission.**

Already shipped (see `apps/web/components/share/*`). Every player
who submits their bracket gets a one-tap share card with their
picks + a CTA "challenge a friend." WhatsApp, X, FB native share.
**Pre-WC tweak**: change the share copy to "Beat me to the final —
I picked [TEAM] to win" rather than the generic "I made my picks"
so the share looks like a personalised challenge, not a promo.

**4.2 The country leaderboard hook.**

Currently the leaderboard is global + per-pool. Add a **per-country
leaderboard** ("Argentina is currently 3rd globally in pick
accuracy; help us to #1") that updates live. National pride is the
strongest viral hook in football. This is a ~2-day frontend build;
worth doing if anyone has cycles. **If not built, fake-shipped
version:** static "Country Stats" page with current standings, no
interactivity. Even the static version is a press hook ("Tim's tool
shows Argentina is ahead").

**4.3 The "Top Tipster of the World" hype on every match settle.**

After every WC match settles, automatically post (via the existing
content pipeline) a 1-line social card: "Match settled: Argentina
3-1 Saudi. Top tipster this round: @username, who's now Argentina's
#1." Make the username clickable to their public bracket. Tying
identity to performance = sharing for ego = viral.

**4.4 The screenshot-worthy moment.**

After a player finishes the bracket they see a personal "stats card"
they can save as PNG: their picks visualised, their confidence
score, a unique colour gradient based on their picks. People save
these and post them. Already built? If not, half-day build, big ROI.

**4.5 The country-of-origin spike.**

When a player signs up, show them "you're the [Nth] player from
[country] to join." Creates per-country tribes. Players from
under-represented countries are more likely to share to recruit
their compatriots.

**4.6 Anti-virality to AVOID.**

- Do NOT auto-DM friends from someone's contact list. Spam.
- Do NOT require a share to unlock anything. Feels coercive.
- Do NOT use "you've been INVITED!" emails with fake personalisation.
  The warm-invite URL is fine because there's a real human invite
  on the other end of it. Don't fake that.

---

### Vector 5, Guerrilla / IRL (low cost, high signal in NZ specifically)

Auckland has ~30 football-watching pubs, every uni campus has a
noticeboard, every football clubroom has a wall. These are
zero-marginal-cost real-estate.

**5.1 Sticker drop (today; cost: $80 at Vistaprint).**

500 stickers, 4cm x 4cm, QR code → warm-invite URL (no specific
pool, just the homepage with a "join the global pool" CTA). Tim
puts them in:
- Lamp-posts in football pub districts: Ponsonby, Kingsland,
  Newmarket, K Road, Wynyard Quarter, Mt Eden Village, Kingsland.
- The bathroom of every Auckland football pub: Galbraith's Alehouse,
  The Trusty Cobbler, The Fox, The Pog Mahones, The Roseberry,
  Pacific Spirit, Free House. Bathrooms are read-while-you-pee; CTR is
  surprisingly good.
- The football kit-changing rooms of every Auckland club Tim has
  access to (his son's school, friend-of-friend clubs).
- Sky Tower foot, Britomart, the back of bus seats on the city loop.
- Cost: stickers $80 + Tim's evening time. Reach: 5-50k unique impressions over 10 days.

**5.2 A4 posters (today; cost: $40 at OfficeMax).**

100 posters, QR + 3-line pitch ("Free WC2026 prediction pool, no
app, no money, bragging rights only, play.tournamental.com").
- Uni campus noticeboards: UoA, AUT, Massey Albany. ~50 boards.
- Football club clubrooms: 40+ clubs in Auckland metro will let you
  pin a poster if you ask via Facebook DM.
- Sports retail counters: Football Central, Soccer United, 100% Football,
  Players Sports. Ask them to display.

**5.3 Pub-screen takeover (today; cost: ZERO).**

Walk into 10 Auckland sports bars before kickoff with a tablet
and a 1-page proposal: "I'll set up a pool for your bar for free,
branded, with the leaderboard on your TV behind the bar for the 5
weeks of the WC. You get a reason to talk about it on your social
feed, your customers get to come back to check standings. Zero
cost, zero ongoing setup, I do everything."
- Galbraith's, Free House, The Roseberry (the cluster on Mt Eden Rd).
- Fox + Hounds (Newmarket).
- The Carpenters Arms (Mt Eden).
- The Northern Steamship (Britomart).
- Same playbook for Wellington (The Library, Hashigozake, Goldings),
  Christchurch (Pomeroy's, Volstead).

Each bar = 100-500 customers over 5 weeks. 10 bars = 1-5k reach.

**5.4 Eden Park / Sky Stadium pre-WC events.**

Any pre-WC friendlies at Eden Park (All Whites have a friendly TBD
in May/June). Set up a folding table outside the entrance with a
sign + iPad: "Sign up for the free WC2026 pool, win Bragging Rights".
Get 50-200 signups per gate, plus social-media content
("here's me signing people up outside Eden Park").

**5.5 The "Founder-on-the-street" video.**

Tim records 60-second street interviews in Queen St / K Rd asking
random people their WC predictions, then offers to sign them up
on the spot via the warm-invite URL. Edit into 5 x 60s reels for
TikTok + Instagram + LinkedIn. Each reel has CTR + retention
benefit; cost: zero except a Saturday afternoon.

---

### Vector 6, Cross-sport leverage (target = 5-15k)

NZ football fans are a subset of NZ sport fans. The bigger pool is
NZ Rugby + NZ Cricket fans. Many of them will engage with a WC
prediction tool just because they're competitive.

**6.1 NZ Rugby clubs.**

Every NZ rugby club has a WhatsApp group. Many of them will run a
"rugby club's WC football pool" for the banter and bragging rights.
NZ Rugby Union itself has ~600k fans on their database. Pitch to
their CMO: a free pool branded for the All Blacks fan list, "watch
the football, predict the football, even rugby fans love a punt."

**6.2 NZ Cricket / NZC fan list.**

Similar; ~250k subscribers. White Ferns + Black Caps fan list = a
warm audience that respects sport-tech.

**6.3 NPL netball, hockey, basketball (NBL) clubs.**

Every team-sport club in NZ has admin infrastructure. Most are run
by volunteers who'd love a free engagement tool for their summer
break. ~500 NZ sports clubs across non-football sports = ~50,000
members reachable via the same federation-first pattern.

**6.4 The school sports angle.**

NZ secondary schools have a sports coordinator at every school.
There are ~400 secondary schools. NZSS Football is the umbrella.
A single yes from NZSS = forwarded to all 400 sports coordinators
= ~150,000 students + parents touched. Already targeted in
`docs/65-personal-call-list.md` (Tier 1, NZ Football + similar).

---

### Vector 7, AI-personalised cold outreach (the unfair advantage)

We have Anthropic API access. Cold email reply rates are 5x when
the opener references something specific about the recipient. AI
makes that scalable.

**7.1 Hyper-personalised opening line per cold email.**

For every contact in the 2,400-row Sheets, fetch their website's
recent news / last fixture / recent press release / latest social
post. Generate a 1-sentence opener that proves we know who they
are. Append to the standard template. Result: cold-email reply
rate jumps from ~5% to ~15-25%. On 2,400 sends that's the
difference between 120 yeses and 480 yeses.

Implementation: ~half-day Python script. Loop CSV → fetch website
homepage → Claude API call to summarise one specific recent event
→ insert into email template → save back as ready-to-send.

**7.2 Auto-translate the campaign into 50+ languages.**

We have native templates for EN/ES-castilian/ES-rioplatense/PT-BR/
PT-PT. Anthropic API can produce native-quality versions in 50 more
languages in an afternoon: Arabic for MENA federations, Mandarin
for AFC, Korean, Japanese, Turkish, Polish, Czech, Greek, Hebrew,
Swahili, French (variants for FR/QC/Sénégal/Maroc), Bahasa,
Vietnamese, Tagalog. Covers every FIFA member.

**7.3 AI voice for the long-tail call list.**

HighLevel voice AI already configured. Script template (1 page,
60-second pitch, branching for "tell me more / not interested / put
me through to comms"). Tim flips it on, AI calls 100/day, 1-2
warm leads/day land in his inbox. Stacks across 10 days = 10-20
warm leads from zero human time after setup.

**7.4 AI-generated meme content.**

50 memes / cards per team, in the team's language, with the URL
watermarked. Post to TikTok + Insta + X via a scheduling tool
(Buffer free tier). Auto-coverage during the tournament. Costs ~$20
in Claude API tokens.

---

## The 10-day calendar (cadence matters)

| Day | Date | Focus | Concrete |
|---|---|---|---|
| 0 | Today (2026-05-29) | All sends fire, all assets ship | Sends: 2,400 emails out by EOD. Stickers + posters printed. VSL recorded. Stickers placed in 5 of 30 districts. |
| 1 | Fri 05-30 | Tier 1 personal calls | Tim calls the 10 humans in docs/65 Tier 1. HL Voice AI flips on. NZ media pitch day 1 sent. |
| 2 | Sat 05-31 | Reddit + HN launch | r/soccer + r/USsoccer + Show HN go live at peak hours. X thread posted. |
| 3 | Sun 06-01 | Pub-screen takeover | Tim visits 10 Auckland sports bars. NZ media follow-up. |
| 4 | Mon 06-02 | Tier 2 personal calls | Tim calls 10-20 in docs/65 Tier 2. Email follow-ups go out (auto). |
| 5 | Tue 06-03 | International press push | Marca / Globo / Athletic pitches sent. Spanish + Portuguese Reddit posts. |
| 6 | Wed 06-04 | Cross-sport pivot | NZ Rugby + NZ Cricket + NPL netball cold sends. |
| 7 | Thu 06-05 | Corporate / real-estate | LinkedIn cold-DM campaign to social-club leads at top 100 employers + 6 real-estate networks. |
| 8 | Fri 06-06 | Final media push | Founder-on-the-street video drops. Last NZ media outlet asks. |
| 9 | Sat 06-07 | Eden Park gate + IRL | All Whites friendly (if scheduled). Tim signs people up at the gate. Reddit day-of-kickoff thread. |
| 10 | Mon 06-09 | Last 48-hour blitz | LinkedIn personal post: "WC kicks off in 48 hours, here's where you can join the global free pool." X thread. Daily-mail-style "viral last-chance" framing. |

By 2026-06-11 kickoff: 100k goal, measured at midnight NZT.

---

## Risk + ethics (don't get banned mid-blitz)

- **Reddit self-promo rules:** post from a Tim-authored account that
  has prior comment history; never post from a fresh account.
- **Twitter shadow-ban risk:** don't reply with the same exact text
  twice in 24h; vary the phrasing.
- **GDPR / privacy:** the cold sends are B2B + go to published
  org-level emails. Don't scrape personal Gmail addresses. Don't
  bulk-import phone numbers that weren't published as business
  contact info.
- **Spam filter risk:** send cold sends in batches of <50 per hour
  from any single domain. Use Tim's `tim@growthspurt.agency` for
  consulting-adjacent sends and a `tim@tournamental.com` for
  pure-platform sends so spam reputation doesn't bleed across.
- **Gambling regulator risk:** explicitly do not market as a
  betting/gambling product. The differentiator IS the lack of money,
  use it as the pitch.
- **Trademark risk:** never use FIFA branding without licence; use
  generic "World Cup 2026" or "WC26". The licenced retail partners
  (Rebel Sport for prize packs) can use FIFA branding because they
  sell licenced merchandise; Tournamental itself cannot.

---

## What to do TODAY (first 4 hours)

If Tim does nothing else from this doc in the next 4 hours, do these
five things:

1. **Open Gmail Drafts. Tweak + send the 10 drafts already drafted.**
   These 10 federation-tier emails are the highest-leverage moves of
   the entire 14-day blitz. Send them BEFORE doing anything else.
2. **Call Rod Duke at Briscoe Group** (Rebel Sport MD). Single call,
   3 minutes. Whatever happens, that call shifts the trajectory of
   the NZ retail leg.
3. **Post on r/soccer.** Schedule for Tuesday peak hour if today
   isn't optimal. Pre-write the post + draft 2-3 alternate titles
   in case the first gets removed by mods.
4. **Record the VSL** per `docs/63-vsl-script-and-production-brief.md`.
   It's the single biggest cold-asset. 90 minutes of work.
5. **Print the 500 stickers** at Vistaprint (4cm x 4cm, QR code,
   $80, ships overnight). Put them on lamp-posts Sunday morning.

Do those five. Everything else in this doc compounds on top.

---

## What to delegate to AI (set up once, runs all 10 days)

Tim's time is the scarcest resource. These run autonomously after
setup:

- **HL voice AI call queue** — script in `docs/66-hl-voice-ai-script.md`
  (write next), upload the federation CSVs as call lists, set rate
  limit to 100 calls/day.
- **Auto-personalised cold email pass** — Python script that loops
  the Sheets, generates 1-sentence openers via Anthropic API,
  outputs ready-to-send drafts in Gmail. Tim spot-checks then bulk-
  sends.
- **Auto-translate to 50 languages** — single batch script,
  Anthropic API, outputs `docs/67-multilang-templates/<lang>.md`
  for each. Used by the long-tail FA outreach.
- **Auto-meme generator** — Anthropic API + a meme template lib,
  outputs PNGs to `tools/social-content/`. Tim's scheduling tool
  posts daily.

---

## Acknowledgments

Tim built the platform in 6 weeks at his own cost. The product is
genuinely good (the warm-invite URL + OTP + multilingual is
unmatched in the WC prediction-game space). The work in this
doc is purely distribution; the product carries it.

100k in 10 days, no budget, no team, fueled by federation
forwards and viral shares. It's tight but it's not crazy. Ship.

---

Last updated 2026-05-29. Owner: Tim. Next review: 2026-06-04
(mid-blitz checkpoint).
