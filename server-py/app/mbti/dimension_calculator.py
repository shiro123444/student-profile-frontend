"""MBTI PsyCOT dimension calculator."""

from __future__ import annotations


class DimensionCalculator:
    """Calculates MBTI dimension scores using PsyCOT methodology.

    Soft labels: 0.0 = pure first letter (E/S/T/J), 1.0 = pure second letter (I/N/F/P).
    Confidence: 0.0 = borderline, 1.0 = very decisive.
    """

    def calculate_soft_label(self, dimension: str, answers: list[dict]) -> float:
        """Calculate soft label (0.0-1.0) for a dimension.

        A answers map to the first letter (E, S, T, J).
        B answers map to the second letter (I, N, F, P).
        C/D answers are neutral and don't count.
        """
        first_count = 0
        second_count = 0

        for answer in answers:
            choice = answer.get("choice", "").upper()
            if choice == "A":
                first_count += 1
            elif choice == "B":
                second_count += 1
            # C, D = neutral, skip

        total = first_count + second_count
        if total == 0:
            return 0.5  # No decisive answers

        return second_count / total

    def calculate_confidence(self, dimension: str, answers: list[dict]) -> float:
        """Calculate confidence (0.0-1.0) for the dimension classification.

        Higher = more decisive; lower = borderline.
        """
        soft = self.calculate_soft_label(dimension, answers)
        return abs(soft - 0.5) * 2

    def calculate_hard_label(self, dimension: str, answers: list[dict]) -> str:
        """Return the binary letter (E/I, S/N, T/F, J/P)."""
        soft = self.calculate_soft_label(dimension, answers)

        dim_map = {
            "EI": ("E", "I"),
            "SN": ("S", "N"),
            "TF": ("T", "F"),
            "JP": ("J", "P"),
        }

        first, second = dim_map.get(dimension, (dimension[0], dimension[1]))
        return second if soft > 0.5 else first
