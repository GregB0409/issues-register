import "./App.css";
import React, { useState, useEffect, useMemo, useRef } from "react";

const API_BASE = ""; // same-origin in production; CRA dev uses proxy

const ENDPOINTS = {
  register: "/api/auth/register",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  changePassword: "/api/auth/change-password",
  me: "/api/me",
  meUpdate: "/api/me",
  projects: "/api/projects",
  backup: "/api/backup",
  restore: "/api/restore",
};

// --- fetch helper (always send cookies)
async function apiFetch(path, { method = "GET", body, headers, ...rest } = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const init = {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(headers || {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...rest,
  };
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

const todayPrefix = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}: `;
};

const defaultProject = () => ({
  name: "",
  issues: [{ issue: todayPrefix(), statuses: [todayPrefix()], closed: false }],
});

// ---------- small util to auto-grow textareas ----------
function autoSize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(1000, el.scrollHeight) + "px";
}

// =========================== Auth panel ===========================
function AuthPanel({
  me,
  refreshMe,
  query, setQuery,
  hideClosed, setHideClosed,
  onBackup, onRestore,
  saving,
}) {
  const [mode, setMode] = useState("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [nameEditing, setNameEditing] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const oldRef = useRef(null);
  const newRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  // --- pinned project name while scrolling ---
  const [topProject, setTopProject] = useState("");
  const scrollRef = useRef(null);
  const projectAnchorsRef = useRef([]);

  useEffect(() => { setMsg(""); setError(""); }, [mode]);

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(""); setMsg("");
    try {
      if (mode === "signup") {
        await apiFetch(ENDPOINTS.register, { method: "POST", body: { email, password, name: displayName || null } });
      } else {
        await apiFetch(ENDPOINTS.login, { method: "POST", body: { email, password } });
      }
      setPassword("");
      await refreshMe();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      await apiFetch(ENDPOINTS.logout, { method: "POST" });
      await refreshMe();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      await apiFetch(ENDPOINTS.meUpdate, { method: "PATCH", body: { displayName: displayName || null } });
      setNameEditing(false);
      await refreshMe();
      setMsg("Name updated");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const doChangePw = async () => {
    const oldPassword = oldRef.current?.value || "";
    const newPassword = newRef.current?.value || "";
    if (newPassword.length < 6) { setError("New password must be at least 6 characters"); return; }
    setBusy(true); setError(""); setMsg("");
    try {
      await apiFetch(ENDPOINTS.changePassword, { method: "POST", body: { oldPassword, newPassword } });
      oldRef.current.value = "";
      newRef.current.value = "";
      setPwdOpen(false);
      setMsg("Password changed");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (me?.userId) {
    return (
      <div style={styles.cardCompact}>
        <div style={styles.headerGrid}>
          {/* Left: identity */}
          <div style={{ minWidth: 220 }}>
            <div style={styles.mutedSmall}>Signed in as</div>
            <div style={styles.bold}>{me.email || me.userId}</div>
            {me.displayName ? <div style={styles.lineSmall}>Name: {me.displayName}</div> : null}
            {saving && <div style={{ color: "#065f46", fontSize: 12, marginTop: 4 }}>Saving…</div>}
            {msg && <div style={{ color: "#065f46", fontSize: 12, marginTop: 4 }}>{msg}</div>}
            {error && <div style={styles.errorSmall}>{error}</div>}
          </div>

          {/* Middle: filters + actions */}
          <div style={styles.controlsRow}>
            <input
              value={query}
              onChange={(e)=>setQuery(e.target.value)}
              placeholder="Search…"
              style={{ ...styles.inputSm, maxWidth: 280 }}
            />
            <label style={styles.inlineLabel}>
              <input type="checkbox" checked={hideClosed} onChange={e=>setHideClosed(e.target.checked)} />
              Hide closed
            </label>
            <button onClick={onBackup} style={styles.buttonSm}>Backup</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])}
            />
            <button onClick={() => fileRef.current?.click()} style={styles.buttonSm}>Restore</button>
          </div>

          {/* Right: profile */}
          <div style={styles.actionsRow}>
            <button onClick={() => setNameEditing(v=>!v)} style={styles.buttonSm}>
              {nameEditing ? "Cancel" : "Change name"}
            </button>
            <button onClick={() => setPwdOpen(v=>!v)} style={styles.buttonSm}>
              {pwdOpen ? "Close" : "Change password"}
            </button>
            <button onClick={doLogout} disabled={busy} style={styles.buttonPriSm}>
              {busy ? "…" : "Log out"}
            </button>
          </div>
        </div>

        {nameEditing && (
          <div style={styles.inlineRow}>
            <input
              value={displayName}
              onChange={(e)=>setDisplayName(e.target.value)}
              placeholder="Your name"
              style={styles.inputSm}
            />
            <button onClick={saveName} disabled={busy} style={styles.buttonPriSm}>Save</button>
          </div>
        )}

        {pwdOpen && (
          <div style={styles.inlineRow}>
            <input ref={oldRef} type="password" placeholder="Current password" style={styles.inputSm} />
            <input ref={newRef} type="password" placeholder="New password (min 6)" minLength={6} style={styles.inputSm} />
            <button onClick={doChangePw} disabled={busy} style={styles.buttonPriSm}>
              {busy ? "…" : "Update"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Logged out form
  return (
    <form onSubmit={submit} style={styles.cardCompact}>
      <div style={styles.tabsSm}>
        <button type="button" onClick={() => setMode("login")}
          style={{ ...styles.tabSm, ...(mode === "login" ? styles.tabActiveSm : {}) }}>Log in</button>
        <button type="button" onClick={() => setMode("signup")}
          style={{ ...styles.tabSm, ...(mode === "signup" ? styles.tabActiveSm : {}) }}>Sign up</button>
      </div>

      {mode === "signup" && (
        <label style={styles.labelSm}>Name
          <input value={displayName} onChange={(e)=>setDisplayName(e.target.value)} style={styles.inputSm} placeholder="Your name (optional)"/>
        </label>
      )}

      <label style={styles.labelSm}>Email
        <input type="email" autoComplete="email" value={email}
               onChange={(e)=>setEmail(e.target.value)} style={styles.inputSm}
               placeholder="you@example.com" required />
      </label>

      <label style={styles.labelSm}>Password
        <input type="password"
               autoComplete={mode==="login"?"current-password":"new-password"}
               value={password} onChange={(e)=>setPassword(e.target.value)}
               style={styles.inputSm} placeholder="At least 6 characters"
               required minLength={6}/>
      </label>

      {error ? <div style={styles.errorSmall}>{error}</div> : null}

      <button type="submit" disabled={!canSubmit} style={styles.buttonPriSm}>
        {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

// =========================== App ===========================
export default function App() {
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [me, setMe] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [query, setQuery] = useState("");
  const [hideClosed, setHideClosed] = useState(() => localStorage.getItem("ir_hideClosed") === "1");
  const [editingProj, setEditingProj] = useState(null);
  useEffect(() => { localStorage.setItem("ir_hideClosed", hideClosed ? "1" : "0"); }, [hideClosed]);

  // Measure sticky top height (title + auth panel)
  const topRef = useRef(null);
  const [topH, setTopH] = useState(0);
  useEffect(() => {
    if (!topRef.current) return;
    const ro = new ResizeObserver(entries => setTopH(Math.ceil(entries[0]?.contentRect?.height || 0)));
    ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);

  // Measure table header height (for project sticky label)
  const theadRef = useRef(null);
  const [headH, setHeadH] = useState(0);
  useEffect(() => {
    if (!theadRef.current) return;
    const ro = new ResizeObserver(entries => setHeadH(Math.ceil(entries[0]?.contentRect?.height || 0)));
    ro.observe(theadRef.current);
    return () => ro.disconnect();
  }, []);

  // Load / save
  const loadProjects = async () => {
    if (loaded) return;
    try {
      const data = await apiFetch(ENDPOINTS.projects);
      setProjects(Array.isArray(data) && data.length ? data : [defaultProject()]);
      setLoaded(true);
      setTimeout(() => document.querySelectorAll("textarea.auto-grow").forEach(autoSize), 0);
    } catch (e) {
      console.error("Failed to load projects", e);
      setLoaded(true);
    }
  };

  const refreshMe = async () => {
    try {
      const data = await apiFetch(ENDPOINTS.me);
      setMe(data);
      if (data?.userId) await loadProjects();
      else { setProjects([]); setLoaded(false); }
    } catch {
      setMe({ userId: null });
      setProjects([]);
      setLoaded(false);
    }
  };

  useEffect(() => { (async () => { await refreshMe(); setCheckingSession(false); })(); }, []);
  useEffect(() => {
    if (!loaded || !me?.userId) return;
    const t = setTimeout(() => {
      setSaving(true);
      apiFetch(ENDPOINTS.projects, { method: "PUT", body: projects })
        .then(() => setSaving(false))
        .catch(e => { console.error("Failed to save projects", e); setSaving(false); });
    }, 700);
    return () => clearTimeout(t);
  }, [projects, loaded, me?.userId]);

  // Mutations
  const handleProjectNameChange = (p, value) => {
    const next = [...projects];
    next[p].name = value;
    setProjects(next);
  };
  const handleIssueChange = (p, i, field, value) => {
    const next = [...projects];
    next[p].issues[i][field] = value;
    setProjects(next);
  };
  const handleStatusChange = (p, i, s, value) => {
    const next = [...projects];
    const issue = next[p].issues[i];
    issue.statuses[s] = value;
    if (s === issue.statuses.length - 1 && value.trim() && !issue.closed) {
      issue.statuses.push(todayPrefix());
    }
    setProjects(next);
  };
  const handleClosedToggle = (p, i) => {
    const next = [...projects];
    next[p].issues[i].closed = !next[p].issues[i].closed;
    setProjects(next);
  };

  const addProject = () => setProjects([...projects, defaultProject()]);
  const addIssue = (p) => {
    const next = [...projects];
    next[p].issues.push({ issue: todayPrefix(), statuses: [todayPrefix()], closed: false });
    setProjects(next);
  };

  const deleteProject = (p) => {
    if (!window.confirm("Delete this project and all its issues?")) return;
    const next = projects.filter((_, idx) => idx !== p);
    setProjects(next.length ? next : [defaultProject()]);
  };
  const deleteIssue = (p, i) => {
    if (!window.confirm("Delete this issue?")) return;
    const next = [...projects];
    next[p].issues.splice(i, 1);
    if (next[p].issues.length === 0) next.splice(p, 1);
    setProjects(next.length ? next : [defaultProject()]);
  };
  const deleteStatus = (p, i, s) => {
    if (!window.confirm("Delete this status update?")) return;
    const next = [...projects];
    const list = next[p].issues[i].statuses;
    list.splice(s, 1);
    if (!list.length) list.push(todayPrefix());
    setProjects(next);
  };

  // Derived (search + hide closed)
  const visibleProjects = useMemo(() => {
    const q = (query || "").toLowerCase().trim();
    const match = (s="") => s.toLowerCase().includes(q);

    const filtered = projects.map(p => {
      let issues = hideClosed ? p.issues.filter(i => !i.closed) : p.issues;
      if (q) {
        issues = issues.filter(i => {
          const inProj = match(p.name);
          const inIssue = match(i.issue);
          const inStatuses = (i.statuses || []).some(s => match(s));
          return inProj || inIssue || inStatuses;
        });
      }
      return { ...p, issues };
    });

    return filtered.filter(p => p.issues.length > 0 || (!hideClosed && !q));
  }, [projects, hideClosed, query]);

  // Backup / restore
  const downloadBackup = async () => {
    try {
      const { payload } = await apiFetch(ENDPOINTS.backup);
      const blob = new Blob([JSON.stringify({ payload }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `issues-backup-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert("Failed to download backup: " + (e.message || e));
    }
  };
  const restoreBackup = async (file) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json || !Array.isArray(json.payload)) throw new Error("Invalid backup file");
      await apiFetch(ENDPOINTS.restore, { method: "POST", body: { payload: json.payload } });
      setLoaded(false);
      await loadProjects();
      alert("Restore complete");
    } catch (e) {
      alert("Failed to restore: " + (e.message || e));
    }
  };

  // Re-auto-size textareas when list changes
  useEffect(() => { setTimeout(() => {
    document.querySelectorAll("textarea.auto-grow").forEach(autoSize);
  }, 0); }, [visibleProjects]);

  return (
    <div className="App" style={{ minHeight: "100vh", padding: "0 16px" }}>
      {/* Sticky top region (title + auth/controls) */}
      <div ref={topRef} style={{ position: "sticky", top: 0, zIndex: 100, background: "#fff", paddingBottom: 6 }}>
        <h1 style={{ fontSize: 32, margin: "16px 0" }}>Issues Register</h1>

        {checkingSession ? (
          <div style={{ margin: "8px 0" }}>Checking session…</div>
        ) : (
          <AuthPanel
            me={me}
            refreshMe={refreshMe}
            query={query} setQuery={setQuery}
            hideClosed={hideClosed} setHideClosed={setHideClosed}
            onBackup={downloadBackup}
            onRestore={restoreBackup}
            saving={saving}
          />
        )}
      </div>

      {!me?.userId ? null : (
        // Scroll container: only rows scroll; header stays fixed inside this box
        <div
          style={{
            height: `calc(100vh - ${topH}px - 12px)`,
            overflow: "auto",
            borderTop: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "26%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "38%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>

            <thead ref={theadRef}>
              <tr>
                <th style={styles.thSticky(0)}>
                  <button onClick={addProject} style={{ ...styles.buttonSm, fontWeight: 600 }}>+ Add Project/Matter</button>
                </th>
                <th style={styles.thSticky(0)}>Issue</th>
                <th style={styles.thSticky(0)}>Status Updates</th>
                <th style={styles.thSticky(0)}>Closed</th>
              </tr>
            </thead>

            <tbody>
              {visibleProjects.map((project, pIndex) => {
                const issueCount = project.issues.length;
                const stickyTop = headH; // project label sticks just under the table header
                return (
                  <React.Fragment key={pIndex}>
                    {project.issues.map((issue, iIndex) => (
                      <tr key={`${pIndex}-${iIndex}`}>
                        {/* Project column (row span). Contains a sticky label and bottom toolbar */}
                        {iIndex === 0 && (
                          <td rowSpan={issueCount} style={{ position: "relative", padding: 0, verticalAlign: "top" }}>
                            {/* Sticky project label (read-only) */}
                            {editingProj !== pIndex && (
                              <div style={styles.projectSticky(stickyTop)}>
                                {(project.name || "").trim() ? project.name : "Project / Matter"}
                              </div>
                            )}

                            {/* Editable textarea (not sticky) */}
                            <textarea
                              className="auto-grow"
                              value={project.name}
                              onFocus={() => setEditingProj(pIndex)}
                              onBlur={() => setEditingProj(null)}
                              onChange={(e) => { autoSize(e.target); handleProjectNameChange(pIndex, e.target.value); }}
                              placeholder="Project / Matter"
                              style={{
                                width: "100%",
                                minHeight: 56,
                                padding: "28px 8px 40px 8px",
                                boxSizing: "border-box",
                                resize: "none",
                                fontSize: 14,
                                border: "none",
                                borderRight: "1px solid #eee",
                                overflow: "hidden",
                                // NEW: hide text when not editing; show while editing
                                color: editingProj === pIndex ? "#111" : "transparent",
                                caretColor: "#111",
                                textShadow: editingProj === pIndex ? "none" : "0 0 0 #111"
                              }}
                            />

                            {/* Bottom toolbar: Add Issue + Delete Project */}
                            <div style={styles.projectBottomBar}>
                              <button onClick={() => addIssue(pIndex)} style={styles.buttonSm}>+ Add Issue</button>
                              <span style={{ flex: 1 }} />
                              <button onClick={() => deleteProject(pIndex)} style={styles.badgeDanger}>Delete project</button>
                            </div>
                          </td>
                        )}

                        {/* Issue cell */}
                        <td style={{ position: "relative", verticalAlign: "top" }}>
                          <textarea
                            className="auto-grow"
                            value={issue.issue}
                            onChange={(e) => { autoSize(e.target); handleIssueChange(pIndex, iIndex, "issue", e.target.value); }}
                            placeholder="Issue"
                            style={{ width: "100%", minHeight: 44, border: "none", fontSize: 14, padding: "8px 30px 8px 8px", overflow: "hidden" }}
                          />
                          {/* Delete issue (small × in top-right) */}
                          <button
                            onClick={() => deleteIssue(pIndex, iIndex)}
                            title="Delete this issue"
                            style={styles.cellDelete}
                          >
                            ×
                          </button>
                        </td>

                        {/* Status updates (each line deletable) */}
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {issue.statuses.map((status, sIndex) => (
                              <div key={sIndex} style={{ position: "relative" }}>
                                <textarea
                                  className="auto-grow"
                                  value={status}
                                  onChange={(e) => { autoSize(e.target); handleStatusChange(pIndex, iIndex, sIndex, e.target.value); }}
                                  placeholder="Status update"
                                  style={{
                                    width: "100%",
                                    minHeight: 36,
                                    border: "none",
                                    borderBottom: sIndex !== issue.statuses.length - 1 ? "1px solid #eee" : "none",
                                    fontSize: 14,
                                    padding: "6px 28px 6px 8px",
                                    overflow: "hidden",
                                  }}
                                />
                                <button
                                  onClick={() => deleteStatus(pIndex, iIndex, sIndex)}
                                  title="Delete this status"
                                  style={styles.statusDelete}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        </td>

                        {/* Closed */}
                        <td style={{ textAlign: "center", whiteSpace: "nowrap", width: "1%" }}>
                          <input type="checkbox" checked={!!issue.closed} onChange={() => handleClosedToggle(pIndex, iIndex)} />
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =========================== styles ===========================
const styles = {
  cardCompact: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
  },

  headerGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(220px,1fr) 2fr auto",
    gap: 8,
    alignItems: "center",
  },

  controlsRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  actionsRow: { display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  inlineRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 },

  mutedSmall: { color: "#6b7280", fontSize: 12 },
  lineSmall: { color: "#374151", fontSize: 13, marginTop: 2 },
  bold: { fontWeight: 600, fontSize: 15 },

  inputSm: { width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 },
  buttonSm: { padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 },
  buttonPriSm: { padding: "6px 12px", borderRadius: 8, border: "1px solid #4f46e5", background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 },

  tabsSm: { display: "flex", gap: 6, marginBottom: 6 },
  tabSm: { border: "1px solid #e5e7eb", background: "#f9fafb", padding: "4px 8px", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  tabActiveSm: { background: "#eef2ff", borderColor: "#c7d2fe", fontWeight: 600 },
  labelSm: { display: "block", fontSize: 13, marginTop: 8 },
  errorSmall: { marginTop: 6, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", padding: "6px 8px", borderRadius: 8, fontSize: 12 },
  inlineLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13 },

  thSticky: (top) => ({
    position: "sticky",
    top,
    zIndex: 90,
    background: "#fff",
    borderBottom: "1px solid #e5e7eb",
    padding: 6,
    textAlign: "center",
    fontSize: 14,
  }),

  // small sticky label inside the project cell
  projectSticky: (top) => ({
    position: "sticky",
    top,
    zIndex: 5,
    background: "#fff",
    borderBottom: "1px solid #eee",
    fontWeight: 600,
    padding: "6px 8px",
  }),

  projectBottomBar: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  badgeDanger: {
    padding: "4px 8px",
    borderRadius: 8,
    border: "1px solid #dc2626",
    color: "#dc2626",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },

  statusDelete: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 20,
    height: 20,
    lineHeight: "18px",
    textAlign: "center",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },

  cellDelete: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 22,
    height: 22,
    lineHeight: "20px",
    textAlign: "center",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 16,
  },
};
