# 21 — On-Chain Sweepstakes and the VTourn Oracle

> User-organised sweepstakes settled by smart contract. **VTourn never touches money.** We publish the verified result of each match (we already do this for VStamps in [doc 17](17-vstamp-and-prediction-iq.md)); a permissionless smart contract reads the published result and pays out users who staked into the pool. VTourn is the **oracle** — a reliable, immutable ledger of tournament outcomes — not the operator. This is an upgrade path on top of the off-platform self-attested pools in [doc 12](12-odds-and-predictions.md), aimed at users who want trustless settlement.

## Why this exists

The off-platform model in doc 12 is fine: the pool is a tracker, members say "I paid" via a button, settlement happens off-platform via Wise / Venmo / cash. Friction is the feature — most pools are friend-group sweeps where trust already exists.

But there's a cohort — crypto-native users, larger pools, strangers organising via Discord — for whom **trustless settlement** is the unlock. Smart contracts solve that:

- Members deposit USDC into a pool contract on-chain.
- The contract knows the prize-distribution rules in advance (winner-takes-all, gold/silver/bronze, custom split).
- When VTourn publishes the verified tournament result, the contract reads it and pays out automatically.
- Nobody has to be trusted; the code is the agreement.

VTourn earns nothing from the pool itself. Our role is **oracle** — we publish authoritative results of matches and tournaments, signed by our oracle key, and the smart contract does the rest. This lines up cleanly with the existing architecture: we already produce settled match results to power Prediction IQ ([doc 17](17-vstamp-and-prediction-iq.md)) and the predictions game ([doc 16](16-game-modes-and-scoring.md)). Publishing those results to a public smart contract is a small additional step.

## What we explicitly are not

- **Not the pool operator.** Users deploy their own pool from a public registry.
- **Not the custodian.** Funds live in the pool contract on-chain, controlled by the contract logic, never touchable by VTourn.
- **Not the betting counterparty.** No house. No edge. No commission on stakes.
- **Not the arbiter of disputes.** If a user disputes the published result, they can challenge via the on-chain oracle protocol; we publish, we don't adjudicate (beyond standard correction processes).

The closest comparison is **Augur**, **UMA**, or **Reality.eth** — established prediction-market oracle protocols. VTourn's role is closer to a *trusted result feed* than a Polymarket-style market-maker. Reality.eth and UMA both solve the "what was the actual outcome of X" problem with their own stake-based dispute systems; we publish into the same pattern.

## Architecture

```
              ┌─────────────────────────────┐
              │  Pool creator (any user)    │
              │  picks: tournament,         │
              │  prize structure, entry,    │
              │  member cap                 │
              └──────────────┬──────────────┘
                             │ deploys
                             ▼
              ┌─────────────────────────────┐
              │  PoolFactory contract       │
              │  (Polygon / Base mainnet)   │
              │  emits new PoolContract     │
              └──────────────┬──────────────┘
                             │ creates
                             ▼
              ┌─────────────────────────────┐
              │  Pool contract              │   ◄── members deposit USDC
              │  (one per pool)             │       via deposit()
              │  - members[]                │
              │  - predictions[]            │   ◄── members submit
              │  - prizeStructure           │       prediction commits
              │  - oracleResultId           │
              └──────────────┬──────────────┘
                             │  reads
                             ▼
              ┌─────────────────────────────┐
              │  VTournOracle contract       │   ◄── VTourn Foundation publishes
              │  (Polygon / Base mainnet)   │       match results, signed by
              │  results[matchId] = winner  │       its oracle key
              └─────────────────────────────┘
                             │
                             │ pool calls finalize() once oracle is set
                             ▼
              ┌─────────────────────────────┐
              │  Pool contract              │
              │  computes ranks per         │
              │  predictions × oracle       │
              │  results, distributes       │
              │  prize per prizeStructure   │   ◄── members withdraw
              └─────────────────────────────┘       their share automatically
```

Three contracts:

1. **`PoolFactory.sol`** — anyone can call `createPool(...)` to deploy a new pool with their chosen parameters. Cheap (~$0.30 on Polygon). Emits a `PoolCreated` event with the new pool's address.
2. **`Pool.sol`** — one instance per pool. Holds USDC, accepts `deposit()` from approved members, accepts `submitPrediction()` until lock, computes rankings against the oracle, distributes prize on `finalize()`.
3. **`VTournOracle.sol`** — VTourn Foundation-controlled contract that records authoritative match results. Each `setResult(matchId, outcome)` call is signed by the Foundation's oracle key (an air-gapped multisig); same key that signs VStamp Merkle roots ([doc 17](17-vstamp-and-prediction-iq.md)).

### Why two chains

