"""Lists services whose containers (running or not) are missing a configured network.

    docker compose ... config --format json | python verify_networks.py <project>

Prints one line per missing attachment: "<service> <container> <network>",
or nothing. Exists because Docker 24 / Compose 2.19 can leave a stale
endpoint behind in a network; Compose then fails to attach the recreated
container to it and carries on silently. For a service on an internal
network that breaks its published port or its route to the database.
"""

import json
import subprocess
import sys


def docker(*args: str) -> str:
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=True).stdout


def main() -> None:
    project = sys.argv[1]
    config = json.load(sys.stdin)
    names = {key: net["name"] for key, net in config.get("networks", {}).items()}
    missing = []
    for service, spec in config["services"].items():
        wanted = {names.get(key, f"{project}_{key}") for key in (spec.get("networks") or {"default": None})}
        containers = docker(
            "ps", "-aq",
            "--filter", f"label=com.docker.compose.project={project}",
            "--filter", f"label=com.docker.compose.service={service}",
        ).split()
        for container in containers:
            name = docker("inspect", "-f", "{{.Name}}", container).strip().lstrip("/")
            attached = set(json.loads(docker("inspect", "-f", "{{json .NetworkSettings.Networks}}", container)))
            missing += [f"{service} {name} {net}" for net in sorted(wanted - attached)]
    print("\n".join(missing))


if __name__ == "__main__":
    main()
