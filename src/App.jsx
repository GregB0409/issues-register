import "./App.css";
import React, { useState, useEffect } from "react";

const API_BASE = "https://issues-register.onrender.com";

const todayPrefix = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}: `;
};

export default function App() {
  const [projects, setProjects] = useState([
    {
      name: "",
      issues: [
        {
          issue: todayPrefix(),           // initial issue starts with date
          statuses: [todayPrefix()],      // initial status starts with date
          closed: false,
        },
      ],
    },
  ]);

  const [loaded, setLoaded] = useState(false);
  const [fromBackend, setFromBackend] = useState(false); // ✅ new flag
  const [saving, setSaving] = useState(false); // show "Saving..." feedback

  // Load projects from backend on first render
  useEffect(() => {
    fetch(`${API_BASE}/api/projects`)
      .then((res) => res.json())
      .then((data) => {
        
        console.log("Backend returned:", data);  // <--- add this
        
        if (data && Array.isArray(data) && data.length > 0) {
          setProjects(data);
          setFromBackend(true);   // ✅ Real data came from backend
        } else {
          // initialize with a dated first project (fallback only)
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
          setFromBackend(false);  // ✅ This is just fallback
        }
        setLoaded(true);
      })
      .catch((err) => console.error("Failed to load projects", err));
  }, []);

  // Auto-save projects 1 second after last change
  useEffect(() => {
    if (!loaded) return;

    const timeout = setTimeout(() => {
      console.log("Auto-saving projects:", projects);
      setSaving(true); // show "Saving..." message

      fetch(`${API_BASE}/api/projects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projects),
      })
        .then(() => setSaving(false))           // hide message after save
        .catch((err) => {
          console.error("Failed to save projects", err);
          setSaving(false);
        });
    }, 1000); // wait 1 second after last edit

    return () => clearTimeout(timeout); // cancel if user types again
  }, [projects, loaded]);

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

    // Auto-add new status box if last one filled
    if (
      statusIndex === issue.statuses.length - 1 &&
      value.trim() !== "" &&
      !issue.closed
    ) {
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
    setProjects([
      ...projects,
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
  };

  const addIssue = (projectIndex) => {
    const newProjects = [...projects];
    newProjects[projectIndex].issues.push({
      issue: todayPrefix(),               
      statuses: [todayPrefix()],          
      closed: false,
    });
    setProjects(newProjects);
  };

  return (
    <div className="App" style={{ padding: "0 20px" }}>
      <h1>Issues Register {saving && <span style={{ fontSize: "0.7em", color: "green" }}>Saving...</span>}</h1>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
          {projects.map((project, pIndex) => {
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
                            height: `${issueCount * 60}px`,
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
                          handleIssueChange(pIndex, iIndex, "issue", e.target.value)
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
                              handleStatusChange(pIndex, iIndex, sIndex, e.target.value)
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
    </div>
  );
}
