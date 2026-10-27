"""The live state of this copy of the server, for the Status page (spec §14).

/api/health gates traffic (load balancers and probes read it); this page only reports, so it
answers 200 even when the database is down, and says so.
"""

import os
import socket
import time

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import ai
from app.db import utcnow

STARTED_AT = utcnow()


def current_status(db: Session) -> dict:
    try:
        start = time.perf_counter()
        db.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        database = {"ok": True, "latency_ms": latency_ms}
        usage = ai.ai_usage(db)
    except SQLAlchemyError:
        database, usage = {"ok": False, "latency_ms": None}, None
    return {
        "version": os.environ.get("GIT_SHA", "dev"),
        "replica": socket.gethostname(),
        "started_at": STARTED_AT,
        "uptime_seconds": round((utcnow() - STARTED_AT).total_seconds()),
        "database": database,
        "ai": usage,
    }
