import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.models import ProblemSubmission
from backend.engine import LayaDecisionEngine
from backend.solvers import registry

def test_engine_initialization():
    engine = LayaDecisionEngine()
    assert engine is not None
    assert engine.agent is not None

def test_triage_code_bug():
    engine = LayaDecisionEngine()
    sub = ProblemSubmission(
        title="ZeroDivisionError in calculate_average",
        description="Unhandled ZeroDivisionError when calculating average of an empty list.",
        min_confidence=0.60
    )
    triage = engine.triage_problem(sub)
    assert triage.domain == "code_bug"
    assert triage.domain_confidence > 0.60
    assert triage.recommended_solver == "CodeBugSolver"
    assert triage.latency_ms > 0

def test_solver_execution_and_verification():
    engine = LayaDecisionEngine()
    sub = ProblemSubmission(
        title="KeyError in user profile lookup",
        description="Function crashed with KeyError: 'avatar_url' when user has not set an avatar.",
        min_confidence=0.60
    )
    triage = engine.triage_problem(sub)
    solver = registry.get_solver(triage.recommended_solver)
    result = solver.solve(sub, triage)

    assert result.solver_name == "CodeBugSolver"
    assert "KeyError" in result.solution_summary
    assert result.code_or_patch is not None

    verification = engine.verify_solution(sub, f"{result.solution_summary}\n\n{result.code_or_patch}")
    assert verification.satisfies_constraints is True
    assert verification.verification_score > 50.0

def test_abstention_threshold():
    engine = LayaDecisionEngine()
    # Ambiguous problem statement with high confidence threshold
    sub = ProblemSubmission(
        title="Something weird happened",
        description="I am not sure what is going on. It says hello.",
        min_confidence=0.99  # Intentionally strict to test abstention
    )
    triage = engine.triage_problem(sub)
    assert triage.should_abstain is True
    assert triage.abstention_reason is not None

if __name__ == "__main__":
    print("Running LayaResolve verification tests...")
    test_engine_initialization()
    print("[OK] Engine initialized")
    test_triage_code_bug()
    print("[OK] Triage test passed")
    test_solver_execution_and_verification()
    print("[OK] Solver & verification passed")
    test_abstention_threshold()
    print("[OK] Abstention test passed")
    print("All tests passed successfully!")
