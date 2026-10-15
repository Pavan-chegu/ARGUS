import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.db.falkor import falkor_client, FalkorUnavailable
from backend.db.seed_data import seed_database
from backend.routers.graph import router as graph_router
from backend.routers.attack import router as attack_router
from backend.routers.stream import router as stream_router
from backend.routers.rag import router as rag_router
from backend.routers.swarm import router as swarm_router
from backend.routers.triage import router as triage_router
from backend.routers.agent import router as agent_router
from backend.mcp_server import mcp_app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("argus-main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Argus CloudMesh FastAPI Backend...")
    seed_database(force=False)  # keep persisted FalkorDB state across restarts
    yield

app = FastAPI(
    title="Argus CloudMesh — Autonomous IAM Attack Pathfinder",
    description="Sub-millisecond multi-hop IAM privilege escalation hunter powered by FalkorDB Graph Engine",
    version="2.1.0",
    lifespan=lifespan
)

# Enable CORS for Frontend Dev Server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# FalkorDB unavailable → 503
@app.exception_handler(FalkorUnavailable)
async def falkor_unavailable_handler(request: Request, exc: FalkorUnavailable):
    return JSONResponse(status_code=503, content={"detail": "FalkorDB is not available. Start Docker and retry.", "mode": "down"})

# Register Routers
app.include_router(graph_router)
app.include_router(attack_router)
app.include_router(stream_router)
app.include_router(rag_router)
app.include_router(swarm_router)
app.include_router(triage_router)
app.include_router(agent_router)

# MCP server (SSE) — available at /mcp when mcp package is installed
if mcp_app is not None:
    app.mount("/mcp", mcp_app)

@app.get("/")
def root():
    return {
        "app": "Argus CloudMesh Engine",
        "status": "online" if falkor_client.is_live else "degraded",
        "engine": falkor_client.live.ENGINE_NAME if falkor_client.is_live else "none",
        "mode": falkor_client.mode,
        "version": "2.1.0",
        "features": ["autonomous_agent_swarm", "graph_rag", "episodic_memory", "triage", "mcp_server"],
        "docs": "/docs"
    }

@app.get("/health")
def health():
    return falkor_client.health_check()
