// ==========================================================================
// LayaResolve Frontend Application Logic
// ==========================================================================

// Determine API Base URL dynamically so it works on http://localhost:8000, 
// Live Server (e.g. port 5500), file protocol, or remote tunnel.
const API_BASE = (window.location.protocol === "file:" || (window.location.port && window.location.port !== "8000"))
  ? "http://127.0.0.1:8000"
  : "";

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadSystemStatus();
  loadBenchmarkExamples();
  setupStudioEvents();
  setupPlaygroundEvents();
  setupEvalEvents();
});

// State
let benchmarkExamples = [];

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  const panels = document.querySelectorAll(".tab-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetId = `tab-${tab.dataset.tab}`;
      tabs.forEach(t => t.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));

      tab.classList.add("active");
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }
    });
  });
}

// System Status Check
async function loadSystemStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) return;
    const data = await res.json();
    const sys = data.system;

    const navModel = document.getElementById("nav-model-name");
    if (navModel) navModel.textContent = "convaiinnovations/laya";

    const navDev = document.getElementById("nav-device-spec");
    if (navDev) navDev.textContent = `${sys.device || "CPU"} • Local Offline`;
  } catch (err) {
    console.warn("Could not fetch system status:", err);
  }
}

// Load Benchmark Problems
async function loadBenchmarkExamples() {
  try {
    const res = await fetch(`${API_BASE}/api/examples`);
    if (!res.ok) return;
    benchmarkExamples = await res.json();

    const selector = document.getElementById("example-selector");
    benchmarkExamples.forEach((ex, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = `[${ex.expected_domain.toUpperCase()}] ${ex.title}`;
      selector.appendChild(opt);
    });

    selector.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val !== "") {
        const selected = benchmarkExamples[parseInt(val, 10)];
        document.getElementById("problem-title").value = selected.title;
        document.getElementById("problem-desc").value = selected.description;
      }
    });
  } catch (err) {
    console.error("Error loading examples:", err);
  }
}

// Studio Event Setup
function setupStudioEvents() {
  const slider = document.getElementById("min-confidence");
  const sliderVal = document.getElementById("min-confidence-val");

  slider.addEventListener("input", () => {
    sliderVal.textContent = `${slider.value}%`;
  });

  const btnTriage = document.getElementById("btn-triage-only");
  const form = document.getElementById("problem-form");

  btnTriage.addEventListener("click", () => {
    runTriagePipeline(false);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runTriagePipeline(true);
  });

  document.getElementById("btn-copy-code").addEventListener("click", () => {
    const code = document.getElementById("solution-code").textContent;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById("btn-copy-code");
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = "Copy Code", 2000);
    });
  });
}

