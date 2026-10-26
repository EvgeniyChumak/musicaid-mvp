"""Vercel entrypoint for the existing FastAPI application."""

from pathlib import Path
import sys

# The backend was intentionally kept as a standalone local Python project.
# Add its root to the import path so its existing ``app.*`` imports work in
# Vercel's root-level Python function without duplicating backend code.
BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.main import app

__all__ = ["app"]
