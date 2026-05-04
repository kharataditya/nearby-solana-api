import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./routes";

// Load environment variables before anything else
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── Middleware ────────────────────────────────────────────────────────────────

// Enable CORS for Flutter app requests (allow all origins for dev)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Parse JSON bodies (limit increased for potential large payloads)
app.use(express.json({ limit: "5mb" }));

// Request logging (lightweight)
app.use((req, _res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

app.use("/api", routes);

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    service: "Nearby Solana API",
    version: "1.0.0",
    description: "Bridge between Nearby Flutter app and Solana smart contract",
    endpoints: {
      health: "GET /api/health",
      createEvent: "POST /api/create-event",
      stakeForEvent: "POST /api/stake-for-event",
      verifyAttendance: "POST /api/verify-attendance",
      finalizeEvent: "POST /api/finalize-event",
      getEvent: "GET /api/event/:eventPDA",
      getStakeStatus: "GET /api/stake-status/:eventPDA/:attendeeWallet",
    },
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[Unhandled Error]", err.message);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
);

// ── Start server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         🚀 Nearby Solana API — Running           ║
╠══════════════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(37)}║
║  Network:  ${(process.env.RPC_URL?.includes("devnet") ? "Solana Devnet" : "Solana Mainnet").padEnd(37)}║
║  Program:  ${process.env.PROGRAM_ID?.slice(0, 20)}...${" ".repeat(14)}║
╚══════════════════════════════════════════════════╝
  `);
});

export default app;
