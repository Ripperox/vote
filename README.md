# DAO Governance

> An on-chain DAO governance dApp — delegate voting power, create proposals, vote For / Against / Abstain, and execute outcomes once quorum is met. Solidity smart contracts with a fast, event-driven ethers.js frontend.

![CI](https://github.com/Ripperox/vote/actions/workflows/ci.yml/badge.svg)

---

## Features

- **Token-weighted governance** — voting power is tracked by a `GovernanceToken` (ERC-20 + delegation), so votes are weighted by delegated balance rather than one-address-one-vote.
- **Delegation & historical snapshots** — holders delegate their voting power; the contract writes per-account vote **checkpoints** so a proposal's outcome is computed against the supply/voting power **snapshotted at proposal time** (`getPastVotes` / `getPastTotalSupply`). This prevents flash-loan / last-minute vote buying.
- **Full proposal lifecycle** — `Pending → Active → Succeeded / Defeated → Executed`, plus `Canceled`. State is derived deterministically on-chain from block numbers and tallies.
- **Quorum enforcement** — a proposal must reach **4%** of the snapshot total supply *and* have `For > Against` to succeed.
- **For / Against / Abstain voting** with optional on-chain reason strings, double-vote protection, and per-proposal vote records.
- **Polished frontend** — MetaMask connection with auto-reconnect, network detection + one-click Sepolia switch, a wallet dropdown (copy address / view on Etherscan / disconnect), live proposal cards with vote bars and quorum progress, toasts, and real-time updates driven by contract events.

---

## Architecture

### Contract layer (`contracts/DAO.sol`, Solidity ^0.8.20)

| Contract | Responsibility |
| --- | --- |
| `GovernanceToken` | ERC-20 with owner-gated minting, **delegation**, and **vote checkpoints**. Exposes `getVotes`, `getPastVotes`, and `getPastTotalSupply` (binary-search checkpoint lookup) in the spirit of OpenZeppelin's `ERC20Votes` / EIP-5805. |
| `DAO` | The governor. Holds proposals, tallies weighted votes against a snapshot, and enforces the state machine + quorum. Key params: `VOTING_DELAY = 1` block, `VOTING_PERIOD = 50,400` blocks (~1 week), `QUORUM_BPS = 400` (4%). Support values: `0 = Against`, `1 = For`, `2 = Abstain`. |

**Voting power is snapshotted** at the proposal's creation block, so transferring or delegating tokens *after* a proposal is created cannot change its outcome.

### Frontend layer (`index.html` / `app.js` / `style.css`)

- **ethers.js 5.7** (via CDN) talking to **MetaMask** (EIP-1193).
- **Event-driven UI**: subscribes to contract events to update proposal cards and stats in real time, with no page reloads.
- Vanilla JS, no build step — the site is fully static and can be served from any static host.

---

## Tech Stack

- **Smart contracts:** Solidity `^0.8.20`
- **Tooling / tests:** Hardhat 2 + `@nomicfoundation/hardhat-toolbox`, Chai, Hardhat Network Helpers
- **Frontend:** ethers.js 5.7, MetaMask, vanilla JS/CSS
- **E2E testing:** Playwright (Chromium)
- **Runtime / package manager:** [Bun](https://bun.sh)
- **CI:** GitHub Actions

---

## Screenshots

> _Add screenshots / a GIF of the running dApp here._

| Proposals view | Wallet connected |
| --- | --- |
| _`docs/proposals.png`_ | _`docs/wallet.png`_ |

---

## Getting Started

> This project uses **Bun** as the runtime and package manager.

### 1. Install dependencies

```bash
bun install
```

### 2. Compile the contracts

```bash
bun run compile        # hardhat compile
```

### 3. Run the unit tests

```bash
bun run test           # hardhat test
```

### 4. Run the frontend

```bash
bun run start          # serve . -p 3000  ->  http://localhost:3000
```

Open the site in a browser with MetaMask installed and switch it to the **Sepolia** testnet.

### 5. Deploy to Sepolia (optional)

Set the required environment variables (e.g. in a `.env` file or your shell):

```bash
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/<your-key>"
export PRIVATE_KEY="0x<deployer-private-key>"   # never commit this
```

Then deploy:

```bash
bun run deploy:sepolia   # hardhat run scripts/deploy.js --network sepolia
```

The script deploys `GovernanceToken`, then `DAO` wired to it, and prints both addresses. Update `CONTRACT_ADDRESS` in `app.js` with the deployed **DAO** address.

---

## Testing

The repo ships with two independent, fully-green test suites that also run in CI on every push and pull request.

### Smart-contract unit tests — `test/DAO.test.js`

**36 Hardhat/Chai tests** covering:

- `GovernanceToken`: owner-only minting, zero-address guard, delegation assigning voting power, vote-power transfer between delegates, `getPastVotes` checkpoint behaviour, and `getPastTotalSupply`.
- `propose`: voting-power gating, `ProposalCreated` event args, stored proposal fields, and the initial `Pending` state.
- `castVote`: For / Against / Abstain tallies, `VoteCast` events, reason strings, double-vote and invalid-support reverts, zero-power reverts, and voting-window enforcement.
- **State machine & quorum**: `Pending → Active` transition, `Succeeded` vs `Defeated` (including a tie, and a proposal **defeated purely on quorum** despite more For than Against), and `quorumVotes()`.
- `execute`: success path + `ProposalExecuted`, reverts for non-succeeded proposals, and no double execution.
- `cancel`: proposer-only cancellation (Pending & Active), non-proposer revert, post-window revert, and blocked voting after cancellation.

```bash
bun run test
```

### Frontend E2E tests — `e2e/dao.spec.js`

**5 Playwright tests** (Chromium) that serve the static site and verify the UI shell + wallet flow:

- page loads with the **DAO Governance** title;
- the stats bar renders four cards (Total / Active Proposals, Your Voting Power, Quorum Required);
- tab navigation toggles `aria-selected` across Active / Pending / Succeeded / Defeated;
- with **no wallet** injected, a "MetaMask not detected" toast appears and the connect button shows **No Wallet**;
- with a **mocked** `window.ethereum`, clicking Connect transitions to the connected wallet menu (truncated address), the dropdown opens (Copy Address / View on Etherscan / Disconnect), and Disconnect restores the Connect button.

```bash
bunx playwright install chromium   # one-time
bun run test:e2e                   # playwright test
```

### Continuous Integration

`.github/workflows/ci.yml` runs two jobs on every push / PR using Bun:

1. **contracts** — `bunx hardhat compile` + `bunx hardhat test`
2. **e2e** — installs Chromium and runs `bunx playwright test`

---

## Contract Addresses

| Network | Contract | Address |
| --- | --- | --- |
| Sepolia | DAO (deployed v1) | [`0x92382d1d6d19095217b4de2a8edf452f1e6c55fc`](https://sepolia.etherscan.io/address/0x92382d1d6d19095217b4de2a8edf452f1e6c55fc) |

> **Note on contract versions.** The address currently wired into the live frontend (`CONTRACT_ADDRESS` in `app.js`) is a **simpler v1** membership-style DAO (`addMember` / `createProposal` / `vote`). The contract in **`contracts/DAO.sol`** is the full, more robust governance implementation — delegation, historical vote checkpoints, weighted For/Against/Abstain voting, and 4% quorum — and is the version exercised by the unit-test suite above. Deploy it with `bun run deploy:sepolia` and update `CONTRACT_ADDRESS` to point the frontend at the full governor.

---

## Project Layout

```
.
├── contracts/DAO.sol        # GovernanceToken + DAO governor
├── scripts/deploy.js        # Deploy GovernanceToken then DAO
├── test/DAO.test.js         # 36 Hardhat unit tests
├── e2e/dao.spec.js          # 5 Playwright E2E tests
├── hardhat.config.js        # solc 0.8.20, optimizer, Sepolia network
├── playwright.config.js     # static server + Chromium
├── index.html / app.js / style.css   # static frontend
└── .github/workflows/ci.yml # CI: compile + unit tests + E2E
```
