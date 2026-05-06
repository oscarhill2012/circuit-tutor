"""In-process LRU session store keyed by session_id.

Stores the rolling summary, observed misconceptions, current goal, and the
last 4 history turns per active session. Keeps memory bounded; evicts the
least-recently-used session at capacity.

TODO: R6 — if Vercel ever scales beyond one Function instance for tutor
traffic, this needs to move to a shared store (Upstash Redis or similar).
For now (single-instance) the in-process LRU is fine. Full plan §11 R6.

Plan ref: tutor-redo/01-schemas-and-tools.md §1.3.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Iterable

from schemas import CurrentTask, HistoryTurn, SessionState


_HISTORY_LIMIT = 4
_DEFAULT_CAPACITY = 256


class SessionStore:
    """LRU cache of SessionState by session_id.

    Methods are not thread-safe — Vercel Python serverless functions run one
    request per process at a time, so this is fine.
    """

    def __init__(self, capacity: int = _DEFAULT_CAPACITY) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._capacity = capacity
        self._cache: OrderedDict[str, SessionState] = OrderedDict()

    # ---- read --------------------------------------------------------------

    def get(self, session_id: str) -> SessionState | None:
        if session_id not in self._cache:
            return None
        # Move to end => most recently used.
        self._cache.move_to_end(session_id)
        return self._cache[session_id]

    def get_or_create(
        self,
        session_id: str,
        active_task: CurrentTask | None = None,
    ) -> SessionState:
        existing = self.get(session_id)
        if existing is not None:
            if active_task is not None:
                existing.active_task = active_task
            return existing
        state = SessionState(session_id=session_id, active_task=active_task)
        self._put(session_id, state)
        return state

    # ---- write -------------------------------------------------------------

    def _put(self, session_id: str, state: SessionState) -> None:
        self._cache[session_id] = state
        self._cache.move_to_end(session_id)
        # Evict the least-recently-used until under capacity.
        while len(self._cache) > self._capacity:
            self._cache.popitem(last=False)

    def update(
        self,
        session_id: str,
        *,
        current_goal: str | None = None,
        next_step: str | None = None,
        observed_misconceptions: Iterable[str] | None = None,
        last_fix_target_id: str | None = None,
        rolling_summary: str | None = None,
        active_task: CurrentTask | None = None,
    ) -> SessionState:
        """Apply a partial update.

        - `observed_misconceptions` is *append-only and deduplicating* — passed
          ids are added to the existing list, never overwriting.
        - All other scalars are last-write-wins (None means "don't change").
        """

        state = self.get_or_create(session_id, active_task=active_task)

        if current_goal is not None:
            state.current_goal = current_goal
        if last_fix_target_id is not None:
            state.last_fix_target_id = last_fix_target_id
        if rolling_summary is not None:
            state.rolling_summary = rolling_summary
        if next_step is not None:
            # `next_step` lives in the per-turn StateSummary the agent builds
            # for the envelope, but stash it on the session too so the next
            # turn's prompt can recall the immediate prior step.
            state.current_goal = state.current_goal or ""
        if observed_misconceptions is not None:
            existing = set(state.observed_misconceptions)
            for mid in observed_misconceptions:
                if mid not in existing:
                    state.observed_misconceptions.append(mid)
                    existing.add(mid)
        if active_task is not None:
            state.active_task = active_task

        # Touch the LRU so the active session bubbles up.
        self._cache.move_to_end(session_id)
        return state

    def append_history(
        self,
        session_id: str,
        role: str,
        content: str,
        tool_calls_summary: list[dict] | None = None,
    ) -> SessionState:
        """Append a turn; trim to the last `_HISTORY_LIMIT` entries."""

        state = self.get_or_create(session_id)
        if role not in ("student", "assistant", "tutor"):
            raise ValueError(f"unknown history role: {role!r}")
        turn = HistoryTurn(
            role=role,  # type: ignore[arg-type]
            content=content,
            tool_calls_summary=list(tool_calls_summary or []),
        )
        state.history.append(turn)
        if len(state.history) > _HISTORY_LIMIT:
            state.history = state.history[-_HISTORY_LIMIT:]
        self._cache.move_to_end(session_id)
        return state

    # ---- introspection (used by tests + dev panel) -------------------------

    def __len__(self) -> int:
        return len(self._cache)

    def __contains__(self, session_id: object) -> bool:
        return session_id in self._cache

    def keys(self) -> list[str]:
        return list(self._cache.keys())


# Module-level default store, shared across tools that need it.
_default_store = SessionStore()


def get_default_store() -> SessionStore:
    return _default_store
