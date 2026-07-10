import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import usersRouter from "./routes/users";
import driversRouter from "./routes/drivers";
import ridesRouter from "./routes/rides";
import earningsRouter from "./routes/earnings";
import ratingsRouter from "./routes/ratings";
import paymentsRouter from "./routes/payments";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);

app.options("*", cors());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "900000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use("/api/", limiter);

app.use("/api/payments/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/users", usersRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/rides", ridesRouter);
app.use("/api/earnings", earningsRouter);
app.use("/api/ratings", ratingsRouter);
app.use("/api/payments", paymentsRouter);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
);

export default app;
