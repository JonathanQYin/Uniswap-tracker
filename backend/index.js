// =====================
//  Minimal Backend Server
//  Serves processed JSON from /data
// =====================

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create express app
const app = express();
app.use(cors());

// Serve backend/data folder at /data
app.use("/data", express.static(path.join(process.cwd(), "data")));

app.get("/", (req, res) => {
  res.send("Uniswap Web Project Backend is running.");
});

// Start server
app.listen(3000, () => {
  console.log("Backend running at http://localhost:3000");
  console.log("Serving JSON data at http://localhost:3000/data/");
});
