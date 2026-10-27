"""Links between tasks as a graph: the loop check, the order repair, and the order check.

Pure functions over plain ids, with no database: "A waits for B" is written {A: [B]}.
"""

import heapq
from collections.abc import Hashable, Iterable, Mapping
from typing import Literal


def find_path[T: Hashable](
    waits_for: Mapping[T, Iterable[T]], start: T, goal: T
) -> list[T] | None:
    """A chain start → … → goal following "waits for", or None. Iterative depth-first search."""
    parent: dict[T, T | None] = {start: None}
    stack = [start]
    while stack:
        node = stack.pop()
        if node == goal:
            path = [node]
            while (node := parent[node]) is not None:
                path.append(node)
            return path[::-1]
        for nxt in waits_for.get(node, ()):
            if nxt not in parent:
                parent[nxt] = node
                stack.append(nxt)
    return None


def repair[T: Hashable](
    desired: list[T],
    waits_for: Mapping[T, Iterable[T]],
    direction: Literal["down", "up"],
) -> list[T]:
    """The order closest to `desired` that keeps every link: a stable topological sort.

    Whatever is in the way of the dragged task moves with it, in the direction it was dragged.
    """
    index = {t: i for i, t in enumerate(desired)}
    before = {t: [p for p in waits_for.get(t, ()) if p in index] for t in desired}
    after: dict[T, list[T]] = {t: [] for t in desired}
    for t, prerequisites in before.items():
        for p in prerequisites:
            after[p].append(t)
    # down: fill from the top; a task waits for its prerequisites; earliest desired index first.
    # up: fill from the bottom; a task waits for its dependents; latest desired index first.
    blocking, unblocks, sign = (
        (before, after, 1) if direction == "down" else (after, before, -1)
    )
    remaining = {t: len(blocking[t]) for t in desired}
    heap = [(sign * index[t], index[t]) for t in desired if remaining[t] == 0]
    heapq.heapify(heap)
    placed = []
    while heap:
        _, i = heapq.heappop(heap)
        placed.append(desired[i])
        for n in unblocks[desired[i]]:
            remaining[n] -= 1
            if remaining[n] == 0:
                heapq.heappush(heap, (sign * index[n], index[n]))
    if len(placed) != len(desired):
        raise ValueError("links form a loop")
    return placed if direction == "down" else placed[::-1]


def breaks_link[T: Hashable](
    order: list[T], waits_for: Mapping[T, Iterable[T]]
) -> bool:
    """True if any task sits above a task it waits for."""
    position = {t: i for i, t in enumerate(order)}
    return any(
        position[t] < position[p]
        for t, prerequisites in waits_for.items()
        for p in prerequisites
        if t in position and p in position
    )
