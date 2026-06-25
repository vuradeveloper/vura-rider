import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { createSocketServer } from "./socket";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = http.createServer(app);

// Attach Socket.io
const io = createSocketServer(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[vura-backend] REST API listening on http://0.0.0.0:${PORT}`);
  console.log(`[vura-backend] Socket.io listening on ws://0.0.0.0:${PORT}`);
  console.log(`[vura-backend] Environment: ${process.env.NODE_ENV ?? "development"}`);
});
