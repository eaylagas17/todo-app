from sqlalchemy.orm import Session

from app import crud
from app.errors import EmailTaken

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-password"
DEMO_TASKS = ("Drag me to reorder", "Search for me", "Open me to edit", "Tick me off")


def seed_demo(db: Session) -> None:
    try:
        user = crud.create_user(db, DEMO_EMAIL, DEMO_PASSWORD)
    except EmailTaken:
        return
    for description in DEMO_TASKS:
        crud.create_task(db, user, description)
