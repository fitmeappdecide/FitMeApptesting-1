import time
import logging

logger = logging.getLogger("fitme.telemetry")

class TelemetryTimer:
    """Non-blocking high-precision performance timer for Phase 0 latency audit.
    Measures exact execution milestones without altering application behavior.
    """
    def __init__(self, trace_name: str):
        self.trace_name = trace_name
        self.start_time = 0.0
        self.milestones = []

    def __enter__(self):
        self.start_time = time.perf_counter()
        print(f"⏱️ [TELEMETRY START] {self.trace_name} @ T+0.0000s")
        return self

    def mark(self, milestone_name: str):
        now = time.perf_counter()
        elapsed = now - self.start_time
        self.milestones.append((milestone_name, elapsed))
        print(f"⏱️ [TELEMETRY MARK] {self.trace_name} -> {milestone_name}: T+{elapsed:.4f}s")

    def __exit__(self, exc_type, exc_val, exc_tb):
        total_elapsed = time.perf_counter() - self.start_time
        print(f"⏱️ [TELEMETRY END] {self.trace_name} TOTAL: {total_elapsed:.4f}s")
