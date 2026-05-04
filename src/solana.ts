import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import dotenv from "dotenv";
import idl from "./idl.json";

dotenv.config();

// ── Constants ────────────────────────────────────────────────────────────────
export const LAMPORTS_PER_SOL = 1_000_000_000;

// ── Environment validation ───────────────────────────────────────────────────
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// ── Connection & wallet setup ────────────────────────────────────────────────
const rpcUrl = process.env.RPC_URL || clusterApiUrl("devnet");
export const connection = new Connection(rpcUrl, "confirmed");

const privateKeyBase58 = requireEnv("PRIVATE_KEY");
const secretKey = bs58.decode(privateKeyBase58);
export const platformKeypair = Keypair.fromSecretKey(secretKey);

export const PROGRAM_ID = new PublicKey(
  requireEnv("PROGRAM_ID")
);

export const PLATFORM_WALLET = new PublicKey(
  requireEnv("PLATFORM_WALLET")
);

// ── Anchor provider & program ────────────────────────────────────────────────
const wallet = new Wallet(platformKeypair);
export const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

// Use `any` typing to bypass Anchor's deep type recursion issues in TS
export const program = new Program(idl as any, provider as any) as any;

// ── PDA derivation helpers ───────────────────────────────────────────────────

/**
 * Derive the Event PDA from ["event", organizer_pubkey]
 */
export function deriveEventPDA(organizerPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("event"), organizerPubkey.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derive the StakeRecord PDA from ["stake", event_pubkey, attendee_pubkey]
 */
export function deriveStakePDA(
  eventPubkey: PublicKey,
  attendeePubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("stake"),
      eventPubkey.toBuffer(),
      attendeePubkey.toBuffer(),
    ],
    PROGRAM_ID
  );
}

/**
 * Derive the Vault PDA from ["vault", event_pubkey]
 */
export function deriveVaultPDA(eventPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), eventPubkey.toBuffer()],
    PROGRAM_ID
  );
}

// ── Lamport / SOL conversion ─────────────────────────────────────────────────

export function solToLamports(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL));
}

export function lamportsToSol(lamports: BN | number): number {
  const val = typeof lamports === "number" ? lamports : lamports.toNumber();
  return val / LAMPORTS_PER_SOL;
}

// ── Keccak256 password hashing (matches Rust keccak::hash) ───────────────────

import { keccak256 } from "js-sha3";

/**
 * Hash a plaintext password with keccak256, returns a 32-byte Uint8Array.
 * Matches Solana's `keccak::hash(password.as_bytes())`.
 */
export function hashPassword(password: string): number[] {
  const hash = keccak256.arrayBuffer(Buffer.from(password, "utf-8"));
  return Array.from(new Uint8Array(hash));
}

/**
 * Convert a 32-byte array to a hex string for returning to Flutter.
 */
export function hashToHex(hash: number[]): string {
  return Buffer.from(hash).toString("hex");
}

import crypto from "crypto";

/**
 * Deterministically generate a full Ed25519 Keypair from a user's unique ID.
 * This allows the Node API to sign transactions on behalf of the user.
 */
export function deriveUserKeypair(userId: string): Keypair {
  const hash = crypto.createHash("sha256").update(userId).digest();
  return Keypair.fromSeed(hash);
}
