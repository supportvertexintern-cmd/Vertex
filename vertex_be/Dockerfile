FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# No compilers or headers in the image: psycopg2-binary ships its own
# libpq, and every other dependency is a wheel. (Trivy, Phase 12: the build
# toolchain carried most of the image's OS vulnerabilities.) Base packages
# get the distribution's current security fixes.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
# Install, then remove the installers: the app never runs pip, and pip's
# vendored copies (urllib3, msgpack) and setuptools were the image's last
# fixable findings (Trivy, Phase 12).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y setuptools wheel \
    && pip uninstall -y pip \
    && rm -rf /usr/local/lib/python3.11/ensurepip

COPY . /app

# Not root (E4): the remaining OS findings are local privilege escalations
# in tools the service never runs (mount, nsenter, ...); a non-root process
# can't use most of them anyway. The app writes nothing to disk.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin vertex
USER vertex

EXPOSE 8000

# Apply pending migrations, then serve.
# exec: uvicorn replaces the shell as PID 1, so it receives SIGTERM and shuts
# down cleanly on `docker stop` instead of being killed after the timeout.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log"]
