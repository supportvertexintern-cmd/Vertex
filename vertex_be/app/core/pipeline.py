"""The candidate pipeline's switch (docs/architecture/pipeline-handover.md):
FastAPI's pipeline write endpoints were built group by group (steps 6.2-
6.6) and serve since the switch (step 6.7), with PIPELINE_WRITES_ENABLED
on by default.

The setting stays as a way to stop pipeline writes with no code change:
while it's off every one answers 503. It's no longer a rollback: the website
has no database access since reads handover R8.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.core.api import ApiError
from app.core.config import settings


def pipeline_writes_enabled() -> None:
    if not settings.PIPELINE_WRITES_ENABLED:
        raise ApiError(503, "pipeline_not_enabled", "The candidate pipeline is switched off. Please try again later.")


# Add to every pipeline write route: `_on: PipelineWrites`.
PipelineWrites = Annotated[None, Depends(pipeline_writes_enabled)]
