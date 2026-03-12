"""MBTI PsyCOT question bank - extracted from MbtiBench dataset."""

from __future__ import annotations

# Questions sourced from dataset/MbtiBench/mbtibench/prompt.py _get_questionnaires()
# Translated to Chinese for the PathMind platform.
# Format: {id, dimension, question_zh, question_en, options_zh, options_en}

PSYCOT_QUESTIONS: list[dict] = [
    # ── E/I Dimension (11 questions) ──
    {"id": 3, "dimension": "EI", "question_zh": "你通常是：", "question_en": "The author is usually:", "options_zh": {"A": "善于与各种人打交道", "B": "安静且内敛", "C": "不确定"}, "options_en": {"A": "A good mixer with groups of people", "B": "Quiet and reserved", "C": "Not sure"}},
    {"id": 6, "dimension": "EI", "question_zh": "你在社交场合中，通常：", "question_en": "In social situations, the author usually:", "options_zh": {"A": "主动与人交谈", "B": "等别人来找自己", "C": "不确定"}, "options_en": {"A": "Initiates conversation", "B": "Waits for others to approach", "C": "Not sure"}},
    {"id": 9, "dimension": "EI", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "安静", "B": "热情", "C": "不确定"}, "options_en": {"A": "QUIET", "B": "HEARTY", "C": "Not sure"}},
    {"id": 13, "dimension": "EI", "question_zh": "你可以长时间毫无保留地与人交谈吗：", "question_en": "Can the author talk freely at length:", "options_zh": {"A": "只与少数人可以", "B": "和大多数人都可以", "C": "不确定"}, "options_en": {"A": "Only with a few people", "B": "With most people", "C": "Not sure"}},
    {"id": 16, "dimension": "EI", "question_zh": "你在聚会中倾向于：", "question_en": "At a party, the author tends to:", "options_zh": {"A": "与许多人互动，包括陌生人", "B": "只与少数熟人互动", "C": "不确定"}, "options_en": {"A": "Interact with many, including strangers", "B": "Interact with a few known people", "C": "Not sure"}},
    {"id": 21, "dimension": "EI", "question_zh": "你通常：", "question_en": "The author usually:", "options_zh": {"A": "自由表达感受", "B": "保留自己的想法", "C": "不确定"}, "options_en": {"A": "Shows feelings freely", "B": "Keeps feelings to self", "C": "Not sure"}},
    {"id": 24, "dimension": "EI", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "内敛的", "B": "外向的", "C": "不确定"}, "options_en": {"A": "RESERVED", "B": "TALKATIVE", "C": "Not sure"}},
    {"id": 26, "dimension": "EI", "question_zh": "你在人群中通常扮演：", "question_en": "In a group, the author usually:", "options_zh": {"A": "倾听者", "B": "发言者", "C": "不确定"}, "options_en": {"A": "Listener", "B": "Talker", "C": "Not sure"}},
    {"id": 29, "dimension": "EI", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "沉静的", "B": "活泼的", "C": "不确定"}, "options_en": {"A": "CALM", "B": "LIVELY", "C": "Not sure"}},
    {"id": 36, "dimension": "EI", "question_zh": "你和新朋友在一起时：", "question_en": "With new acquaintances, the author:", "options_zh": {"A": "能很快打成一片", "B": "需要较长时间才能了解他们", "C": "不确定"}, "options_en": {"A": "Quickly gets to know them", "B": "Takes time to get to know them", "C": "Not sure"}},
    {"id": 43, "dimension": "EI", "question_zh": "你通常：", "question_en": "The author usually:", "options_zh": {"A": "容易被人了解", "B": "很难被人了解", "C": "不确定"}, "options_en": {"A": "Easy to get to know", "B": "Hard to get to know", "C": "Not sure"}},

    # ── S/N Dimension (14 questions) ──
    {"id": 2, "dimension": "SN", "question_zh": "如果你是老师，你更愿意教：", "question_en": "If the author was a teacher, would they rather teach:", "options_zh": {"A": "基于事实的课程", "B": "涉及理论和观点的课程", "C": "不确定"}, "options_en": {"A": "Facts-based courses", "B": "Courses involving opinion or theory", "C": "Not sure"}},
    {"id": 5, "dimension": "SN", "question_zh": "你做事倾向于：", "question_en": "The author tends to:", "options_zh": {"A": "按照常规方法", "B": "用自己独特的方式", "C": "不确定"}, "options_en": {"A": "Do things the conventional way", "B": "Do things their own way", "C": "Not sure"}},
    {"id": 10, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "事实", "B": "想法", "C": "不确定"}, "options_en": {"A": "FACTS", "B": "IDEAS", "C": "Not sure"}},
    {"id": 12, "dimension": "SN", "question_zh": "你更信赖：", "question_en": "The author trusts more:", "options_zh": {"A": "自己的经验", "B": "自己的直觉", "C": "不确定"}, "options_en": {"A": "Their experience", "B": "Their intuition", "C": "Not sure"}},
    {"id": 15, "dimension": "SN", "question_zh": "你更擅长注意到：", "question_en": "The author is better at noticing:", "options_zh": {"A": "实际的细节", "B": "事物的可能性", "C": "不确定"}, "options_en": {"A": "Practical details", "B": "Possibilities", "C": "Not sure"}},
    {"id": 20, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "具体的", "B": "抽象的", "C": "不确定"}, "options_en": {"A": "CONCRETE", "B": "ABSTRACT", "C": "Not sure"}},
    {"id": 23, "dimension": "SN", "question_zh": "你更像：", "question_en": "The author is more like:", "options_zh": {"A": "务实主义者", "B": "理想主义者", "C": "不确定"}, "options_en": {"A": "A practical person", "B": "An imaginative person", "C": "Not sure"}},
    {"id": 28, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "富有想象力的", "B": "脚踏实地的", "C": "不确定"}, "options_en": {"A": "IMAGINATIVE", "B": "MATTER-OF-FACT", "C": "Not sure"}},
    {"id": 31, "dimension": "SN", "question_zh": "你写作时更倾向于：", "question_en": "When writing, the author tends to:", "options_zh": {"A": "字面表达", "B": "使用比喻和隐喻", "C": "不确定"}, "options_en": {"A": "Be literal", "B": "Use metaphors and analogies", "C": "Not sure"}},
    {"id": 35, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "生产", "B": "设计", "C": "不确定"}, "options_en": {"A": "PRODUCTION", "B": "DESIGN", "C": "Not sure"}},
    {"id": 38, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "实际的", "B": "有远见的", "C": "不确定"}, "options_en": {"A": "SENSIBLE", "B": "FASCINATING", "C": "Not sure"}},
    {"id": 42, "dimension": "SN", "question_zh": "你更看重：", "question_en": "The author values more:", "options_zh": {"A": "确定性", "B": "可能性", "C": "不确定"}, "options_en": {"A": "Certainty", "B": "Possibility", "C": "Not sure"}},
    {"id": 45, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "理论", "B": "实践", "C": "不确定"}, "options_en": {"A": "THEORY", "B": "PRACTICE", "C": "Not sure"}},
    {"id": 48, "dimension": "SN", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "字面意思", "B": "象征意义", "C": "不确定"}, "options_en": {"A": "LITERAL", "B": "FIGURATIVE", "C": "Not sure"}},

    # ── T/F Dimension (14 questions) ──
    {"id": 4, "dimension": "TF", "question_zh": "你更多地让：", "question_en": "Does the author more often let:", "options_zh": {"A": "情感引导理智", "B": "理智引导情感", "C": "不确定"}, "options_en": {"A": "Heart rule head", "B": "Head rule heart", "C": "Not sure"}},
    {"id": 14, "dimension": "TF", "question_zh": "你更看重：", "question_en": "The author values more:", "options_zh": {"A": "温情", "B": "逻辑", "C": "不确定"}, "options_en": {"A": "Warmth", "B": "Logic", "C": "Not sure"}},
    {"id": 22, "dimension": "TF", "question_zh": "在做决定时，你更倾向于：", "question_en": "When making decisions, the author tends to:", "options_zh": {"A": "基于感受", "B": "基于分析", "C": "不确定"}, "options_en": {"A": "Based on feelings", "B": "Based on analysis", "C": "Not sure"}},
    {"id": 30, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "和平使者", "B": "裁判", "C": "不确定"}, "options_en": {"A": "PEACEMAKER", "B": "JUDGE", "C": "Not sure"}},
    {"id": 32, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "公正", "B": "仁慈", "C": "不确定"}, "options_en": {"A": "JUSTICE", "B": "MERCY", "C": "Not sure"}},
    {"id": 33, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "温柔的", "B": "坚定的", "C": "不确定"}, "options_en": {"A": "GENTLE", "B": "FIRM", "C": "Not sure"}},
    {"id": 37, "dimension": "TF", "question_zh": "你更容易被说服的是：", "question_en": "The author is more persuaded by:", "options_zh": {"A": "有说服力的论证", "B": "感人的呼吁", "C": "不确定"}, "options_en": {"A": "A convincing argument", "B": "A touching appeal", "C": "Not sure"}},
    {"id": 39, "dimension": "TF", "question_zh": "你觉得更大的错误是：", "question_en": "The author thinks the greater fault is:", "options_zh": {"A": "太无情", "B": "太不理性", "C": "不确定"}, "options_en": {"A": "Being too impersonal", "B": "Being too irrational", "C": "Not sure"}},
    {"id": 40, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "同情", "B": "远见", "C": "不确定"}, "options_en": {"A": "COMPASSION", "B": "FORESIGHT", "C": "Not sure"}},
    {"id": 44, "dimension": "TF", "question_zh": "你更被什么打动：", "question_en": "The author is more moved by:", "options_zh": {"A": "情感", "B": "原则", "C": "不确定"}, "options_en": {"A": "Emotions", "B": "Principles", "C": "Not sure"}},
    {"id": 46, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "有同情心的", "B": "有条理的", "C": "不确定"}, "options_en": {"A": "SYMPATHETIC", "B": "SYSTEMATIC", "C": "Not sure"}},
    {"id": 47, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "宽容的", "B": "批判的", "C": "不确定"}, "options_en": {"A": "TOLERANT", "B": "CRITICAL", "C": "Not sure"}},
    {"id": 49, "dimension": "TF", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "敏感的", "B": "客观的", "C": "不确定"}, "options_en": {"A": "SENSITIVE", "B": "OBJECTIVE", "C": "Not sure"}},
    {"id": 50, "dimension": "TF", "question_zh": "你倾向于认为自己是：", "question_en": "The author considers themselves:", "options_zh": {"A": "心肠软的人", "B": "理性的人", "C": "不确定"}, "options_en": {"A": "Softhearted", "B": "Hardheaded", "C": "Not sure"}},

    # ── J/P Dimension (11 questions) ──
    {"id": 18, "dimension": "JP", "question_zh": "提前安排好日程对你来说：", "question_en": "When it is settled in advance to do something at a certain time:", "options_zh": {"A": "很好，可以提前规划", "B": "有些不自在，被束缚了", "C": "不确定"}, "options_en": {"A": "Nice to plan accordingly", "B": "A little unpleasant to be tied down", "C": "Not sure"}},
    {"id": 1, "dimension": "JP", "question_zh": "你在日常工作中：", "question_en": "In daily work, the author:", "options_zh": {"A": "通常提前规划以避免压力", "B": "享受紧急情况带来的紧迫感", "C": "讨厌在压力下工作", "D": "不确定"}, "options_en": {"A": "Plans work to avoid pressure", "B": "Enjoys working against time", "C": "Hates working under pressure", "D": "Not sure"}},
    {"id": 7, "dimension": "JP", "question_zh": "你更喜欢：", "question_en": "The author prefers:", "options_zh": {"A": "按照计划做事", "B": "随性而为", "C": "不确定"}, "options_en": {"A": "Following a plan", "B": "Going with the flow", "C": "Not sure"}},
    {"id": 8, "dimension": "JP", "question_zh": "列周末待办清单对你来说：", "question_en": "Making a weekend to-do list:", "options_zh": {"A": "有帮助", "B": "有压力", "C": "令人沮丧", "D": "不确定"}, "options_en": {"A": "Helps", "B": "Stresses", "C": "Depresses", "D": "Not sure"}},
    {"id": 11, "dimension": "JP", "question_zh": "你倾向于：", "question_en": "The author tends to:", "options_zh": {"A": "按时完成任务", "B": "最后一刻才赶工", "C": "不确定"}, "options_en": {"A": "Finish tasks on time", "B": "Rush at the last minute", "C": "Not sure"}},
    {"id": 17, "dimension": "JP", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "有条理的", "B": "随意的", "C": "不确定"}, "options_en": {"A": "SYSTEMATIC", "B": "CASUAL", "C": "Not sure"}},
    {"id": 19, "dimension": "JP", "question_zh": "你更看重：", "question_en": "The author values more:", "options_zh": {"A": "确定性和稳定性", "B": "开放性和灵活性", "C": "不确定"}, "options_en": {"A": "Certainty and stability", "B": "Openness and flexibility", "C": "Not sure"}},
    {"id": 25, "dimension": "JP", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "果断的", "B": "适应的", "C": "不确定"}, "options_en": {"A": "DECISIVE", "B": "ADAPTABLE", "C": "Not sure"}},
    {"id": 27, "dimension": "JP", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "有计划的", "B": "即兴的", "C": "不确定"}, "options_en": {"A": "SCHEDULED", "B": "UNPLANNED", "C": "Not sure"}},
    {"id": 34, "dimension": "JP", "question_zh": "你通常：", "question_en": "The author usually:", "options_zh": {"A": "事先做好安排", "B": "到时候再说", "C": "不确定"}, "options_en": {"A": "Makes arrangements in advance", "B": "Decides when the time comes", "C": "Not sure"}},
    {"id": 41, "dimension": "JP", "question_zh": "以下哪个词更适合形容你：", "question_en": "Which word is more suitable:", "options_zh": {"A": "有结构的", "B": "自由的", "C": "不确定"}, "options_en": {"A": "STRUCTURED", "B": "FREE-SPIRITED", "C": "Not sure"}},
]


def get_questions_for_dimension(dimension: str) -> list[dict]:
    """Get all PsyCOT questions for a specific MBTI dimension.

    Args:
        dimension: One of 'EI', 'SN', 'TF', 'JP'.

    Returns:
        List of question dicts for that dimension.
    """
    return [q for q in PSYCOT_QUESTIONS if q["dimension"] == dimension]


def get_all_questions() -> list[dict]:
    """Get all 50 PsyCOT questions."""
    return PSYCOT_QUESTIONS
