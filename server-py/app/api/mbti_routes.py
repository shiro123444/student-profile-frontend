"""Enhanced MBTI analysis routes (PsyCOT)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class PsyCOTAnswer(BaseModel):
    """A single answer in a PsyCOT questionnaire."""

    question_id: int
    choice: str  # A, B, C, or D


class PsyCOTDimensionAnswers(BaseModel):
    """Answers for a single MBTI dimension."""

    dimension: str  # EI, SN, TF, JP
    responses: list[PsyCOTAnswer]


class PsyCOTAnalyzeRequest(BaseModel):
    """Request for full PsyCOT MBTI analysis."""

    student_id: str
    answers: list[PsyCOTDimensionAnswers]


class PsyCOTResult(BaseModel):
    """Result of PsyCOT MBTI analysis."""

    mbti_code: str
    soft_labels: dict[str, float]  # {"EI": 0.8, "SN": 0.3, ...}
    confidence: dict[str, float]  # {"EI": 0.6, "SN": 0.4, ...}
    analysis: str  # AI-generated analysis text


@router.post("/analyze-psycot", response_model=PsyCOTResult)
async def analyze_psycot(request: PsyCOTAnalyzeRequest):
    """Analyze PsyCOT questionnaire results."""
    from app.mbti.dimension_calculator import DimensionCalculator

    calc = DimensionCalculator()

    soft_labels = {}
    confidence = {}
    mbti_letters = []

    for dim_answers in request.answers:
        dim = dim_answers.dimension
        answers = [{"question_id": a.question_id, "choice": a.choice} for a in dim_answers.responses]

        soft = calc.calculate_soft_label(dim, answers)
        conf = calc.calculate_confidence(dim, answers)
        letter = calc.calculate_hard_label(dim, answers)

        soft_labels[dim] = round(soft, 3)
        confidence[dim] = round(conf, 3)
        mbti_letters.append(letter)

    mbti_code = "".join(mbti_letters)

    return PsyCOTResult(
        mbti_code=mbti_code,
        soft_labels=soft_labels,
        confidence=confidence,
        analysis=f"Based on PsyCOT analysis, your MBTI type is {mbti_code}.",
    )
