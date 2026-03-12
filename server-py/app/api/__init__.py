"""API router aggregation."""

from fastapi import APIRouter

from app.api.ai_dispatch_routes import router as ai_dispatch_router
from app.api.agent_routes import router as agent_router
from app.api.mbti_routes import router as mbti_router
from app.api.note_routes import router as note_router
from app.api.rag_routes import router as rag_router
from app.api.tool_routes import router as tool_router

api_router = APIRouter()

api_router.include_router(ai_dispatch_router, prefix="/ai/dispatch", tags=["ai-dispatch"])
api_router.include_router(agent_router, prefix="/agent", tags=["agent"])
api_router.include_router(rag_router, prefix="/rag", tags=["rag"])
api_router.include_router(mbti_router, prefix="/mbti", tags=["mbti"])
api_router.include_router(tool_router, prefix="/tools", tags=["tools"])
api_router.include_router(note_router, prefix="/notes", tags=["notes"])
