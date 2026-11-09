import pytest

from app.config import Config
from app.database import Database
from app.hub import Hub


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.mqtt_enabled = False
    c.db_path = str(tmp_path / "test.db")
    c.api_token = ""
    c.allowed_nodes = ["node1"]
    c.device_hmac_key = ""
    c.warning_c, c.critical_c, c.recovery_c, c.recovery_seconds, c.offline_seconds = 40, 45, 43, 10, 10
    c.flood_max_per_sec = 5
    return c


@pytest.fixture
def hub(cfg, clock):
    h = Hub(cfg, clock=clock)
    yield h
    h.db.close()
