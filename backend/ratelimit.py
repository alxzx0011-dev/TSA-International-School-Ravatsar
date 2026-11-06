"""Small in-memory sliding-window rate limiter (per client IP)."""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


def _client_ip(request: Request) -> str:
    """Return the real client IP, including behind a reverse proxy.

    Production proxies must overwrite X-Forwarded-For (not append an
    untrusted client value) for this to be reliable.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first

    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    return request.client.host if request.client else "unknown"


def rate_limit(name: str, max_calls: int, window_seconds: int):
    hits: dict[str, deque] = defaultdict(deque)

    def dependency(request: Request) -> None:
        client = _client_ip(request)
        now = time.monotonic()
        queue = hits[client]

        while queue and now - queue[0] > window_seconds:
            queue.popleft()

        if len(queue) >= max_calls:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
            )

        queue.append(now)

    dependency.__name__ = f"rate_limit_{name}"
    return dependency
