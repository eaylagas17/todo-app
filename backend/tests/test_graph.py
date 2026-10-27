import json
from pathlib import Path

import pytest

from app.graph import repair

# The repair cases, as data: name, desired order, links, expected order.
CASES = json.loads((Path(__file__).parent / "repair_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_repair(case):
    assert repair(case["desired"], case["waits_for"]) == case["expected"]


def test_repair_refuses_a_loop():
    with pytest.raises(ValueError):
        repair(["A", "B"], {"A": ["B"], "B": ["A"]})
