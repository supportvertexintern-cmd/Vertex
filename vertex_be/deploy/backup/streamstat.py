"""Pass a stream through unchanged while measuring it (Phase 11).

    ... | python streamstat.py <stats.json> [--tar] [--quiet] | ...

Writes {"bytes", "sha256"} for the whole stream to <stats.json>. With --tar
it also reads the stream as a tar archive and adds {"files", "file_bytes",
"tree_sha256", "names"}: the tree hash is the SHA-256 of the sorted
"<sha256>  <path>" lines, so the backup and a restore drill can compare
document sets without either side keeping plaintext on disk. With --quiet
nothing is passed through (verification only).
"""

from __future__ import annotations

import hashlib
import json
import sys
import tarfile


class Tee:
    """A file-like reader that hashes and forwards everything read."""

    def __init__(self, src, dst):
        self.src, self.dst = src, dst
        self.digest = hashlib.sha256()
        self.size = 0

    def read(self, n: int = -1) -> bytes:
        chunk = self.src.read(n)
        if chunk:
            self.digest.update(chunk)
            self.size += len(chunk)
            if self.dst is not None:
                self.dst.write(chunk)
        return chunk


def main() -> int:
    out_path = sys.argv[1]
    as_tar = "--tar" in sys.argv[2:]
    quiet = "--quiet" in sys.argv[2:]
    tee = Tee(sys.stdin.buffer, None if quiet else sys.stdout.buffer)
    stats: dict = {}
    if as_tar:
        lines, names, file_bytes = [], [], 0
        with tarfile.open(fileobj=tee, mode="r|") as archive:
            for member in archive:
                if not member.isfile():
                    continue
                f = archive.extractfile(member)
                h = hashlib.sha256()
                for block in iter(lambda: f.read(1 << 16), b""):
                    h.update(block)
                name = member.name.removeprefix("./")
                names.append(name)
                file_bytes += member.size
                lines.append(f"{h.hexdigest()}  {name}")
        stats.update(
            files=len(names),
            file_bytes=file_bytes,
            tree_sha256=hashlib.sha256("\n".join(sorted(lines)).encode()).hexdigest(),
            names=sorted(names),
        )
    # Drain whatever follows (tar padding, or the whole stream if not a tar).
    while tee.read(1 << 16):
        pass
    if not quiet:
        sys.stdout.buffer.flush()
    stats.update(bytes=tee.size, sha256=tee.digest.hexdigest())
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(stats, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
