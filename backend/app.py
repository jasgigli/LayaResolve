import os
import json
import time
import uuid
import ctypes
import shutil
import platform
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.models import (
    ProblemSubmission,
    TriageAnalysis,
    FullResolutionResponse,
    CustomDecisionRequest,
    EvalReport
)
from backend.engine import LayaDecisionEngine
from backend.solvers import registry

app = FastAPI(
    title="LayaResolve: Autonomous Problem Solver",
    description="High-speed problem triage, dynamic routing, and multi-solver resolution powered by Laya AI decision models.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize engine singleton
engine = LayaDecisionEngine()

# Helpers for system status
class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]

def get_system_specs() -> Dict[str, Any]:
    import torch
    device_name = f"GPU ({torch.cuda.get_device_name(0)})" if torch.cuda.is_available() else "CPU (PyTorch Engine)"
    
    # Cross-platform memory & disk detection
    total_ram = 0.0
    avail_ram = 0.0
    free_disk = 0.0
    try:
        if os.name == 'nt':
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            total_ram = round(stat.ullTotalPhys / (1024**3), 2)
            avail_ram = round(stat.ullAvailPhys / (1024**3), 2)
        disk_info = shutil.disk_usage(os.getcwd())
        free_disk = round(disk_info.free / (1024**3), 2)
    except Exception:
        pass

    return {
        "os": platform.system() + " " + platform.release(),
        "total_ram_gb": total_ram,
        "available_ram_gb": avail_ram,
        "disk_free_gb": free_disk,
        "device": device_name,
        "model_loaded": "convaiinnovations/laya (ModernBERT-large, ~421M params)",
        "runtime": "Local Offline Inference",
        "author": "Junaid Ali Shah Gilgiti",
        "github": "https://github.com/jasgigli",
        "repository": "https://github.com/jasgigli/LayaResolve"
    }

@app.get("/api/status")
def get_status():
    return {
        "status": "online",
        "system": get_system_specs()
    }

@app.get("/api/examples")
def get_examples():
    path = os.path.join(os.path.dirname(__file__), "templates", "benchmark_problems.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

@app.post("/api/triage", response_model=TriageAnalysis)
def triage_endpoint(submission: ProblemSubmission):
    try:
        return engine.triage_problem(submission)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Triage error: {str(e)}")

@app.post("/api/solve", response_model=FullResolutionResponse)
def solve_endpoint(submission: ProblemSubmission):
    t_start = time.time()
    prob_id = f"prob-{uuid.uuid4().hex[:8]}"

    # Step 1: Laya Triage
    triage_result = engine.triage_problem(submission)

    # Step 2: Route & Execute Solver
    solver = registry.get_solver(triage_result.recommended_solver)
    solver_result = solver.solve(submission, triage_result)

    # Step 3: Laya Post-Solution Verification
    verification_result = engine.verify_solution(
        submission,
        f"{solver_result.solution_summary}\n\n{solver_result.code_or_patch or ''}"
    )

    total_pipeline_time_ms = round((time.time() - t_start) * 1000.0, 2)

    return FullResolutionResponse(
        problem_id=prob_id,
        title=submission.title,
        triage=triage_result,
        solver_execution=solver_result,
        verification=verification_result,
        total_pipeline_time_ms=total_pipeline_time_ms,
        timestamp=time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    )

@app.post("/api/custom-decide")
def custom_decide_endpoint(request: CustomDecisionRequest):
    """
    Arbitrary decision execution with Laya (choice, score, noul).
    """
    try:
        t0 = time.time()
        questions = {k: v.dict() for k, v in request.questions.items()}
        res = engine.agent.predict(request.state, questions)
        elapsed_ms = round((time.time() - t0) * 1000.0, 2)
        return {
            "answers": res.get("answers", {}),
            "routing": res.get("routing", {}),
            "latency_ms": elapsed_ms
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/eval", response_model=EvalReport)
def run_evaluation():
    """
    Runs evaluation over the benchmark problem suite.
    Computes domain classification accuracy, abstention rate, average confidence, and calibration bins.
    """
    path = os.path.join(os.path.dirname(__file__), "templates", "benchmark_problems.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Benchmark dataset not found.")

    with open(path, "r", encoding="utf-8") as f:
        samples = json.load(f)

    correct_domain = 0
    total_conf = 0.0
    total_latency = 0.0
    abstentions = 0
    confusion: Dict[str, Dict[str, int]] = {}

    bin_counts = [0] * 5  # [0.5-0.6, 0.6-0.7, 0.7-0.8, 0.8-0.9, 0.9-1.0]
    bin_correct = [0] * 5

    for s in samples:
        sub = ProblemSubmission(
            title=s["title"],
            description=s["description"],
            context=s.get("context", {}),
            min_confidence=0.60
        )
        triage = engine.triage_problem(sub)
        pred_dom = triage.domain
        exp_dom = s["expected_domain"]

        if exp_dom not in confusion:
            confusion[exp_dom] = {}
        confusion[exp_dom][pred_dom] = confusion[exp_dom].get(pred_dom, 0) + 1

        is_corr = (pred_dom == exp_dom)
        if is_corr:
            correct_domain += 1

        if triage.should_abstain:
            abstentions += 1

        conf = triage.domain_confidence
        total_conf += conf
        total_latency += triage.latency_ms

        # Binning for calibration check
        b_idx = min(max(int((conf - 0.5) / 0.1), 0), 4)
        bin_counts[b_idx] += 1
        if is_corr:
            bin_correct[b_idx] += 1

    total = len(samples)
    reliability_bins = []
    bin_ranges = ["50-60%", "60-70%", "70-80%", "80-90%", "90-100%"]
    for i in range(5):
        cnt = bin_counts[i]
        acc = round((bin_correct[i] / cnt) * 100, 1) if cnt > 0 else 0.0
        reliability_bins.append({
            "range": bin_ranges[i],
            "sample_count": cnt,
            "accuracy": acc
        })

    return EvalReport(
        total_samples=total,
        domain_accuracy=round((correct_domain / total) * 100, 1),
        average_confidence=round((total_conf / total) * 100, 1),
        abstention_count=abstentions,
        abstention_rate=round((abstentions / total) * 100, 1),
        average_latency_ms=round(total_latency / total, 1),
        confusion_matrix=confusion,
        reliability_bins=reliability_bins
    )

# Static file serving for Frontend
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.get("/style.css")
def serve_style():
    css_path = os.path.join(frontend_dir, "style.css")
    if os.path.exists(css_path):
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="style.css not found")

@app.get("/app.js")
def serve_script():
    js_path = os.path.join(frontend_dir, "app.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")

@app.get("/favicon.ico")
def serve_favicon():
    return FileResponse(os.path.join(frontend_dir, "favicon.ico"), status_code=204) if not os.path.exists(os.path.join(frontend_dir, "favicon.ico")) else FileResponse(os.path.join(frontend_dir, "favicon.ico"))

if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_root():
    index_file = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "LayaResolve Backend Online. Frontend files initializing..."}
