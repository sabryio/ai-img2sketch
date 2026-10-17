"""Reusable oRPC-compatible Server-Sent Events primitives.

Drop this package into any FastAPI (or plain Starlette) application to get a
streaming response that speaks the ``@standard-server/fetch`` wire format
understood by the oRPC ``asyncIteratorObject`` frontend client.
"""

from .stream import CloseSentinel, ORPCSseError, ORPCSseStream, SseItem

__all__ = ["CloseSentinel", "ORPCSseError", "ORPCSseStream", "SseItem"]
