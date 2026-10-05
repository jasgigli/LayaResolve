from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional

class ProblemSubmission(BaseModel):
    title: str = Field(..., description="Short title or summary of the problem")
    description: str = Field(..., description="Detailed description, error log, customer query, or code snippet")
    context: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Optional extra context (e.g. environment, user tier)")
    force_solver: Optional[str] = Field(None, description="Optional manual override for solver")
    min_confidence: float = Field(0.60, description="Abstention threshold below which human review is recommended")

class QuestionHeadConfig(BaseModel):
    type: str = Field(..., description="'choice', 'score', or 'noul'")
    instructions: str
    criteria: Optional[Any] = None

class CustomDecisionRequest(BaseModel):
    state: Dict[str, Any]
    questions: Dict[str, QuestionHeadConfig]
    model_flavor: Optional[str] = "english"

class HeadResult(BaseModel):
    type: str
    value: Any
    confidence: float
    probabilities: Dict[str, float]
    raw: Dict[str, Any]

class TriageAnalysis(BaseModel):
    domain: str
    domain_confidence: float
    difficulty_score: float
    difficulty_label: str
    urgency_score: float
    urgency_label: str
    is_sensitive: bool
    sensitivity_prob: float
    needs_tools: bool
    needs_tools_prob: float
    recommended_solver: str
    should_abstain: bool
    abstention_reason: Optional[str] = None
    all_heads: Dict[str, HeadResult]
    latency_ms: float

class SolverExecutionResult(BaseModel):
    solver_name: str
    solution_summary: str
    detailed_steps: List[str]
    code_or_patch: Optional[str] = None
    execution_time_ms: float
    metadata: Dict[str, Any] = Field(default_factory=dict)

class VerificationResult(BaseModel):
    satisfies_constraints: bool
    safety_passed: bool
    verification_score: float
    verification_notes: str
    confidence: float

class FullResolutionResponse(BaseModel):
    problem_id: str
    title: str
    triage: TriageAnalysis
    solver_execution: SolverExecutionResult
    verification: VerificationResult
    total_pipeline_time_ms: float
    timestamp: str

class EvalSample(BaseModel):
    id: str
    title: str
    text: str
    expected_domain: str
    expected_urgency: str
    is_critical: bool

class EvalReport(BaseModel):
    total_samples: int
    domain_accuracy: float
    average_confidence: float
    abstention_count: int
    abstention_rate: float
    average_latency_ms: float
    confusion_matrix: Dict[str, Dict[str, int]]
    reliability_bins: List[Dict[str, Any]]
