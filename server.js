// server.js
const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = 5001;
const DATA_FILE = "./data/projects.json";

// Allow React frontend and all needed methods
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// GET all projects
app.get("/api/projects", (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]");
  }
  const data = fs.readFileSync(DATA_FILE, "utf-8");
  res.json(JSON.parse(data));
});

// POST (overwrite) projects
app.post("/api/projects", (req, res) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
  res.json({ status: "ok" });
});

// PUT (overwrite) projects — same behavior as POST
app.put("/api/projects", (req, res) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
  res.json({ status: "ok" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
