// server.js — Auth + Postgres(prod) / File(dev), sessions, profile, backup/restore, serve React build
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");

const app = express();
const PORT = process.env.PORT || 5001;
const usePG = !!process.env.DATABASE_URL;

app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// --- Session cookies ---
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-insecure";
const IS_PROD = process.env.NODE_ENV === "production";
app.use(
  cookieSession({
    name: "sess",
    secret: SESSION_SECRET,
    httpOnly: true,
    // In production we allow cross-site cookies so localhost can log into Render API.
    sameSite: IS_PROD ? "none" : "lax",
    secure: IS_PROD,
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
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}
function listBackups() {
  if (!fs.existsSync(BK_DIR)) return [];
  return fs
    .readdirSync(BK_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      path: path.join(BK_DIR, f),
      mtime: fs.statSync(path.join(BK_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}
function createBackup(snapshot) {
  const ts = new Date().toISOString().replace(/:/g, "-");
  writeFileAtomic(path.join(BK_DIR, `${ts}.json`), snapshot);
  const all = listBackups();
  if (all.length > MAX_BACKUPS) {
    for (const f of all.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(f.path);
      } catch {}
    }
  }
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
      display_name text,
      created_at timestamptz not null default now()
    );
    create table if not exists app_state (
      user_id integer primary key references users(id) on delete cascade,
      payload jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now()
    );
    do $$
    begin
      if not exists (
        select 1 from information_schema.columns
        where table_name='users' and column_name='display_name'
      ) then
        alter table users add column display_name text;
      end if;
    end $$;
  `);
}
async function getUserByEmail(email) {
  const { rows } = await pgPool.query(`select * from users where email=$1`, [email]);
  return rows[0] || null;
}
async function getUserById(id) {
  const { rows } = await pgPool.query(
    `select id, email, display_name from users where id=$1`,
    [id]
  );
  return rows[0] || null;
}
async function createUser(email, password, displayName) {
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pgPool.query(
    `insert into users (email, password_hash, display_name) values ($1,$2,$3) returning id, email, display_name`,
    [email, hash, displayName || null]
  );
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
async function updatePasswordPG(userId, oldPassword, newPassword) {
  const { rows } = await pgPool.query(`select password_hash from users where id=$1`, [userId]);
  const u = rows[0];
  if (!u) throw new Error("user not found");
  const ok = await bcrypt.compare(oldPassword, u.password_hash);
  if (!ok) throw new Error("invalid credentials");
  const hash = await bcrypt.hash(newPassword, 12);
  await pgPool.query(`update users set password_hash=$1 where id=$2`, [hash, userId]);
}
async function updateDisplayNamePG(userId, displayName) {
  await pgPool.query(`update users set display_name=$1 where id=$2`, [displayName || null, userId]);
}

// ---------- Auth helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "auth required" });
  next();
}

// ---------- Auth routes ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    if (usePG) {
      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "email already exists" });
      const user = await createUser(email, password, name || null);
      req.session.userId = user.id;
      return res.json({ ok: true, email: user.email, displayName: user.display_name || null });
    } else {
      // dev only: single user; store email/displayName in cookie session to show "Signed in as"
      req.session.userId = 1;
      req.session.email = email;
      req.session.displayName = name || null;
      return res.json({ ok: true, email, displayName: name || null });
    }
  } catch (e) {
    console.error("register error:", e);
    res.status(500).json({ error: "failed to register" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    if (usePG) {
      const user = await getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "invalid credentials" });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: "invalid credentials" });
      req.session.userId = user.id;
      return res.json({ ok: true, email: user.email, displayName: user.display_name || null });
    } else {
      // dev only: accept anything
      req.session.userId = 1;
      req.session.email = email;
      return res.json({ ok: true, email, displayName: req.session.displayName || null });
    }
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ error: "failed to login" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "newPassword must be at least 6 chars" });
    }
    if (usePG) {
      await updatePasswordPG(req.session.userId, oldPassword || "", newPassword);
    } else {
      // dev only: pretend success
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("change-password error:", e);
    res.status(401).json({ error: e.message || "failed to change password" });
  }
});

// ---------- Me (profile) ----------
app.get("/api/me", async (req, res) => {
  if (!req.session.userId) return res.json({ userId: null });
  if (usePG) {
    const u = await getUserById(req.session.userId);
    return res.json({
      userId: u?.id || null,
      email: u?.email || null,
      displayName: u?.display_name || null,
    });
  } else {
    return res.json({
      userId: req.session.userId || null,
      email: req.session.email || null,
      displayName: req.session.displayName || null,
    });
  }
});

app.patch("/api/me", requireAuth, async (req, res) => {
  try {
    const { displayName } = req.body || {};
    if (usePG) {
      await updateDisplayNamePG(req.session.userId, displayName || null);
    } else {
      req.session.displayName = displayName || null;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("me patch error:", e);
    res.status(500).json({ error: "failed to update profile" });
  }
});

// ---------- Data routes (protected) ----------
app.get("/api/projects", requireAuth, async (req, res) => {
  try {
    if (usePG) return res.json(await readAllPG(req.session.userId));
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

// ---------- Backup/Restore (works in PG + file modes) ----------
app.get("/api/backup", requireAuth, async (req, res) => {
  try {
    const payload = usePG ? await readAllPG(req.session.userId) : readAllFile();
    res.json({ payload });
  } catch (e) {
    console.error("GET /api/backup error:", e);
    res.status(500).json({ error: "failed to create backup" });
  }
});
app.post("/api/restore", requireAuth, async (req, res) => {
  try {
    const { payload } = req.body || {};
    if (!Array.isArray(payload)) return res.status(400).json({ error: "payload must be an array" });
    if (usePG) await writeAllPG(req.session.userId, payload);
    else writeAllFileAndBackup(payload);
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/restore error:", e);
    res.status(500).json({ error: "failed to restore" });
  }
});

// ---- Serve React build (same-origin production) ----
const CLIENT_DIR = path.join(__dirname, "build");
app.use(express.static(CLIENT_DIR));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

// ---- Boot ----
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
