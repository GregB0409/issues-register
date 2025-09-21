import "./App.css";
import React, { useState, useEffect, useMemo, useRef } from "react";

/**
 * API base that works both locally and on Render:
 * - On Render (https://issues-register.onrender.com): same-origin ('')
 * - Locally (http://localhost:300x): call the live Render API
 */
const API_BASE =
  window.location.hostname === "issues-register.onrender.com"
    ? ""
    : "https://issues-register.onrender.com";

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

// JSON fetch helper with credentials
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
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

const todayPrefix = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}: `;
};

// ---------- Auth UI ----------
function AuthPanel({ me, refreshMe }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      let resp;
      if (mode === "signup") {
        resp = await apiFetch(ENDPOINTS.register, {
          method: "POST",
          body: { email, password, name: name || null },
        });
      } else {
        resp = await apiFetch(ENDPOINTS.login, {
          method: "POST",
          body: { email, password },
        });
      }
      setPassword("");
      await refreshMe(resp?.email || email);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setBusy(true);
    setError("");
    try {
      await apiFetch(ENDPOINTS.logout, { method: "POST" });
      await refreshMe();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (me?.userId) {
    return (
      <div style={styles.card}>
        <div style={styles.rowBetween}>
          <div>
            <div style={styles.muted}>Signed in as</div>
            <div style={styles.bold}>
              {me.displayName ? `${me.displayName} (${me.email})` : (me.email || me.userId)}
            </div>
          </div>
          <button onClick={doLogout} disabled={busy} style={styles.button}>
            {busy ? "…" : "Log out"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={styles.card}>
      <div style={styles.tabs}>
        <button
          type="button"
          onClick={() => setMode("login")}
          style={{ ...styles.tab, ...(mode === "login" ? styles.tabActive : {}) }}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }}
        >
          Sign up
        </button>
      </div>

      {mode === "signup" && (
        <label style={styles.label}>
          Name (optional)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            placeholder="Your display name"
          />
        </label>
      )}

      <label style={styles.label}>
        Email
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          placeholder="you@example.com"
          required
        />
      </label>

      <label style={styles.label}>
        Password
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          placeholder="At least 6 characters"
          required
          minLength={6}
        />
      </label>

      {error ? <div style={styles.error}>{error}</div> : null}

      <button type="submit" disabled={!canSubmit} style={styles.primaryButton}>
        {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

// ---------- App ----------
export default function App() {
  const [projects, setProjects] = useState([]); // hidden while logged out
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [me, setMe] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [hideClosed, setHideClosed] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdErr, setPwdErr] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const oldRef = useRef(null);
  const newRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load projects once after login is confirmed
  const loadProjects = async () => {
    if (loaded) return;
    try {
      const data = await apiFetch(ENDPOINTS.projects);
      if (Array.isArray(data) && data.length > 0) {
        setProjects(data);
      } else {
        setProjects([
          {
            name: "",
            issues: [
              {
                issue: todayPrefix(),
                statuses: [todayPrefix()],
                closed: false,
              },
            ],
          },
        ]);
      }
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load projects", err);
      setLoaded(true);
    }
  };

  // Refresh session (optionally keep knownEmail after login)
  const refreshMe = async (knownEmail) => {
    try {
      const data = await apiFetch(ENDPOINTS.me);
      const merged = knownEmail ? { ...data, email: knownEmail } : data;
      setMe(merged);
      setDisplayNameDraft(merged?.displayName || "");
      if (merged?.userId) {
        await loadProjects();
      } else {
        setProjects([]);
        setLoaded(false);
      }
    } catch {
      setMe({ userId: null });
      setProjects([]);
      setLoaded(false);
    }
  };

  useEffect(() => {
    (async () => {
      await refreshMe();
      setCheckingSession(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save after edits (only when logged in & loaded)
  useEffect(() => {
    if (!loaded || !me?.userId) return;
    const timeout = setTimeout(() => {
      setSaving(true);
      apiFetch(ENDPOINTS.projects, { method: "PUT", body: projects })
        .then(() => setSaving(false))
        .catch((err) => {
          console.error("Failed to save projects", err);
          setSaving(false);
        });
    }, 800);
    return () => clearTimeout(timeout);
  }, [projects, loaded, me?.userId]);

  // Mutators
  const handleProjectNameChange = (pIndex, value) => {
    const next = [...projects];
    next[pIndex].name = value;
    setProjects(next);
  };
  const handleIssueChange = (pIndex, iIndex, field, value) => {
    const next = [...projects];
    next[pIndex].issues[iIndex][field] = value;
    setProjects(next);
  };
  const handleStatusChange = (pIndex, iIndex, sIndex, value) => {
    const next = [...projects];
    const issue = next[pIndex].issues[iIndex];
    issue.statuses[sIndex] = value;
    if (
      sIndex === issue.statuses.length - 1 &&
      value.trim() !== "" &&
      !issue.closed
    ) {
      issue.statuses.push(todayPrefix());
    }
    setProjects(next);
  };
  const handleClosedToggle = (pIndex, iIndex) => {
    const next = [...projects];
    next[pIndex].issues[iIndex].closed = !next[pIndex].issues[iIndex].closed;
    setProjects(next);
  };
  const addProject = () => {
    setProjects([
      ...projects,
      {
        name: "",
        issues: [
          { issue: todayPrefix(), statuses: [todayPrefix()], closed: false },
        ],
      },
    ]);
  };
  const addIssue = (pIndex) => {
    const next = [...projects];
    next[pIndex].issues.push({
      issue: todayPrefix(),
      statuses: [todayPrefix()],
      closed: false,
    });
    setProjects(next);
  };

  // Backup / Restore (server endpoints; works in prod + local-to-Render)
  const backup = async () => {
    try {
      const { payload } = await apiFetch(ENDPOINTS.backup);
      const blob = new Blob([JSON.stringify({ payload }, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `issues-backup-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert("Backup failed: " + (e.message || e));
    }
  };
  const restore = async (file) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json || !Array.isArray(json.payload))
        throw new Error("Invalid backup file");
      await apiFetch(ENDPOINTS.restore, {
        method: "POST",
        body: { payload: json.payload },
      });
      // reload
      setLoaded(false);
      await loadProjects();
      alert("Restore complete.");
    } catch (e) {
      alert("Restore failed: " + (e.message || e));
    }
  };

  // Change password
  const doChangePassword = async () => {
    const oldPassword = oldRef.current?.value || "";
    const newPassword = newRef.current?.value || "";
    setPwdBusy(true);
    setPwdErr("");
    try {
      await apiFetch(ENDPOINTS.changePassword, {
        method: "POST",
        body: { oldPassword, newPassword },
      });
      if (oldRef.current) oldRef.current.value = "";
      if (newRef.current) newRef.current.value = "";
      setPwdOpen(false);
      alert("Password changed.");
    } catch (e) {
      setPwdErr(e.message || String(e));
    } finally {
      setPwdBusy(false);
    }
  };

  // Update display name
  const saveDisplayName = async () => {
    try {
      await apiFetch(ENDPOINTS.meUpdate, {
        method: "PATCH",
        body: { displayName: displayNameDraft || null },
      });
      await refreshMe();
      setProfileOpen(false);
    } catch (e) {
      alert("Failed to update name: " + (e.message || e));
    }
  };

  // Filtered view
  const visibleProjects = useMemo(() => {
    if (!hideClosed) return projects;
    return projects
      .map((p) => ({ ...p, issues: p.issues.filter((i) => !i.closed) }))
      .filter((p) => p.issues.length > 0);
  }, [projects, hideClosed]);

  return (
    <div className="App" style={{ padding: "0 20px" }}>
      <h1>
        Issues Register{" "}
        {saving && (
          <span style={{ fontSize: "0.7em", color: "green" }}>Saving...</span>
        )}
      </h1>

      {checkingSession ? (
        <div style={{ margin: "12px 0" }}>Checking session…</div>
      ) : (
        <AuthPanel me={me} refreshMe={refreshMe} />
      )}

      {!me?.userId ? (
        <div style={styles.card}>
          <div style={styles.muted}>
            Log in or sign up above to load and save your issues to your
            account.
          </div>
        </div>
      ) : (
        <>
          {/* Tools */}
          <div
            style={{
              ...styles.card,
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={hideClosed}
                onChange={(e) => setHideClosed(e.target.checked)}
              />
              Hide closed
            </label>

            <button style={styles.button} onClick={backup}>
              Backup
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
            />
            <button
              style={styles.button}
              onClick={() => fileInputRef.current?.click()}
            >
              Restore
            </button>

            <span style={{ flex: 1 }} />

            <button
              style={styles.button}
              onClick={() => setProfileOpen((v) => !v)}
            >
              {profileOpen ? "Close profile" : "Edit name"}
            </button>

            <button
              style={styles.button}
              onClick={() => setPwdOpen((v) => !v)}
            >
              {pwdOpen ? "Close password" : "Change password"}
            </button>
          </div>

          {profileOpen && (
            <div style={{ ...styles.card }}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  value={displayNameDraft}
                  onChange={(e) => setDisplayNameDraft(e.target.value)}
                  placeholder="Your display name"
                  style={styles.input}
                />
                <button style={styles.primaryButton} onClick={saveDisplayName}>
                  Save name
                </button>
              </div>
            </div>
          )}

          {pwdOpen && (
            <div style={{ ...styles.card }}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  ref={oldRef}
                  type="password"
                  placeholder="Old password"
                  style={styles.input}
                />
                <input
                  ref={newRef}
                  type="password"
                  placeholder="New password (min 6)"
                  minLength={6}
                  style={styles.input}
                />
                <button
                  style={styles.primaryButton}
                  disabled={pwdBusy}
                  onClick={doChangePassword}
                >
                  {pwdBusy ? "…" : "Update password"}
                </button>
              </div>
              {pwdErr && (
                <div style={{ ...styles.error, marginTop: 8 }}>{pwdErr}</div>
              )}
            </div>
          )}

          {/* Table */}
          {visibleProjects.length > 0 ? (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginTop: 12,
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "center" }}>
                    <button onClick={addProject} style={{ marginBottom: "5px" }}>
                      + Add Project/Matter
                    </button>
                    <div>Project / Matter</div>
                  </th>
                  <th style={{ textAlign: "center" }}>
                    <div>Issue</div>
                  </th>
                  <th>Status Updates</th>
                  <th
                    style={{
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      width: "1%",
                    }}
                  >
                    Closed
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project, pIndex) => {
                  const issueCount = project.issues.length;
                  return (
                    <React.Fragment key={pIndex}>
                      {project.issues.map((issue, iIndex) => (
                        <tr key={`${pIndex}-${iIndex}`}>
                          {iIndex === 0 && (
                            <td
                              rowSpan={issueCount}
                              style={{
                                position: "relative",
                                padding: 0,
                                verticalAlign: "top",
                              }}
                            >
                              <textarea
                                value={project.name}
                                onChange={(e) =>
                                  handleProjectNameChange(pIndex, e.target.value)
                                }
                                placeholder="Project / Matter"
                                style={{
                                  width: "100%",
                                  height: `${Math.max(1, issueCount) * 60}px`,
                                  boxSizing: "border-box",
                                  resize: "none",
                                }}
                              />
                              <button
                                onClick={() => addIssue(pIndex)}
                                style={{
                                  position: "absolute",
                                  bottom: "5px",
                                  right: "5px",
                                }}
                              >
                                + Add Issue
                              </button>
                            </td>
                          )}

                          <td>
                            <textarea
                              value={issue.issue}
                              onChange={(e) =>
                                handleIssueChange(
                                  pIndex,
                                  iIndex,
                                  "issue",
                                  e.target.value
                                )
                              }
                              placeholder="Issue"
                            />
                          </td>

                          <td>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              {issue.statuses.map((status, sIndex) => (
                                <textarea
                                  key={sIndex}
                                  value={status}
                                  onChange={(e) =>
                                    handleStatusChange(
                                      pIndex,
                                      iIndex,
                                      sIndex,
                                      e.target.value
                                    )
                                  }
                                  style={{
                                    margin: 0,
                                    border: "none",
                                    borderBottom:
                                      sIndex !== issue.statuses.length - 1
                                        ? "1px solid #ccc"
                                        : "none",
                                  }}
                                  placeholder="Status update"
                                />
                              ))}
                            </div>
                          </td>
                          <td
                            style={{
                              textAlign: "center",
                              whiteSpace: "nowrap",
                              width: "1%",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={issue.closed}
                              onChange={() => handleClosedToggle(pIndex, iIndex)}
                            />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ ...styles.card, marginTop: 12 }}>
              <div style={styles.muted}>
                No issues to show{hideClosed ? " (all closed are hidden)" : ""}.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
  },
  tabs: { display: "flex", gap: 8, marginBottom: 8 },
  tab: {
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    padding: "6px 10px",
    borderRadius: 8,
    cursor: "pointer",
  },
  tabActive: { background: "#eef2ff", borderColor: "#c7d2fe", fontWeight: 600 },
  primaryButton: {
    marginTop: 14,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #4f46e5",
    background: "#4f46e5",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  button: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
  },
  rowBetween: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  muted: { color: "#6b7280", fontSize: 13 },
  bold: { fontWeight: 600 },
  label: { display: "block", fontSize: 14, marginTop: 12 },
  input: {
    width: "100%",
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 14,
  },
  error: {
    marginTop: 8,
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13,
  },
};
