import { Router, Request, Response } from "express";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  program,
  connection,
  platformKeypair,
  PLATFORM_WALLET,
  deriveEventPDA,
  deriveStakePDA,
  deriveVaultPDA,
  solToLamports,
  lamportsToSol,
  hashPassword,
  hashToHex,
  deriveUserKeypair,
} from "./solana";

const router = Router();

// ── Error helper ─────────────────────────────────────────────────────────────

function errorResponse(res: Response, error: unknown, statusCode = 500) {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  // Extract Anchor error if available
  const anchorError = (error as any)?.error?.errorMessage || null;
  const errorCode = (error as any)?.error?.errorCode?.number || null;

  console.error("[API Error]", message, anchorError || "");

  return res.status(statusCode).json({
    success: false,
    error: anchorError || message,
    errorCode,
  });
}

// ── Map known Anchor error codes to human-readable messages ─────────────────

function mapAnchorError(error: unknown): { message: string; status: number } {
  const code = (error as any)?.error?.errorCode?.number;
  switch (code) {
    case 6000:
      return { message: "Event is not active", status: 400 };
    case 6001:
      return { message: "Already staked for this event", status: 409 };
    case 6002:
      return { message: "Invalid event password", status: 403 };
    case 6003:
      return { message: "Event deadline has not been reached yet", status: 400 };
    case 6004:
      return { message: "Insufficient funds to stake", status: 400 };
    case 6005:
      return { message: "Attendance already verified", status: 409 };
    case 6006:
      return { message: "Unauthorized action", status: 403 };
    default:
      return {
        message: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POST /api/create-event
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/create-event", async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      organizerWallet,
      name,
      location,
      stakeAmountSol,
      password,
      eventDeadline,
    } = req.body;

    // ── Validate inputs ──────────────────────────────────────────────────
    if (!organizerWallet || !name || !location || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: organizerWallet, name, location, password",
      });
    }

    if (typeof stakeAmountSol !== "number" || stakeAmountSol <= 0) {
      return res.status(400).json({
        success: false,
        error: "stakeAmountSol must be a positive number",
      });
    }

    if (typeof eventDeadline !== "number") {
      return res.status(400).json({
        success: false,
        error: "eventDeadline must be a unix timestamp",
      });
    }

    // ── Derive PDAs ──────────────────────────────────────────────────────
    // The Flutter app sends the raw Supabase UID as organizerWallet
    const userKeypair = deriveUserKeypair(organizerWallet);
    const organizerPubkey = userKeypair.publicKey;
    const [eventPDA] = deriveEventPDA(organizerPubkey);
    const stakeAmountLamports = solToLamports(stakeAmountSol);
    const passwordHashArray = hashPassword(password);

    // Fund the organizer's generated wallet with enough SOL for account rent (~3,000,000 lamports)
    const fundInstruction = SystemProgram.transfer({
      fromPubkey: platformKeypair.publicKey,
      toPubkey: organizerPubkey,
      lamports: 5_000_000, // 0.005 SOL buffer for rent
    });

    // ── Send transaction ─────────────────────────────────────────────────
    const tx = await program.methods
      .createEvent(
        name,
        location,
        stakeAmountLamports,
        passwordHashArray,
        new BN(eventDeadline)
      )
      .accounts({
        event: eventPDA,
        organizer: organizerPubkey,
        systemProgram: PublicKey.default,
      })
      .preInstructions([fundInstruction])
      .signers([platformKeypair, userKeypair])
      .rpc({ commitment: "confirmed" });

    return res.json({
      success: true,
      eventPDA: eventPDA.toBase58(),
      transactionSignature: tx,
      passwordHash: hashToHex(passwordHashArray),
    });
  } catch (error) {
    const { message, status } = mapAnchorError(error);
    return errorResponse(res, new Error(message), status);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. POST /api/stake-for-event
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/stake-for-event", async (req: Request, res: Response): Promise<any> => {
  try {
    const { attendeeWallet, eventPDA: eventPDAString } = req.body;

    if (!attendeeWallet || !eventPDAString) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: attendeeWallet, eventPDA",
      });
    }

    // Flutter sends the Supabase UID as attendeeWallet
    const userKeypair = deriveUserKeypair(attendeeWallet);
    const attendeePubkey = userKeypair.publicKey;
    const eventPubkey = new PublicKey(eventPDAString);

    // Derive PDAs
    const [stakePDA] = deriveStakePDA(eventPubkey, attendeePubkey);
    const [vaultPDA] = deriveVaultPDA(eventPubkey);

    // Fetch event to know the stake amount
    const eventAccount = await program.account.event.fetch(eventPubkey);
    const stakedAmount = lamportsToSol(eventAccount.stakeAmount.toNumber());

    // Fund the attendee's generated wallet with the required stake amount + rent buffer
    const requiredLamports = eventAccount.stakeAmount.toNumber() + 5_000_000;
    const fundInstruction = SystemProgram.transfer({
      fromPubkey: platformKeypair.publicKey,
      toPubkey: attendeePubkey,
      lamports: requiredLamports,
    });

    // ── Send transaction ─────────────────────────────────────────────────
    const tx = await program.methods
      .stakeForEvent()
      .accounts({
        event: eventPubkey,
        stakeRecord: stakePDA,
        vault: vaultPDA,
        attendee: attendeePubkey,
        systemProgram: PublicKey.default,
      })
      .preInstructions([fundInstruction])
      .signers([platformKeypair, userKeypair])
      .rpc({ commitment: "confirmed" });

    return res.json({
      success: true,
      transactionSignature: tx,
      stakedAmount,
    });
  } catch (error) {
    const { message, status } = mapAnchorError(error);
    return errorResponse(res, new Error(message), status);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. POST /api/verify-attendance
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/verify-attendance", async (req: Request, res: Response): Promise<any> => {
  try {
    const { attendeeWallet, eventPDA: eventPDAString, password } = req.body;

    if (!attendeeWallet || !eventPDAString || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: attendeeWallet, eventPDA, password",
      });
    }

    // Flutter sends the Supabase UID as attendeeWallet
    const userKeypair = deriveUserKeypair(attendeeWallet);
    const attendeePubkey = userKeypair.publicKey;
    const eventPubkey = new PublicKey(eventPDAString);
    const [stakePDA] = deriveStakePDA(eventPubkey, attendeePubkey);

    // ── Send transaction ─────────────────────────────────────────────────
    // Contract handles password hashing + comparison internally
    const tx = await program.methods
      .verifyAttendance(password)
      .accounts({
        event: eventPubkey,
        stakeRecord: stakePDA,
        attendee: attendeePubkey,
      })
      .signers([platformKeypair, userKeypair])
      .rpc({ commitment: "confirmed" });

    return res.json({
      success: true,
      transactionSignature: tx,
      verified: true,
    });
  } catch (error) {
    const { message, status } = mapAnchorError(error);
    return errorResponse(res, new Error(message), status);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. POST /api/finalize-event
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/finalize-event", async (req: Request, res: Response): Promise<any> => {
  try {
    const { organizerWallet, eventPDA: eventPDAString } = req.body;

    if (!organizerWallet || !eventPDAString) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: organizerWallet, eventPDA",
      });
    }

    // Flutter sends the Supabase UID as organizerWallet
    const userKeypair = deriveUserKeypair(organizerWallet);
    const organizerPubkey = userKeypair.publicKey;
    const eventPubkey = new PublicKey(eventPDAString);
    const [vaultPDA] = deriveVaultPDA(eventPubkey);

    // ── Send transaction ─────────────────────────────────────────────────
    const tx = await program.methods
      .finalizeEvent()
      .accounts({
        event: eventPubkey,
        vault: vaultPDA,
        organizer: organizerPubkey,
        platformWallet: PLATFORM_WALLET,
        systemProgram: PublicKey.default,
      })
      .signers([platformKeypair, userKeypair])
      .rpc({ commitment: "confirmed" });

    // ── Parse RevenueDistributed event from transaction logs ──────────────
    let slashedPool = 0;
    let hostAmount = 0;
    let perAttendeeBonus = 0;
    let platformFee = 0;

    try {
      const txDetails = await connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (txDetails?.meta?.logMessages) {
        const logs = txDetails.meta.logMessages;

        // Anchor emits events as base64 in program logs
        // Look for "RevenueDistributed" log entries
        for (const log of logs) {
          if (log.includes("RevenueDistributed")) {
            const matches = log.match(
              /slashedPool:\s*(\d+).*hostAmount:\s*(\d+).*perAttendeeBonus:\s*(\d+).*platformFee:\s*(\d+)/
            );
            if (matches) {
              slashedPool = lamportsToSol(parseInt(matches[1]));
              hostAmount = lamportsToSol(parseInt(matches[2]));
              perAttendeeBonus = lamportsToSol(parseInt(matches[3]));
              platformFee = lamportsToSol(parseInt(matches[4]));
            }
          }
        }

        // If pattern matching didn't work, calculate from event data
        if (slashedPool === 0) {
          const eventAccount = await program.account.event.fetch(eventPubkey);
          const totalStaked = eventAccount.totalStaked.toNumber();
          const verifiedCount = eventAccount.verifiedCount;
          const attendeeCount = eventAccount.attendeeCount;
          const unverified = attendeeCount - verifiedCount;
          const stakePerPerson = eventAccount.stakeAmount.toNumber();

          const slashedLamports = unverified * stakePerPerson;
          slashedPool = lamportsToSol(slashedLamports);
          hostAmount = lamportsToSol(Math.floor(slashedLamports * 0.5));
          platformFee = lamportsToSol(Math.floor(slashedLamports * 0.2));
          const attendeePool =
            slashedLamports -
            Math.floor(slashedLamports * 0.5) -
            Math.floor(slashedLamports * 0.2);
          perAttendeeBonus =
            verifiedCount > 0
              ? lamportsToSol(Math.floor(attendeePool / verifiedCount))
              : 0;
        }
      }
    } catch (parseError) {
      console.warn("[Log Parse Warning]", parseError);
      // Non-fatal — return tx success even if log parsing fails
    }

    return res.json({
      success: true,
      transactionSignature: tx,
      slashedPool,
      hostAmount,
      perAttendeeBonus,
      platformFee,
    });
  } catch (error) {
    const { message, status } = mapAnchorError(error);
    return errorResponse(res, new Error(message), status);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/event/:eventPDA
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/event/:eventPDA", async (req: Request, res: Response): Promise<any> => {
  try {
    const eventPubkey = new PublicKey(req.params.eventPDA);

    const eventAccount = await program.account.event.fetch(eventPubkey);

    return res.json({
      success: true,
      name: eventAccount.name,
      location: eventAccount.location,
      stakeAmountSol: lamportsToSol(eventAccount.stakeAmount.toNumber()),
      isActive: eventAccount.isActive,
      attendeeCount: eventAccount.attendeeCount,
      verifiedCount: eventAccount.verifiedCount,
      totalStakedSol: lamportsToSol(eventAccount.totalStaked.toNumber()),
      eventDeadline: eventAccount.eventDeadline.toNumber(),
      organizer: eventAccount.organizer.toBase58(),
    });
  } catch (error) {
    // Account not found
    if ((error as Error).message?.includes("Account does not exist")) {
      return res.status(404).json({
        success: false,
        error: "Event not found on chain",
      });
    }
    return errorResponse(res, error);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/stake-status/:eventPDA/:attendeeWallet
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/stake-status/:eventPDA/:attendeeWallet",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const eventPubkey = new PublicKey(req.params.eventPDA);
      // Flutter sends the Supabase UID as attendeeWallet
      const userKeypair = deriveUserKeypair(String(req.params.attendeeWallet));
      const attendeePubkey = userKeypair.publicKey;

      const [stakePDA] = deriveStakePDA(eventPubkey, attendeePubkey);

      try {
        const stakeAccount = await program.account.stakeRecord.fetch(stakePDA);

        return res.json({
          success: true,
          hasStaked: true,
          isVerified: stakeAccount.isVerified,
          stakedAmountSol: lamportsToSol(stakeAccount.stakedValue.toNumber()),
        });
      } catch {
        // Stake account doesn't exist → user hasn't staked
        return res.json({
          success: true,
          hasStaked: false,
          isVerified: false,
          stakedAmountSol: 0,
        });
      }
    } catch (error) {
      return errorResponse(res, error);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// Health check
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/health", async (_req: Request, res: Response): Promise<any> => {
  try {
    const slot = await connection.getSlot();
    return res.json({
      success: true,
      status: "healthy",
      network: process.env.RPC_URL?.includes("devnet") ? "devnet" : "mainnet",
      currentSlot: slot,
      platformWallet: PLATFORM_WALLET.toBase58(),
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      status: "unhealthy",
      error: "Cannot connect to Solana RPC",
    });
  }
});

export default router;
