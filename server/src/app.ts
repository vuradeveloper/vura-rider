import express from "express";
import cors from "cors";
import usersRouter from "./routes/users";
import driversRouter from "./routes/drivers";
import ridesRouter from "./routes/rides";
import earningsRouter from "./routes/earnings";
import ratingsRouter from "./routes/ratings";

const app = express();

app.use(cors());
app.use(express.json());

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
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

export default app;