Default deployment on **Polygon** for cheap gas and large EVM ecosystem. **Base** as a mirror for users who prefer the Coinbase L2. Both run the same contracts; pools opt-in to one or the other on creation. The oracle publishes to both.

### Why USDC

Stablecoin denominated, regulated issuer, widely supported in fiat on-ramps, well-understood by users and tax authorities. The contract restricts deposits to USDC only — no native MATIC / ETH staking, no exotic tokens. This dramatically narrows the regulatory surface.

## User flow

### Pool creator

1. On VTourn web or in the Telegram bot: `/pool new`.
2. Choose: tournament, entry amount in USDC, prize structure, member cap, deadline for joining.
3. Choose **on-chain** vs **off-platform self-attested** (the existing flow from [doc 12](12-odds-and-predictions.md)).
4. If on-chain, the UI prompts the user to connect a wallet (MetaMask, Rainbow, Coinbase Wallet, WalletConnect — standard EVM wallet UX).
5. User signs a transaction that calls `PoolFactory.createPool(...)`. Transaction fee: ~$0.30 on Polygon.
6. Pool contract address is shown; UI generates an invite link encoding the address.

### Pool member

1. Friend taps the invite link.
2. UI verifies their identity (wallet must be registered to a VTourn account; if not, prompts auth).
3. UI prompts wallet signature to call `pool.deposit(amount)` (a single USDC ERC-20 approval + deposit).
4. UI walks them through prediction submission as usual ([doc 16](16-game-modes-and-scoring.md)).
5. Predictions are committed on-chain via `pool.submitPrediction(predictionHash)` — only the hash, full prediction stays off-chain.
6. Pool locks at the configured deadline; nobody can deposit or change predictions after.

### Settlement

