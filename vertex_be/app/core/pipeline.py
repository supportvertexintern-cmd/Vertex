"""The candidate pipeline's switch (docs/architecture/pipeline-handover.md):
FastAPI's pipeline write endpoints are built group by group (steps 6.2-6.6)
but refuse every request until the switch (step 6.7) sets
PIPELINE_WRITES_ENABLED. Until then the website writes the pipeline, so
nothing (the staff app included) can write through FastAPI early.

Rolling the switch back needs no code change: turn the setting off and
restore vertex_web's grants.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.core.api import ApiError
from app.core.config import settings


def pipeline_writes_enabled() -> None:
    if not settings.PIPELINE_WRITES_ENABLED:
        raise ApiError(503, "pipeline_not_enabled", "The candidate pipeline is still served by the website.")


# Add to every pipeline write route: `_on: PipelineWrites`.
PipelineWrites = Annotated[None, Depends(pipeline_writes_enabled)]
