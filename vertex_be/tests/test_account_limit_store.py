"""The per-account sign-in limit kept in Redis (auth hardening plan,
workstream B): every worker sees the same count, keys hold only the email's
fingerprint, and a Redis outage never stops sign-in (B.4). Redis is faked;
verify-stack.sh checks the real one."""

import logging

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from sqlalchemy import select

from app.models.security import LoginLockout
from app.services import login_lockout
from app.core import redis_store
from tests.test_sessions import account, api, google, sign_in  # noqa: F401  (fixtures)
from tests.test_db_roles import roles_provisioned  # noqa: F401


@pytest.fixture(autouse=True)
def unbroken(monkeypatch):
    monkeypatch.setattr(redis_store, "_broken_until", 0.0)


class FakeRedis:
    """What login_lockout uses: GET, DEL, and INCR plus EXPIRE NX in a pipeline."""

    def __init__(self, shared: dict, down: bool = False):
        self.data, self.down, self.expiries, self.deleted = shared, down, {}, []

    def get(self, key):
        if self.down:
            raise RedisConnectionError("refused")
        return self.data.get(key)

    def delete(self, key):
        if self.down:
            raise RedisConnectionError("refused")
        self.deleted.append(key)
        return int(self.data.pop(key, None) is not None)

    def pipeline(self):
        store, ops = self, []

        class Pipe:
            def incr(self, key):
                def op():
                    store.data[key] = store.data.get(key, 0) + 1
                    return store.data[key]
                ops.append(op)

            def expire(self, key, seconds, nx=False):
                ops.append(lambda: store.expiries.setdefault(key, seconds) if nx else store.expiries.__setitem__(key, seconds))

            def execute(self):
                if store.down:
                    raise RedisConnectionError("refused")
                return [op() for op in ops]

        return Pipe()


def test_workers_share_one_count(api, db, monkeypatch):
    user = account(db)
    shared: dict = {}
    workers = [FakeRedis(shared), FakeRedis(shared)]
    statuses = []
    for i in range(11):
        monkeypatch.setattr(login_lockout, "counter_store", lambda w=workers[i % 2]: w)  # alternate workers
        statuses.append(sign_in(api, user, password="Wrong-Pass-1").status_code)
    assert statuses == [401] * 10 + [429]
    [key] = workers[0].expiries
    assert user.email not in key and key.startswith("development:rl:login-account:")
    assert workers[0].expiries[key] == login_lockout.ACCOUNT_WINDOW_SECONDS
    # The 10th failure locked the account and cleared the count.
    [lockout] = db.scalars(select(LoginLockout).where(LoginLockout.user_id == user.id))
    assert lockout.failures == 10 and key not in shared and key in workers[1].deleted + workers[0].deleted


def test_redis_down_never_stops_sign_in(api, db, monkeypatch, caplog):
    user = account(db)
    monkeypatch.setattr(login_lockout, "counter_store", lambda: FakeRedis({}, down=True))
    with caplog.at_level(logging.ERROR, logger="vertex"):
        assert sign_in(api, user, password="Wrong-Pass-1").status_code == 401
        assert sign_in(api, user).status_code == 200
    assert any(getattr(r, "event", None) == "ratelimit.store_unavailable" for r in caplog.records)


@pytest.mark.parametrize("url", [None])
def test_without_redis_each_process_counts_itself(url, monkeypatch):
    from app.core import redis_store

    monkeypatch.setattr(redis_store.settings, "REDIS_URL", url)
    assert redis_store.counter_store() is None


def test_a_hung_store_gives_up_within_the_deadline_then_rests(monkeypatch):
    import threading
    import time

    release = threading.Event()
    started = time.monotonic()
    with pytest.raises(redis_store.StoreUnavailable):
        redis_store.call(object(), lambda r: release.wait(5))
    assert time.monotonic() - started < 1.5
    tried = []
    with pytest.raises(redis_store.StoreUnavailable):
        redis_store.call(object(), lambda r: tried.append(1))  # resting: not even tried
    release.set()
    assert tried == []
    monkeypatch.setattr(redis_store, "_broken_until", 0.0)
    assert redis_store.call(object(), lambda r: "ok") == "ok"
