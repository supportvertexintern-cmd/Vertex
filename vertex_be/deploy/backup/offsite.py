"""Off-site backup copy (E5, docs/security/backup-recovery.md §9).

    python offsite.py push <backup-dir>            after each backup (writer credentials)
    python offsite.py prune <project> [--apply]    weekly (admin credentials)
    python offsite.py fetch <project> <stamp|latest> <dest-dir>   restore test (admin)
    python offsite.py check-writer                 proves the writer can't list, read or delete
    python offsite.py status

The backups are already encrypted on this PC (gpg AES-256, backup.sh), so
the provider only ever stores ciphertext. Any S3-compatible bucket works
(AWS S3, Backblaze B2, Wasabi...) with versioning and Object Lock on, and a
default retention, so neither a stolen writer key nor ransomware on this PC
can erase a copy before its retention ends.

Two credentials, both DPAPI-protected (offsite-creds.ps1):
  writer  every backup; PutObject only.
  admin   prune and restore tests; list, read, delete.

Non-secret settings come from $OFFSITE_CONF (default
D:/VertexData/backup-keys/offsite.conf), KEY=VALUE lines:
  OFFSITE_BUCKET    required
  OFFSITE_ENDPOINT  empty for AWS; e.g. https://s3.eu-central-003.backblazeb2.com
  OFFSITE_REGION    default us-east-1
  OFFSITE_PREFIX    default vertex
  OFFSITE_DOCKER_NETWORK  optional, for a bucket reachable only on a Docker network (tests)

The AWS CLI runs in a pinned container; credentials reach it through the
environment, never a command line. The time of the newest successful push
per project is kept in $BACKUP_ROOT/offsite-state/<project>.json for the
health check.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
AWS_IMAGE = "amazon/aws-cli:2.27.0"
ROOT = Path(os.environ.get("BACKUP_ROOT", "D:/VertexData/backups"))
CONF = Path(os.environ.get("OFFSITE_CONF", "D:/VertexData/backup-keys/offsite.conf"))
FILES = ["db.dump.gpg", "documents.tar.gpg", "manifest.json"]  # manifest last: it marks a complete copy

_spec = importlib.util.spec_from_file_location("prune", HERE / "prune.py")
prune = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prune)


def log(msg: str) -> None:
    print(f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ} offsite {msg}", flush=True)


def config() -> dict[str, str]:
    if not CONF.exists():
        raise SystemExit(f"off-site not configured: {CONF} missing (see backup-recovery.md §9)")
    conf = {"OFFSITE_REGION": "us-east-1", "OFFSITE_PREFIX": "vertex", "OFFSITE_ENDPOINT": "", "OFFSITE_DOCKER_NETWORK": ""}
    for line in CONF.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            conf[k.strip()] = v.strip()
    if not conf.get("OFFSITE_BUCKET"):
        raise SystemExit("OFFSITE_BUCKET is not set in " + str(CONF))
    return conf


def credentials(role: str) -> tuple[str, str]:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERE / "offsite-creds.ps1"), "get", role],
        capture_output=True, text=True,
    )
    if out.returncode != 0 or "\n" not in out.stdout:
        raise SystemExit(f"no {role} credentials: run offsite-creds.ps1 set {role}")
    key_id, secret = out.stdout.split("\n", 1)
    return key_id.strip(), secret.strip()


def aws(conf: dict[str, str], role: str, args: list[str], mounts: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess:
    key_id, secret = credentials(role)
    env = {**os.environ, "AWS_ACCESS_KEY_ID": key_id, "AWS_SECRET_ACCESS_KEY": secret, "MSYS_NO_PATHCONV": "1"}
    cmd = ["docker", "run", "--rm", "-e", "AWS_ACCESS_KEY_ID", "-e", "AWS_SECRET_ACCESS_KEY", "-e", f"AWS_DEFAULT_REGION={conf['OFFSITE_REGION']}"]
    if conf["OFFSITE_DOCKER_NETWORK"]:
        cmd += ["--network", conf["OFFSITE_DOCKER_NETWORK"]]
    for host, inside in (mounts or {}).items():
        cmd += ["-v", f"{host}:{inside}"]
    cmd.append(AWS_IMAGE)
    if conf["OFFSITE_ENDPOINT"]:
        cmd += ["--endpoint-url", conf["OFFSITE_ENDPOINT"]]
    out = subprocess.run(cmd + args, capture_output=True, text=True, env=env)
    if check and out.returncode != 0:
        raise SystemExit(f"aws {' '.join(args[:2])} failed: {out.stderr.strip()[-400:]}")
    return out


def base(conf: dict[str, str], project: str) -> str:
    return f"{conf['OFFSITE_PREFIX']}/{project}"


def push(backup_dir: str) -> int:
    conf = config()
    d = Path(backup_dir)
    project, stamp = d.parent.name, d.name
    if prune.parse(stamp) is None or not (d / "manifest.json").exists():
        raise SystemExit(f"not a complete backup: {d}")
    host = str(d.resolve()).replace("\\", "/")
    for name in FILES:
        if not (d / name).exists():
            continue
        key = f"{base(conf, project)}/{stamp}/{name}"
        # SHA-256 checksum: the provider verifies the upload, and Object Lock
        # buckets require a checksum on every write.
        aws(conf, "writer", ["s3", "cp", "--only-show-errors", "--checksum-algorithm", "SHA256", f"/b/{name}", f"s3://{conf['OFFSITE_BUCKET']}/{key}"], {host: "/b:ro"})
    state = ROOT / "offsite-state"
    state.mkdir(parents=True, exist_ok=True)
    (state / f"{project}.json").write_text(json.dumps({"project": project, "stamp": stamp, "pushed_at": datetime.now(UTC).isoformat()}))
    log(f"pushed {project}/{stamp} to s3://{conf['OFFSITE_BUCKET']}/{base(conf, project)}/")
    return 0


def listing(conf: dict[str, str], project: str) -> dict[str, set[str]]:
    out = aws(conf, "admin", ["s3api", "list-objects-v2", "--bucket", conf["OFFSITE_BUCKET"], "--prefix", base(conf, project) + "/", "--output", "json"])
    stamps: dict[str, set[str]] = defaultdict(set)
    for obj in (json.loads(out.stdout or "{}").get("Contents") or []):
        parts = obj["Key"].split("/")
        if len(parts) >= 2:
            stamps[parts[-2]].add(parts[-1])
    return stamps


def complete_stamps(conf: dict[str, str], project: str) -> list[str]:
    return sorted(s for s, files in listing(conf, project).items() if "manifest.json" in files and prune.parse(s))


def prune_remote(project: str, apply: bool) -> int:
    conf = config()
    now = datetime.now(UTC)
    stamps = listing(conf, project)
    complete = {prune.parse(s): s for s, f in stamps.items() if prune.parse(s) and "manifest.json" in f}
    kept = prune.keep_offsite(list(complete), now)
    doomed = [s for t, s in complete.items() if t not in kept]
    doomed += [s for s, f in stamps.items() if prune.parse(s) and "manifest.json" not in f and now - prune.parse(s) > timedelta(days=1)]
    log(f"{project}: {len(complete)} complete copies, keeping {len(kept)}, {len(doomed)} to delete")
    locked = 0
    for stamp in sorted(doomed):
        if not apply:
            print("would delete", stamp)
            continue
        out = aws(conf, "admin", ["s3api", "list-object-versions", "--bucket", conf["OFFSITE_BUCKET"], "--prefix", f"{base(conf, project)}/{stamp}/", "--output", "json"])
        data = json.loads(out.stdout or "{}")
        versions = [{"Key": v["Key"], "VersionId": v["VersionId"]} for v in (data.get("Versions") or []) + (data.get("DeleteMarkers") or [])]
        if not versions:
            continue
        res = aws(conf, "admin", ["s3api", "delete-objects", "--bucket", conf["OFFSITE_BUCKET"], "--delete", json.dumps({"Objects": versions, "Quiet": True}), "--output", "json"], check=False)
        errors = (json.loads(res.stdout or "{}").get("Errors") or []) if res.returncode == 0 else versions
        if errors:
            locked += 1
            print(f"kept {stamp}: still under Object Lock retention ({len(errors)} object versions)")
        else:
            print("deleted", stamp)
    if locked:
        log(f"{project}: {locked} copies are past the policy but still locked; a later run deletes them")
    return 0


def fetch(project: str, which: str, dest: str) -> int:
    conf = config()
    stamps = complete_stamps(conf, project)
    if not stamps:
        raise SystemExit(f"no complete off-site copy for {project}")
    stamp = stamps[-1] if which == "latest" else which
    if stamp not in stamps:
        raise SystemExit(f"no complete off-site copy {project}/{stamp}")
    target = Path(dest) / project / stamp
    target.mkdir(parents=True, exist_ok=True)
    host = str(target.resolve()).replace("\\", "/")
    aws(conf, "admin", ["s3", "cp", "--only-show-errors", "--recursive", f"s3://{conf['OFFSITE_BUCKET']}/{base(conf, project)}/{stamp}/", "/d/"], {host: "/d"})
    print(target.as_posix())
    return 0


def check_writer() -> int:
    """The writer must be able to add objects and nothing else."""
    conf = config()
    key = f"{conf['OFFSITE_PREFIX']}/_probe/{datetime.now(UTC):%Y%m%dT%H%M%SZ}.txt"
    results = {}
    tmp = ROOT / "offsite-state"
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "probe.txt").write_text("write-only probe\n")
    mount = {str(tmp.resolve()).replace("\\", "/"): "/p:ro"}
    b = conf["OFFSITE_BUCKET"]
    results["put"] = aws(conf, "writer", ["s3", "cp", "--checksum-algorithm", "SHA256", "/p/probe.txt", f"s3://{b}/{key}"], mount, check=False).returncode == 0
    results["list"] = aws(conf, "writer", ["s3api", "list-objects-v2", "--bucket", b, "--max-items", "1"], check=False).returncode == 0
    results["get"] = aws(conf, "writer", ["s3api", "get-object", "--bucket", b, "--key", key, "/tmp/x"], check=False).returncode == 0
    results["delete"] = aws(conf, "writer", ["s3api", "delete-object", "--bucket", b, "--key", key], check=False).returncode == 0
    expected = {"put": True, "list": False, "get": False, "delete": False}
    for op, ok in results.items():
        print(f"writer {op}: {'allowed' if ok else 'denied'} ({'ok' if ok == expected[op] else 'WRONG'})")
    return 0 if results == expected else 1


def status() -> int:
    conf = config()
    print(f"bucket: {conf['OFFSITE_BUCKET']}  endpoint: {conf['OFFSITE_ENDPOINT'] or 'AWS'}  prefix: {conf['OFFSITE_PREFIX']}")
    for f in sorted((ROOT / "offsite-state").glob("vertex-*.json")):
        s = json.loads(f.read_text())
        age = datetime.now(UTC) - datetime.fromisoformat(s["pushed_at"])
        print(f"{s['project']}: newest push {s['stamp']}, {age.total_seconds() / 3600:.1f} h ago")
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd, args = argv[0], argv[1:]
    if cmd == "push" and len(args) == 1:
        return push(args[0])
    if cmd == "prune" and args:
        return prune_remote(args[0], "--apply" in args[1:])
    if cmd == "fetch" and len(args) == 3:
        return fetch(*args)
    if cmd == "check-writer":
        return check_writer()
    if cmd == "status":
        return status()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
