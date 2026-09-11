"""
Product Intelligence ML Concurrency & Worker Thread Pool Manager (Phase 4).

Guarantees:
1. Dedicated ThreadPoolExecutor with threads prefixed 'pi_ml_worker_'
2. Zero interference with FastAPI's main async event loop or default executor
3. Configurable Async Semaphore concurrency gate with timeouts
4. Telemetry metrics for thread usage, slot availability, and job latencies
5. 100% isolation from core FitMe pipelines (Body Scan, Try-On, Size Recommend, Auth)
"""
from __future__ import annotations

import asyncio
import functools
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Callable, Dict, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class MLConcurrencyManager:
    """Manages dedicated worker threads and concurrency limits for Product Intelligence ML."""

    def __init__(
        self,
        max_workers: Optional[int] = None,
        max_concurrent_scans: Optional[int] = None,
        scan_timeout_seconds: Optional[float] = None,
    ) -> None:
        self.max_workers = max_workers or int(os.getenv("PI_ML_MAX_WORKERS", "2"))
        self.max_concurrent_scans = max_concurrent_scans or int(os.getenv("PI_MAX_CONCURRENT_SCANS", "2"))
        self.scan_timeout_seconds = scan_timeout_seconds or float(os.getenv("PI_SCAN_TIMEOUT_SECONDS", "15.0"))

        # Dedicated ThreadPoolExecutor strictly for Product Intelligence ML operations
        self._executor = ThreadPoolExecutor(
            max_workers=self.max_workers,
            thread_name_prefix="pi_ml_worker_",
        )

        # Async Semaphore to gate concurrent ML visual search pipelines
        self._semaphore: Optional[asyncio.Semaphore] = None

        # Live telemetry counters
        self._active_worker_count = 0
        self._active_slots_in_use = 0
        self._total_jobs_processed = 0
        self._total_timeouts = 0
        self._total_errors = 0
        self._total_duration_ms = 0.0
        self._lock = threading.Lock()

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Lazily initialize semaphore within the active async event loop."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent_scans)
        return self._semaphore

    async def run_in_pool(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Offloads a synchronous, CPU-intensive ML/OpenCV function to the dedicated PI worker pool.

        Prevents Python GIL blocking on FastAPI's main async event loop.
        """
        loop = asyncio.get_running_loop()
        call_fn = functools.partial(func, *args, **kwargs)

        with self._lock:
            self._active_worker_count += 1

        t0 = time.time()
        try:
            result = await loop.run_in_executor(self._executor, call_fn)
            return result
        except Exception as exc:
            with self._lock:
                self._total_errors += 1
            logger.error("Error in PI ML worker execution: %s", exc)
            raise
        finally:
            dur_ms = (time.time() - t0) * 1000.0
            with self._lock:
                self._active_worker_count = max(0, self._active_worker_count - 1)
                self._total_jobs_processed += 1
                self._total_duration_ms += dur_ms

    # Alias for task execution
    run_ml_task = run_in_pool

    @asynccontextmanager
    async def acquire_ml_slot(self, timeout: Optional[float] = None) -> AsyncGenerator[None, None]:
        """Async context manager that gates entry to heavy ML pipelines using the semaphore.

        Guarantees bounded concurrency and prevents server resource exhaustion.
        """
        sem = self._get_semaphore()
        wait_timeout = timeout or self.scan_timeout_seconds

        try:
            await asyncio.wait_for(sem.acquire(), timeout=wait_timeout)
        except asyncio.TimeoutError:
            with self._lock:
                self._total_timeouts += 1
            logger.warning("PI ML slot acquisition timed out after %.2fs", wait_timeout)
            raise TimeoutError(f"Product Intelligence server is busy (timeout after {wait_timeout}s)")

        with self._lock:
            self._active_slots_in_use += 1

        try:
            yield
        finally:
            with self._lock:
                self._active_slots_in_use = max(0, self._active_slots_in_use - 1)
            sem.release()

    def get_metrics(self) -> Dict[str, Any]:
        """Returns real-time telemetry metrics for Product Intelligence ML workers."""
        with self._lock:
            avg_ms = (
                self._total_duration_ms / self._total_jobs_processed
                if self._total_jobs_processed > 0
                else 0.0
            )
            available_slots = (
                self.max_concurrent_scans - self._active_slots_in_use
                if self._semaphore is not None
                else self.max_concurrent_scans
            )
            return {
                "max_workers": self.max_workers,
                "max_concurrent_scans": self.max_concurrent_scans,
                "active_worker_threads": self._active_worker_count,
                "active_concurrency_slots": self._active_slots_in_use,
                "available_concurrency_slots": max(0, available_slots),
                "total_jobs_processed": self._total_jobs_processed,
                "total_timeouts": self._total_timeouts,
                "total_errors": self._total_errors,
                "avg_job_duration_ms": round(avg_ms, 2),
                "thread_prefix": "pi_ml_worker_",
            }

    def shutdown(self, wait: bool = True) -> None:
        """Cleanly shuts down the dedicated thread pool."""
        self._executor.shutdown(wait=wait)


# Singleton instance strictly for Product Intelligence
pi_ml_manager = MLConcurrencyManager()
