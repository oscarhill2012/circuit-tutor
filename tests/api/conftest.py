"""Make `api/` importable so unit tests can `import agent_runner` etc."""

import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[2] / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))
