// server.js — Auth + dual storage: Postgres in prod, file+backups in dev
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");

const app = express();
const PORT = process.env.PORT || 5001;
const usePG = !!process.env.DATABASE_URL;

app.use(cors({ origin: true, credentials: true })); // allow cookies from same origin
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1); // needed on some hosts to set secure cookies

// --- session cookies (secure login) ---
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-insecure";
app.use(
  cookieSession({
    name: "sess",
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: "none",
    secure: !!process.env.NODE_ENV && process.env.NODE_ENV !== "development",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  })
);

// ---------- File storage (dev only) ----------
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "projects.json");
const BK_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || "30", 10);

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BK_DIR)) fs.mkdirSync(BK_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
}
function writeFileAtomic(file, jsonVal) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(jsonVal, null, 2));
  fs.renameSync(tmp, file);
}
function readAllFile() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}
function listBackups() {
  if (!fs.existsSync(BK_DIR)) return [];
  return fs.readdirSync(BK_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => ({ name: f, path: path.join(BK_DIR, f), mtime: fs.statSync(path.join(BK_DIR, f)).mtimeMs }))
    .sort((a,b) => b.mtime - a.mtime);
}
function createBackup(snapshot) {
  const ts = new Date().toISOString().replace(/:/g, "-");
  writeFileAtomic(path.join(BK_DIR, `${ts}.json`), snapshot);
  const all = listBackups();
  if (all.length > MAX_BACKUPS) for (const f of all.slice(MAX_BACKUPS)) { try { fs.unlinkSync(f.path); } catch {} }
}
function writeAllFileAndBackup(value) {
  const payload = value ?? [];
  writeFileAtomic(DATA_FILE, payload);
  createBackup(payload);
}

// ---------- Postgres storage (prod) ----------
let pgPool = null;
async function initPG() {
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined,
  });
  await pgPool.query(`
    create table if not exists users (
      id serial primary key,
      email text unique not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists app_state (
      user_id integer primary key references users(id) on delete cascade,
      payload jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
}
async function getUserByEmail(email) {
  const { rows } = await pgPool.query(`select * from users where email=$1`, [email]);
  return rows[0] || null;
}
async function createUser(email, password) {
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pgPool.query(
    `insert into users (email, password_hash) values ($1,$2) returning id, email`,
    [email, hash]
  );
  // pre-create empty state row
  await pgPool.query(
    `insert into app_state (user_id, payload) values ($1, '[]'::jsonb) on conflict (user_id) do nothing`,
    [rows[0].id]
  );
  return rows[0];
}
async function readAllPG(userId) {
  const { rows } = await pgPool.query(`select payload from app_state where user_id=$1`, [userId]);
  return rows?.[0]?.payload ?? [];
}
async function writeAllPG(userId, value) {
  const payload = value ?? [];
  await pgPool.query(
    `insert into app_state (user_id, payload) values ($1, $2::jsonb)
     on conflict (user_id) do update set payload = excluded.payload, updated_at = now()`,
    [userId, JSON.stringify(payload)]
  );
}

// ---------- Auth helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "auth required" });
  next();
}

// ---------- Auth routes ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    if (usePG) {
      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "email already exists" });
      const user = await createUser(email, password);
      req.session.userId = user.id;
      res.json({ ok: true, email: user.email });
    } else {
      // dev only: single user session without DB
      req.session.userId = 1;
      res.json({ ok: true, email });
    }
  } catch (e) {
    console.error("register error:", e);
    res.status(500).json({ error: "failed to register" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  if (usePG) {
    const user = await getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });
    req.session.userId = user.id;
    return res.json({ ok: true, email: user.email });
  } else {
    // dev only: accept anything, single user
    req.session.userId = 1;
    return res.json({ ok: true, email });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ userId: req.session.userId || null });
});

// ---------- Data routes (protected) ----------
app.get("/api/projects", requireAuth, async (_req, res) => {
  try {
    if (usePG) return res.json(await readAllPG(_req.session.userId));
    return res.json(readAllFile());
  } catch (e) {
    console.error("GET /api/projects error:", e);
    res.status(500).json({ error: "failed to read projects" });
  }
});

app.post("/api/projects", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? [];
    if (usePG) await writeAllPG(req.session.userId, body);
    else writeAllFileAndBackup(body);
    res.json({ status: "ok" });
  } catch (e) {
    console.error("POST /api/projects error:", e);
    res.status(500).json({ error: "failed to save projects" });
  }
});

app.put("/api/projects", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? [];
    if (usePG) await writeAllPG(req.session.userId, body);
    else writeAllFileAndBackup(body);
    res.json({ status: "ok" });
  } catch (e) {
    console.error("PUT /api/projects error:", e);
    res.status(500).json({ error: "failed to save projects" });
  }
});

// --- Dev-only backup utilities still available in file mode ---
if (!usePG) {
  app.get("/api/backups", (_req, res) => {
    const items = listBackups().map(({ name, mtime }) => ({ name, mtime }));
    res.json({ backups: items, count: items.length, keeping: MAX_BACKUPS });
  });
}

// ---- Serve React build (single-domain deploy) ----
const CLIENT_DIR = path.join(__dirname, "build");
app.use(express.static(CLIENT_DIR));
// SPA fallback: any GET that does NOT start with /api/
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

(async () => {
  if (usePG) {
    await initPG();
    console.log("Using Postgres storage (DATABASE_URL set).");
  } else {
    ensureStorage();
    console.log("Using local file storage with backups (no DATABASE_URL).");
    console.log(`Data file: ${DATA_FILE}`);
  }
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
})();
