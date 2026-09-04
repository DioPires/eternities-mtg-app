"""Eternities data pipeline."""

from .contract.enums import CONTRACT_VERSION, PIPELINE_VERSION

__version__ = PIPELINE_VERSION

__all__ = ["CONTRACT_VERSION", "PIPELINE_VERSION", "__version__"]