1. Tournament ends; VTourn publishes results to `VTournOracle` (typically a single transaction batch covering an entire tournament's worth of match outcomes; ~$5–$20 on Polygon).
2. Anyone (any pool member, the creator, even a stranger) can call `pool.finalize()`. Contract reads results from the oracle, ranks members by prediction-vs-result accuracy, computes payouts per the predefined `prizeStructure`.
3. Each winner can call `pool.withdraw()` and receives their USDC.
4. Pool contract is now fully settled and has zero balance.

End to end, VTourn never holds funds. Members never need to trust the creator. Creator never needs to chase members for entry fees. Result is published once, on-chain, immutable.

## VTournOracle in detail

This is where the trust does live. The oracle's published results are the single source of truth for any pool that uses it.

### Result format

```solidity
struct MatchResult {
    bytes32 matchId;            // matches the spec match_id
    bytes32 resultHash;         // sha256 of full result payload (off-chain on CDN)
    bytes32 resultPayloadCID;   // IPFS CID of full result payload (mirror)
    uint8 outcome;              // home=1, away=2, draw=3, void=0, ongoing=255
    int16 homeScore;
    int16 awayScore;
    uint64 finalisedAt;
}

mapping(bytes32 => MatchResult) public results;

function setResult(MatchResult calldata r, bytes calldata signature) external {
    require(verifyOracleKey(r, signature), "bad oracle signature");
    require(results[r.matchId].finalisedAt == 0, "already set");
    results[r.matchId] = r;
    emit ResultPublished(r.matchId, r.outcome);
}
```

Every result is:
- Signed by the Foundation's oracle key (the `signature` param verifies against a stored public key on-chain).
- Linked to a full result payload on IPFS / CDN (so anyone can audit not just the outcome but the underlying event log, lineup, and substitutions).
- Immutable once written.

### Dispute and correction

Real-world matches sometimes get amended (a goal disallowed on review the next morning, a forfeit, an abandonment). The oracle has two relief mechanisms:

- **Pre-finalisation correction**: if a result is published and a pool hasn't called `finalize()` yet, a multisig action can `correctResult(matchId, newResult)` within a 24-hour window. Pools always read the latest state.
- **Post-finalisation challenge**: too late to correct via the oracle; the pool is settled. For high-value disputes, a community-run challenge protocol (UMA-flavoured) can issue a counter-result with bonded stake; we'll wire to UMA's existing infrastructure rather than build our own.

The result-publication policy is itself published — what kinds of post-event corrections we accept (red card overturned post-match: yes, before 24h; goal disallowed by VAR re-review next day: no, too late) and how we handle abandoned matches (ruled `void` and pool refunds), forfeits (oracle records the official ruling), etc.

### Why a multisig oracle key

A single key signing oracle results is a single point of failure. The Foundation oracle key is a 4-of-7 multisig — same security model as the VStamp anchor key. The signers are: 3 Foundation board members, 2 elected community reps from the contributor pool, 2 independent industry observers (sports data background). Quarterly rotation.

A compromised single signer cannot publish a fraudulent result. A coalition of 4 can publish *any* result, so the multisig members are accountable.

## Composability with VStamp

The oracle and VStamp share infrastructure:

- Same multisig key signs VStamp Merkle roots and oracle results. When the prediction commitment phase ends and the result phase begins, no new infrastructure is needed.
- A single transaction can publish both: a Merkle root for the day's locked predictions *and* the result of yesterday's matches. Saves gas, simplifies operations.
- Pool contracts can verify (via the on-chain Merkle root + supplied proof) that a given member's prediction was indeed committed before the match started. Predictions thereafter cannot be falsely retroactively claimed — the same proof system proves the chain-of-custody.

This means an on-chain pool offers *strictly stronger* trust guarantees than the off-platform self-attested pool: not only is settlement trustless, but each member's prediction is verifiably committed before the match.

## Regulatory framing

This is the section that needs careful framing. Three points:

### Point 1 — VTourn is the oracle, not the operator

We publish results. The pool contracts are deployed by users, run on permissionless infrastructure (Polygon / Base), and pay out to users. VTourn Foundation has zero ability to alter pool outcomes once the result is set, and can only set results that match the verified outcome of the actual sporting event.

This positions VTourn similarly to a price oracle (Chainlink, Pyth, UMA) rather than a sportsbook or a prediction-market operator. Price oracles aren't gambling operators despite many financial products depending on them.

### Point 2 — The pool is user-organised

The pool is created by a user, joined by other users, settled by a smart contract, and pays out user-to-user. There is no "operator". Every parameter (prize structure, entry amount, deadline) is set by the pool creator. VTourn provides software that makes deploying such a pool easier; it does not run any pool.

The legal label that may attach is "facilitator". Different jurisdictions treat facilitators differently:

- **US** — a clear question whether facilitator software is treated like a sportsbook. We'd need explicit counsel before launching to US users. Default: **on-chain pools not offered to US users.**
- **UK** — similar concern. The Gambling Commission's stance on prediction-market facilitators is evolving. **On-chain pools not offered to UK users without explicit licensing review.**
- **Australia** — Interactive Gambling Act 2001 broadly restricts online gambling services. **On-chain pools not offered to AU users.**
- **NZ** — TAB monopoly applies to "race and sports betting" specifically; user-organised on-chain pools may not technically fit that definition, but the safest position is **not offered to NZ users** until counsel confirms.
- **EU** — varies by member state; some regulated regimes are more crypto-permissive (Malta, Estonia), others restrictive.
- **Canada** — provincial regulation; varies.
- **Crypto-friendly jurisdictions** with established DeFi precedent (e.g. parts of LATAM, Singapore, Switzerland, UAE) — generally permissive for non-custodial protocols.

The geo-routing engine from [doc 18](18-monetization.md) gates access. NZ / US / UK / AU users see only the off-platform self-attested pools from [doc 12](12-odds-and-predictions.md); users in legal jurisdictions see both options.

### Point 3 — We publish results regardless of pool jurisdiction

The oracle's results are published whether or not pools exist in any given jurisdiction. The oracle is a public dataset. NZ users can't *use* it for sweepstakes settlement under the current legal framing, but they can absolutely read it as a verified results feed for free-play VTourn purposes.

## Tax and reporting

For pool members, USDC winnings are typically taxable income in their jurisdiction. VTourn does not issue tax forms (we don't see the transactions; the user's wallet does). Pool participants are responsible for their own tax compliance.

Pool *creators* may have higher reporting obligations depending on jurisdiction (organising a paid contest can have its own reporting requirements). The UI surfaces a "consult your tax advisor" reminder at pool-creation time.

For VTourn Foundation, the oracle service generates no revenue. Gas costs to publish results (~$10–$50 per matchday batch on Polygon) come out of the operating reserve from [doc 19](19-open-source-and-contributor-revenue.md). At sufficient scale we may charge sponsoring brands to "co-sign" prominent matchday result publications (a marketing feature, not a fee on users) — see [doc 18](18-monetization.md) for the sponsorship model.

## What the contracts look like (sketch)

Real contracts to be specced and audited; this is the rough shape for an agent to begin from.

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVTournOracle {
    struct MatchResult {
        bytes32 matchId;
        uint8 outcome;
        int16 homeScore;
        int16 awayScore;
        uint64 finalisedAt;
        bytes32 resultHash;
    }
    function results(bytes32 matchId) external view returns (MatchResult memory);
    function isResultSet(bytes32 matchId) external view returns (bool);
}

contract Pool {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IVTournOracle public immutable oracle;

    address public creator;
    bytes32 public tournamentId;
    bytes32[] public matchIds;        // the matches this pool covers
    uint256 public entryAmount;       // USDC, 6 decimals
    uint64  public lockTime;
    uint16  public memberCap;

    enum PrizeStructure { WinnerTakesAll, GoldSilverBronze, Custom }
    PrizeStructure public prizeStructure;
    uint256[] public prizeSplitBps;   // basis points; sums to 10000

    mapping(address => bool) public hasJoined;
    mapping(address => mapping(bytes32 => bytes32)) public predictionCommit; // member → match → predHash
    address[] public members;
    bool public finalized;
    uint256 public totalPot;

    function deposit() external { /* requires not locked, not joined */ }
    function submitPrediction(bytes32 matchId, bytes32 predictionHash) external { /* before lock */ }
    function finalize() external { /* reads oracle, ranks, distributes */ }
    function withdraw() external { /* member claims their share */ }
}

contract PoolFactory {
    event PoolCreated(address indexed pool, address indexed creator, bytes32 tournamentId);
    function createPool(/*...*/) external returns (address) { /* deploys minimal proxy */ }
}

contract VTournOracle {
    address public multisig;          // 4-of-7 governance multisig
    mapping(bytes32 => IVTournOracle.MatchResult) private _results;

    function setResult(IVTournOracle.MatchResult calldata r) external {
        require(msg.sender == multisig, "unauthorized");
        require(_results[r.matchId].finalisedAt == 0, "already set");
        _results[r.matchId] = r;
        emit ResultPublished(r.matchId, r.outcome);
    }

    // 24h correction window
    function correctResult(bytes32 matchId, IVTournOracle.MatchResult calldata r) external {
        require(msg.sender == multisig, "unauthorized");
        require(block.timestamp - _results[matchId].finalisedAt < 24 hours, "window closed");
        _results[matchId] = r;
        emit ResultCorrected(matchId);
    }
}
```

For deployment efficiency, `Pool` is a minimal proxy / clone (EIP-1167) — `PoolFactory` deploys cheap clones of a single pre-deployed implementation.

A full audit by Trail of Bits, OpenZeppelin, ConsenSys Diligence, or similar is required before mainnet deployment. Budget: $30k–$80k for a focused audit on this contract surface.

## How this composes with the rest of VTourn

- **Doc 12** keeps the off-platform self-attested pool as the default for friend-group sweeps. Most pools should be off-platform — friction is the feature when trust already exists.
- **Doc 17** (VStamps + Prediction IQ) provides the prediction-commitment layer that on-chain pools verify against.
- **Doc 18** (monetization) is unaffected — oracle service generates no per-user revenue; sponsorship of result publications is opt-in marketing.
- **Doc 19** (open source) covers the smart contract licensing — Apache 2.0 like everything else; community can audit, fork, deploy parallel infrastructure if they choose.
- **Doc 20** (humanness) feeds into pool UX — high-humanness scores are a comfort signal in stranger-pool participation; pool creators can opt to require minimum humanness for joiners.

## Acceptance criteria

- [ ] `PoolFactory.createPool(...)` deploys a new Pool on Polygon for under $0.50 in gas.
- [ ] A pool member's `deposit()` and `submitPrediction()` flow completes in two transactions and under $0.20 in gas combined.
- [ ] After `VTournOracle.setResult(...)` for all the pool's matches, anyone can call `pool.finalize()` and the contract correctly distributes USDC per the prize split.
- [ ] `pool.withdraw()` for the winner returns the correct USDC amount and zeroes their balance.
- [ ] Re-running `finalize()` is a no-op (idempotent).
- [ ] `correctResult` works inside the 24h window and reverts after.
- [ ] Multisig oracle key cannot be drained, replaced, or used to publish results outside the configured chain.
- [ ] Geo-routing in the web UI prevents NZ / US / UK / AU users from creating an on-chain pool until counsel confirms.
- [ ] Trail of Bits / OpenZeppelin audit completed with no high-severity findings before mainnet launch.

## Sources

- [UMA Protocol — optimistic oracle](https://uma.xyz/)
- [Reality.eth — crowd-sourced verification](https://reality.eth.limo/)
- [Chainlink Sports Data Feeds](https://chain.link/data-feeds)
- [OpenZeppelin Contracts (ERC-20 / Clones)](https://docs.openzeppelin.com/contracts/)
- [Polygon mainnet — gas + transaction costs](https://polygon.technology/)
- [Base — Coinbase L2](https://base.org/)
- [Trail of Bits — smart contract auditing](https://www.trailofbits.com/)
- [Augur v2 — peer-to-peer prediction markets](https://augur.net/)