// Run Triage / Full Solve
async function runTriagePipeline(fullSolve = false) {
  const title = document.getElementById("problem-title").value.trim();
  const desc = document.getElementById("problem-desc").value.trim();
  const minConf = parseFloat(document.getElementById("min-confidence").value) / 100.0;
  const forceSolver = document.getElementById("force-solver").value || null;

  if (!title || !desc) {
    alert("Please enter a problem title and description.");
    return;
  }

  const pill = document.getElementById("triage-status-pill");
  const btnTriage = document.getElementById("btn-triage-only");
  const btnSolve = document.getElementById("btn-solve-pipeline");

  // Disable buttons & show loading
  btnTriage.disabled = true;
  btnSolve.disabled = true;

  if (fullSolve) {
    btnSolve.innerHTML = `<span class="btn-icon">⏳</span> Solving with Laya Engine...`;
    pill.textContent = "Executing Full Resolution Pipeline...";
  } else {
    btnTriage.innerHTML = `<span class="btn-icon">⏳</span> Evaluating Triage Heads...`;
    pill.textContent = "Evaluating Multi-Head Decisions...";
  }
  pill.className = "badge active-badge";

  const payload = {
    title: title,
    description: desc,
    min_confidence: minConf,
    force_solver: forceSolver
  };

  try {
    if (fullSolve) {
      // Execute full pipeline
      const res = await fetch(`${API_BASE}/api/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      renderTelemetry(data.triage);
      renderResolution(data.solver_execution, data.verification, data.total_pipeline_time_ms);
      pill.textContent = "Full Pipeline Complete";
      pill.className = "badge verified-badge";
    } else {
      // Triage only
      const res = await fetch(`${API_BASE}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const triage = await res.json();

      renderTelemetry(triage);
      document.getElementById("resolution-section").classList.add("hidden");
      pill.textContent = "Triage Evaluated";
      pill.className = "badge verified-badge";
    }
  } catch (err) {
    console.error("Inference error:", err);
    alert(`Error running Laya: ${err.message}`);
    pill.textContent = "Error";
    pill.className = "badge ready-badge";
  } finally {
    // Restore button states
    btnTriage.disabled = false;
    btnSolve.disabled = false;
    btnTriage.innerHTML = `<span class="btn-icon">⚡</span> Run Laya Triage Only (~200ms)`;
    btnSolve.innerHTML = `<span class="btn-icon">🚀</span> Execute Full Solver Pipeline`;
  }
}

// Render Laya Decision Telemetry
function renderTelemetry(triage) {
  document.getElementById("telemetry-empty").classList.add("hidden");
  const content = document.getElementById("telemetry-content");
  content.classList.remove("hidden");

  // Metrics
  document.getElementById("metric-domain").textContent = triage.domain;
  document.getElementById("metric-urgency").textContent = `${triage.urgency_label} (${triage.urgency_score.toFixed(2)})`;
  document.getElementById("metric-difficulty").textContent = triage.difficulty_label;
  document.getElementById("metric-latency").textContent = `${triage.latency_ms}ms`;

  // Abstention Banner
  const abstBanner = document.getElementById("abstention-banner");
  if (triage.should_abstain) {
    abstBanner.classList.remove("hidden");
    document.getElementById("abstention-msg").textContent = triage.abstention_reason || "Low model certainty on this state.";
  } else {
    abstBanner.classList.add("hidden");
  }

  // Domain Distribution Bars
  const domainHead = triage.all_heads.domain;
  const domainBarsContainer = document.getElementById("domain-bars");
  domainBarsContainer.innerHTML = "";

  if (domainHead && domainHead.probabilities) {
    document.getElementById("domain-conf-badge").textContent = `Conf: ${(domainHead.confidence * 100).toFixed(1)}%`;

    const sortedDomains = Object.entries(domainHead.probabilities).sort((a, b) => b[1] - a[1]);
    sortedDomains.forEach(([name, prob]) => {
      const pct = (prob * 100).toFixed(1);
      const isSelected = name === triage.domain;

      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <span class="bar-label" title="${name}">${name}</span>
        <div class="bar-track">
          <div class="bar-fill ${isSelected ? 'selected' : ''}" style="width: ${pct}%"></div>
        </div>
        <span class="bar-pct">${pct}%</span>
      `;
      domainBarsContainer.appendChild(row);
    });
  }

  // Urgency Rubric Bars
  const urgHead = triage.all_heads.urgency;
  const urgBarsContainer = document.getElementById("urgency-bars");
  urgBarsContainer.innerHTML = "";

  if (urgHead && urgHead.probabilities) {
    const sortedUrg = Object.entries(urgHead.probabilities);
    const legend = { "0": "routine", "1": "elevated", "2": "blocking" };
    sortedUrg.forEach(([level, prob]) => {
      const label = legend[level] || `Lvl ${level}`;
      const pct = (prob * 100).toFixed(1);
      const isSelected = Math.round(triage.urgency_score) === parseInt(level, 10);

      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <span class="bar-label">${label}</span>
        <div class="bar-track">
          <div class="bar-fill ${isSelected ? 'selected' : ''}" style="width: ${pct}%"></div>
        </div>
        <span class="bar-pct">${pct}%</span>
      `;
      urgBarsContainer.appendChild(row);
    });
  }

  // Noul Gauges
  const sensPct = (triage.sensitivity_prob * 100).toFixed(0);
  const toolPct = (triage.needs_tools_prob * 100).toFixed(0);

  document.getElementById("noul-sens-bar").style.width = `${sensPct}%`;
  document.getElementById("noul-sens-val").textContent = `${sensPct}%`;

  document.getElementById("noul-tool-bar").style.width = `${toolPct}%`;
  document.getElementById("noul-tool-val").textContent = `${toolPct}%`;

  // Selected Solver
  document.getElementById("selected-solver-name").textContent = triage.recommended_solver;
}

// Render Solution Results
function renderResolution(solverExec, verification, totalPipelineTimeMs) {
  const container = document.getElementById("resolution-section");
  container.classList.remove("hidden");

  document.getElementById("exec-time-pill").textContent = `Total Pipeline: ${totalPipelineTimeMs}ms`;
  document.getElementById("solution-summary-text").textContent = solverExec.solution_summary;

  const stepsList = document.getElementById("solution-steps-list");
  stepsList.innerHTML = "";
  solverExec.detailed_steps.forEach(st => {
    const li = document.createElement("li");
    li.textContent = st;
    stepsList.appendChild(li);
  });

  // Verification Badge & Notes
  document.getElementById("v-score-badge").textContent = `Quality Score: ${verification.verification_score}/100`;
  document.getElementById("v-notes").textContent = verification.verification_notes;

  // Code Block
  document.getElementById("solution-code").textContent = solverExec.code_or_patch || "# No executable code generated for this response.";

  // Scroll smoothly to resolution card
  container.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Tab 2: Playground Logic
function setupPlaygroundEvents() {
  document.getElementById("btn-load-preset-pg").addEventListener("click", () => {
    document.getElementById("pg-state").value = JSON.stringify({
      "subject": "Duplicate charge on account",
      "body": "We were charged twice for our subscription. Please refund the duplicate or we will cancel immediately."
    }, null, 2);

    document.getElementById("pg-questions").value = JSON.stringify({
      "intent": {
        "type": "choice",
        "instructions": "Which department owns this request?",
        "criteria": {
          "billing": "invoices, payments, refunds",
          "technical": "bugs, outages, errors",
          "other": "everything else"
        }
      },
      "urgency": {
        "type": "score",
        "instructions": "How urgent is the request?",
        "criteria": ["routine", "soon", "blocking"]
      },
      "churn_risk": {
        "type": "noul",
        "instructions": "Does the customer threaten cancellation or chargeback?"
      }
    }, null, 2);
  });

  document.getElementById("btn-run-pg").addEventListener("click", async () => {
    try {
      const state = JSON.parse(document.getElementById("pg-state").value);
      const questions = JSON.parse(document.getElementById("pg-questions").value);

      const btn = document.getElementById("btn-run-pg");
      btn.textContent = "Executing Inference...";
      btn.disabled = true;

      const res = await fetch(`${API_BASE}/api/custom-decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, questions })
      });

      btn.textContent = "Run Custom Laya Inference";
      btn.disabled = false;

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      document.getElementById("pg-latency").textContent = `Latency: ${data.latency_ms}ms`;
      document.getElementById("pg-result").textContent = JSON.stringify(data.answers, null, 2);
    } catch (err) {
      alert(`Invalid JSON or inference error: ${err.message}`);
      document.getElementById("btn-run-pg").textContent = "Run Custom Laya Inference";
      document.getElementById("btn-run-pg").disabled = false;
    }
  });
}

// Tab 3: Evaluation Suite Logic
function setupEvalEvents() {
  const btn = document.getElementById("btn-run-eval");
  btn.addEventListener("click", async () => {
    btn.textContent = "Running Benchmark Suite...";
    btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/eval`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const report = await res.json();

      document.getElementById("eval-empty").classList.add("hidden");
      document.getElementById("eval-results").classList.remove("hidden");

      document.getElementById("eval-acc").textContent = `${report.domain_accuracy}%`;
      document.getElementById("eval-conf").textContent = `${report.average_confidence}%`;
      document.getElementById("eval-abstain").textContent = `${report.abstention_rate}%`;
      document.getElementById("eval-latency").textContent = `${report.average_latency_ms}ms`;

      // Calibration Table
      const calibContainer = document.getElementById("calibration-table");
      calibContainer.innerHTML = "";
      report.reliability_bins.forEach(b => {
        const row = document.createElement("div");
        row.className = "calib-row";
        row.innerHTML = `
          <span class="calib-range">${b.range}</span>
          <div class="bar-track" style="flex:1;">
            <div class="bar-fill selected" style="width: ${b.accuracy}%;"></div>
          </div>
          <span class="mono-tag">${b.accuracy}% Acc (${b.sample_count} samples)</span>
        `;
        calibContainer.appendChild(row);
      });

      // Confusion Matrix
      const matrixView = document.getElementById("confusion-matrix-view");
      const matrix = report.confusion_matrix;
      const domains = Object.keys(matrix);

      let tableHtml = `<table class="matrix-table"><thead><tr><th>Expected \\ Pred</th>`;
      domains.forEach(d => { tableHtml += `<th>${d}</th>`; });
      tableHtml += `</tr></thead><tbody>`;

      domains.forEach(exp => {
        tableHtml += `<tr><th>${exp}</th>`;
        domains.forEach(pred => {
          const count = matrix[exp] && matrix[exp][pred] ? matrix[exp][pred] : 0;
          const isDiagonal = (exp === pred);
          tableHtml += `<td class="${isDiagonal && count > 0 ? 'matrix-match' : ''}">${count}</td>`;
        });
        tableHtml += `</tr>`;
      });
      tableHtml += `</tbody></table>`;
      matrixView.innerHTML = tableHtml;

    } catch (err) {
      alert(`Evaluation error: ${err.message}`);
    } finally {
      btn.textContent = "⚡ Run Full Benchmark Suite";
      btn.disabled = false;
    }
  });
}
