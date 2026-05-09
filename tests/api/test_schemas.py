"""Verify the TutorRequest student_message length bounds reject empty and oversize input."""

import pytest
from pydantic import ValidationError

from schemas import TutorRequest


def _base_kwargs(**overrides):
    """Minimum valid kwargs to construct a TutorRequest, with overrides merged in."""
    base = {
        "session_id": "s1",
        "student_message": "hello",
        "circuit_state": {},
        "sim_result": {},
    }
    base.update(overrides)
    return base


def test_student_message_empty_rejected():
    with pytest.raises(ValidationError):
        TutorRequest(**_base_kwargs(student_message=""))


def test_student_message_too_long_rejected():
    with pytest.raises(ValidationError):
        TutorRequest(**_base_kwargs(student_message="x" * 2001))


def test_student_message_at_limit_accepted():
    """2000 chars is exactly at the limit and must still parse."""
    req = TutorRequest(**_base_kwargs(student_message="x" * 2000))
    assert len(req.student_message) == 2000
