import json
from pathlib import Path

import pytest

from app.graph import breaks_link, find_path, repair

# The repair cases, as data: name, desired order, links, expected order.
CASES = json.loads((Path(__file__).parent / "repair_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_repair(case):
    assert repair(case["desired"], case["waits_for"]) == case["expected"]


def test_repair_refuses_a_loop():
    with pytest.raises(ValueError):
        repair(["A", "B"], {"A": ["B"], "B": ["A"]})


def test_find_path_follows_waits_for():
    assert find_path({"B": ["A"]}, "B", "A") == ["B", "A"]
    assert find_path({"C": ["B"], "B": ["A"]}, "C", "A") == ["C", "B", "A"]


def test_find_path_is_none_without_a_path():
    assert find_path({"B": ["A"]}, "A", "B") is None


def test_breaks_link():
    assert breaks_link(["A", "B"], {"A": ["B"]}) is True
    assert breaks_link(["B", "A"], {"A": ["B"]}) is False
