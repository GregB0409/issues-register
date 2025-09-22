import "./App.css";
import React, { useState, useEffect, useMemo } from "react";

const API_BASE = "";

const ENDPOINTS = {
  register: "/api/auth/register",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  me: "/api/me",
  projects: "/api/projects",
};

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
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}: `;
};

function AuthPanel({ me, refreshMe }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => email.trim().length > 3 && password.length >= 6 && !busy,
    [email, password, busy]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError("");
    try {
      if (mode === "signup") {
        await apiFetch(ENDPOINTS.register, {
          method: "POST",
          body: { email, password, name: name || null },
        });
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
    setBusy(true); setError("");
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
            <div style={styles.bold}>{me.email}</div>
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
        <button type="button" onClick={() => setMode("login")}
          style={{ ...styles.tab, ...(mode === "login" ? styles.tabActive : {}) }}>Log in</button>
        <button type="button" onClick={() => setMode("signup")}
          style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }}>Sign up</button>
      </div>

      {mode === "signup" && (
        <label style={styles.label}>Name (optional)
          <input
            value={name}
            onChange={(e)=>setName(e.target.value)}
            style={styles.input}
            placeholder="Your display name"
          />
        </label>
      )}

      <label style={styles.label}>Email
        <input type="email" autoComplete="email" value={email}
               onChange={(e)=>setEmail(e.target.value)} style={styles.input}
               placeholder="you@example.com" required />
      </label>

      <label style={styles.label}>Password
        <input type="password"
               autoComplete={mode==="login"?"current-password":"new-password"}
               value={password} onChange={(e)=>setPassword(e.target.value)}
               style={styles.input} placeholder="At least 6 characters"
               required minLength={6}/>
      </label>

      {error ? <div style={styles.error}>{error}</div> : null}

      <button type="submit" disabled={!canSubmit} style={styles.primaryButton}>
        {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

export default function App() {
  // CHANGED: start empty so nothing shows while logged out
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [fromBackend, setFromBackend] = useState(false);
  const [saving, setSaving] = useState(false);

  const [me, setMe] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const refreshMe = async () => {
  try {
    const data = await apiFetch(ENDPOINTS.me);
    setMe(data);
    if (data?.userId) {
      // logged in → leave projects; loader effect will fetch
      return;
    }
    // logged out → immediately clear UI
    setProjects([]);
    setLoaded(false);
  } catch {
    // treat errors as logged-out
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
  }, []);

  // Only load projects AFTER we know we’re logged in
  useEffect(() => {
    if (!me?.userId) return;
    (async () => {
      try {
        const data = await apiFetch(ENDPOINTS.projects);
        console.log("Backend returned:", data);
        if (Array.isArray(data) && data.length > 0) {
          setProjects(data);
          setFromBackend(true);
        } else {
          // new user: give a dated first row
          setProjects([{ name: "", issues: [{ issue: todayPrefix(), statuses: [todayPrefix()], closed: false }] }]);
          setFromBackend(false);
        }
        setLoaded(true);
      } catch (err) {
        console.error("Failed to load projects", err);
        setLoaded(true);
        setFromBackend(false);
      }
    })();
  }, [me?.userId]);

  // Auto-save only when logged in & loaded
  useEffect(() => {
    if (!loaded || !me?.userId) return;
    const timeout = setTimeout(() => {
      console.log("Auto-saving projects:", projects);
      setSaving(true);
      apiFetch(ENDPOINTS.projects, { method: "PUT", body: projects })
        .then(() => setSaving(false))
        .catch((err) => { console.error("Failed to save projects", err); setSaving(false); });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [projects, loaded, me?.userId]);

  const handleProjectNameChange = (projectIndex, value) => {
    const newProjects = [...projects];
    newProjects[projectIndex].name = value;
    setProjects(newProjects);
  };

  const handleIssueChange = (projectIndex, issueIndex, field, value) => {
    const newProjects = [...projects];
    newProjects[projectIndex].issues[issueIndex][field] = value;
    setProjects(newProjects);
  };

  const handleStatusChange = (projectIndex, issueIndex, statusIndex, value) => {
    const newProjects = [...projects];
    const issue = newProjects[projectIndex].issues[issueIndex];
    issue.statuses[statusIndex] = value;
    if (statusIndex === issue.statuses.length - 1 && value.trim() !== "" && !issue.closed) {
      issue.statuses.push(todayPrefix());
    }
    setProjects(newProjects);
  };

  const handleClosedToggle = (projectIndex, issueIndex) => {
    const newProjects = [...projects];
    const issue = newProjects[projectIndex].issues[issueIndex];
    issue.closed = !issue.closed;
    setProjects(newProjects);
  };

  const addProject = () => {
    setProjects([...projects, { name: "", issues: [{ issue: todayPrefix(), statuses: [todayPrefix()], closed: false }] }]);
  };

  const addIssue = (projectIndex) => {
    const newProjects = [...projects];
    newProjects[projectIndex].issues.push({ issue: todayPrefix(), statuses: [todayPrefix()], closed: false });
    setProjects(newProjects);
  };

  return (
    <div className="App" style={{ padding: "0 20px" }}>
      <h1>Issues Register {saving && <span style={{ fontSize: "0.7em", color: "green" }}>Saving...</span>}</h1>

      {checkingSession ? (
        <div style={{ margin: "12px 0" }}>Checking session…</div>
      ) : (
        <AuthPanel me={me} refreshMe={refreshMe} />
      )}

      {!me?.userId ? (
        <div style={styles.card}>
          <div style={styles.muted}>Log in or sign up above to load and save your issues to your account.</div>
        </div>
      ) : null}

      {/* CHANGED: render table only when logged in */}
      {me?.userId ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "center" }}>
                <button onClick={addProject} style={{ marginBottom: "5px" }}>+ Add Project/Matter</button>
                <div>Project / Matter</div>
              </th>
              <th style={{ textAlign: "center" }}><div>Issue</div></th>
              <th>Status Updates</th>
              <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "1%" }}>Closed</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, pIndex) => {
              const issueCount = project.issues.length;
              return (
                <React.Fragment key={pIndex}>
                  {project.issues.map((issue, iIndex) => (
                    <tr key={`${pIndex}-${iIndex}`}>
                      {iIndex === 0 && (
                        <td rowSpan={issueCount} style={{ position: "relative", padding: 0, verticalAlign: "top" }}>
                          <textarea
                            value={project.name}
                            onChange={(e) => handleProjectNameChange(pIndex, e.target.value)}
                            placeholder="Project / Matter"
                            style={{ width: "100%", height: `${issueCount * 60}px`, boxSizing: "border-box", resize: "none" }}
                          />
                          <button onClick={() => addIssue(pIndex)} style={{ position: "absolute", bottom: "5px", right: "5px" }}>
                            + Add Issue
                          </button>
                        </td>
                      )}

                      <td>
                        <textarea
                          value={issue.issue}
                          onChange={(e) => handleIssueChange(pIndex, iIndex, "issue", e.target.value)}
                          placeholder="Issue"
                        />
                      </td>

                      <td>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {issue.statuses.map((status, sIndex) => (
                            <textarea
                              key={sIndex}
                              value={status}
                              onChange={(e) => handleStatusChange(pIndex, iIndex, sIndex, e.target.value)}
                              style={{ margin: 0, border: "none", borderBottom: sIndex !== issue.statuses.length - 1 ? "1px solid #ccc" : "none" }}
                              placeholder="Status update"
                            />
                          ))}
                        </div>
                      </td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap", width: "1%" }}>
                        <input type="checkbox" checked={issue.closed} onChange={() => handleClosedToggle(pIndex, iIndex)} />
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

const styles = {
  card: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginTop: 8, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" },
  tabs: { display: "flex", gap: 8, marginBottom: 8 },
  tab: { border: "1px solid #e5e7eb", background: "#f9fafb", padding: "6px 10px", borderRadius: 8, cursor: "pointer" },
  tabActive: { background: "#eef2ff", borderColor: "#c7d2fe", fontWeight: 600 },
  primaryButton: { marginTop: 14, padding: "10px 14px", borderRadius: 8, border: "1px solid #4f46e5", background: "#4f46e5", color: "#fff", cursor: "pointer", fontWeight: 600 },
  button: { padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" },
  rowBetween: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  muted: { color: "#6b7280", fontSize: 13 },
  bold: { fontWeight: 600 },
  label: { display: "block", fontSize: 14, marginTop: 12 },
  input: { width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 },
  error: { marginTop: 8, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", padding: "8px 10px", borderRadius: 8, fontSize: 13 },
};
