"""The live state of this copy of the server, for the Status page.

/api/health gates traffic (load balancers and probes read it); this page only reports, so it
answers 200 even when the database is down, and says so.
"""

import os
import socket
import time

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import utcnow

STARTED_AT = utcnow()


def current_status(db: Session) -> dict:
    try:
        start = time.perf_counter()
        db.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        database = {"ok": True, "latency_ms": latency_ms}
    except SQLAlchemyError:
        database = {"ok": False, "latency_ms": None}
    return {
        "version": os.environ.get("GIT_SHA", "dev"),
        "replica": socket.gethostname(),
        "started_at": STARTED_AT,
        "uptime_seconds": round((utcnow() - STARTED_AT).total_seconds()),
        "database": database,
        # Tells a reviewer running it without a key why no suggestions appear.
        "ai_enabled": bool(os.environ.get("TYPESAFE_API_KEY")),
    }
