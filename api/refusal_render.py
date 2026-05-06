"""Server-side rendering of refusal text.

The model proposes the (reason, redirect) shape via the `refuse` tool; the
server constructs the prose. This stops the model from authoring refusal
prose directly — every refusal turn carries a known canonical line.

"""

from __future__ import annotations

from schemas import RefuseArgs, SessionState


CANONICAL_REFUSAL = "I am only here to teach you about circuits."


def _redirect_sentence(args: RefuseArgs, session: SessionState | None) -> str:
    """Build an on-ramp sentence so refusals don't dead-end."""

    redirect = args.redirect
    if redirect is None or redirect.kind == "none":
        return ""

    if redirect.kind == "current_task":
        task = session.active_task if session else None
        if task and task.topic:
            return f" Let's get back to your task on {task.topic}."
        return " Let's get back to your task."

    if redirect.kind == "current_focus":
        if session and session.current_goal:
            return f" Let's stay on {session.current_goal}."
        return " Let's stay on your circuit."

    return ""


def render_refusal(args: RefuseArgs, session: SessionState | None = None) -> str:
    """Return the canonical refusal sentence + an optional on-ramp.

    The renderer is the single source of truth for refusal prose — the
    post-validator will compare `assistant_text` to this output exactly.
    """

    return CANONICAL_REFUSAL + _redirect_sentence(args, session)
