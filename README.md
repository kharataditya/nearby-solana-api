# Nearby Solana API

Node.js backend API that bridges the **Nearby** Flutter app with a Solana smart contract for staking-based event attendance.

## Architecture

```
Flutter App → Node.js API → Solana Smart Contract → back to Flutter
```

The API sits between the Flutter frontend and the deployed Anchor program on Solana Devnet. It handles:
- PDA derivation
- Transaction construction & signing
- Keccak256 password hashing
- Lamport ↔ SOL conversion
- Event log parsing for revenue distribution

## Smart Contract

- **Program ID:** `CvqzzBzjGeXQoWjuwtSmWSipWFtum3rzWBq7wtAEpX9x`
- **Network:** Solana Devnet
- **Framework:** Anchor

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check + current slot |
| `POST` | `/api/create-event` | Create a new staking event |
| `POST` | `/api/stake-for-event` | Stake SOL for an event |
| `POST` | `/api/verify-attendance` | Verify attendance via password |
| `POST` | `/api/finalize-event` | Finalize & distribute revenue |
| `GET` | `/api/event/:eventPDA` | Fetch event details from chain |
| `GET` | `/api/stake-status/:eventPDA/:attendeeWallet` | Check stake status |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Base58-encoded private key (platform wallet for signing) |
| `PROGRAM_ID` | Deployed Anchor program ID |
| `RPC_URL` | Solana RPC endpoint (`https://api.devnet.solana.com`) |
| `PORT` | Server port (default: `3000`) |
| `PLATFORM_WALLET` | Public key that receives 20% platform fee |

### 3. Run in development

```bash
npm run dev
```

### 4. Build for production

```bash
npm run build
npm start
```

## Deploy to Railway

### Quick deploy:

1. Push this project to a GitHub repo
2. Go to [railway.app](https://railway.app)
3. Click **New Project → Deploy from GitHub repo**
4. Select your repo
5. Add environment variables in the Railway dashboard:
   - `PRIVATE_KEY`
   - `PROGRAM_ID`
   - `RPC_URL`
   - `PORT`
   - `PLATFORM_WALLET`
6. Railway auto-detects the `build` and `start` scripts

### Railway config (optional `railway.toml`):

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm start"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

## Revenue Split on Finalize

When an event is finalized:
- **50%** → Host (event organizer)
- **30%** → Verified attendees (split equally)
- **20%** → Platform wallet

Slashed pool = stakes from unverified attendees.

## Tech Stack

- Node.js + TypeScript
- Express.js
- @coral-xyz/anchor
- @solana/web3.js
- keccak256 (via js-sha3)
- bs58 for key encoding
