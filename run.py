import uvicorn
import os
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("=========================================================")
    print("  [*] LayaResolve: Autonomous Problem Solver Online")
    print("  Model: convaiinnovations/laya (ModernBERT-large)")
    print("  Running locally on: http://127.0.0.1:8000")
    print("=========================================================")
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=False)
