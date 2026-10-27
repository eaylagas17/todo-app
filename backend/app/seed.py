from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import crud
from app.errors import EmailTaken
from app.models import Category, Subtask, Task, TaskLink, User

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-password"

# The wedding example: (title, category, waits for, subtasks). Prerequisites come
# before the tasks that wait for them, so the order keeps every link.
EXAMPLE = (
    (
        "Book the venue",
        "Wedding",
        (),
        ("Shortlist three places", "Visit on Saturday", "Pay the deposit"),
    ),
    ("Confirm guest list", "Wedding", (), ()),
    (
        "Send invitations",
        "Wedding",
        ("Book the venue", "Confirm guest list"),
        ("Print 40 cards", "Buy stamps"),
    ),
    ("Seating plan", "Wedding", ("Send invitations",), ()),
    ("Renew passport", "Travel", (), ()),
    ("Book flights", "Travel", ("Renew passport",), ()),
    ("Order the cake", "Wedding", (), ()),
)


def add_example(db: Session, user: User) -> None:
    """Adds the example after the user's own tasks, in one transaction."""
    categories = {c.name.lower(): c for c in crud.list_categories(db, user)}
    top = db.scalar(select(func.max(Task.position)).where(Task.owner_id == user.id))
    added: dict[str, Task] = {}
    for offset, (title, category, waits_for, subtasks) in enumerate(EXAMPLE, 1):
        if category.lower() not in categories:
            categories[category.lower()] = Category(owner_id=user.id, name=category)
            db.add(categories[category.lower()])
            db.flush()  # gives the new category its id
        task = Task(
            owner_id=user.id,
            title=title,
            position=(top or 0) + offset,
            category_id=categories[category.lower()].id,
            subtasks=[Subtask(title=name) for name in subtasks],
            links=[TaskLink(depends_on_id=added[name].id) for name in waits_for],
        )
        db.add(task)
        db.flush()  # gives the task its id, for the tasks that wait for it
        added[title] = task
    db.commit()


def seed_demo(db: Session) -> None:
    try:
        user = crud.create_user(db, DEMO_EMAIL, DEMO_PASSWORD)
    except EmailTaken:
        return
    add_example(db, user)
