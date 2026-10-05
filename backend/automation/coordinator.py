import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class DMCoordinator:
    """
    Coordinates execution between Worker 1 (Cold DMs) and Worker 3 (Follow-Ups).
    
    CRITICAL INVARIANT:
    At any given millisecond, only ONE worker (Worker 1 OR Worker 3) can hold the
    DM sending lock (DM_SEND_MUTEX) to prevent Instagram action blocks from concurrent typing.
    Worker 2 (Inbox Reviewer) runs concurrently on Tab B and does not require this lock.
    """
    def __init__(self):
        self._lock = asyncio.Lock()
        self.active_sender: Optional[str] = None  # "WORKER-01", "WORKER-03", or None
        self.mode: str = "BALANCED"  # "MANUAL", "COLD_ONLY", "FOLLOWUP_ONLY", "BALANCED"
        self.lock_acquired_at: Optional[datetime] = None

    async def acquire_dm_lock(self, worker_id: str) -> bool:
        """
        Request the DM sending lock for a worker.
        If the other worker is currently holding the lock, pause it gracefully first.
        """
        if self.active_sender == worker_id:
            return True

        if self.active_sender and self.active_sender != worker_id:
            logger.info(f"[Coordinator] Worker {worker_id} requested DM lock, currently held by {self.active_sender}. Preempting active worker...")
            await self._preempt_worker(self.active_sender)

        self.active_sender = worker_id
        self.lock_acquired_at = datetime.now(timezone.utc)
        logger.info(f"[Coordinator] DM Lock granted to {worker_id} (mode={self.mode})")
        return True

    async def release_dm_lock(self, worker_id: str) -> None:
        """Release the lock when worker idles or stops."""
        if self.active_sender == worker_id:
            logger.info(f"[Coordinator] DM Lock released by {worker_id}")
            self.active_sender = None
            self.lock_acquired_at = None

    async def _preempt_worker(self, worker_id: str) -> None:
        """Pause the currently sending worker safely so the requested worker can take over."""
        try:
            if worker_id == "WORKER-01":
                from backend.workers.instagram_worker import instagram_worker
                if instagram_worker.is_running and not instagram_worker.is_paused:
                    await instagram_worker.pause()
            elif worker_id == "WORKER-03":
                from backend.workers.followup_worker import followup_worker
                if followup_worker.is_running and not followup_worker.is_paused:
                    await followup_worker.pause()
        except Exception as e:
            logger.warning(f"[Coordinator] Error preempting {worker_id}: {e}")

    def get_status(self) -> Dict[str, Any]:
        return {
            "active_sender": self.active_sender,
            "mode": self.mode,
            "lock_held": self.active_sender is not None,
            "lock_acquired_at": self.lock_acquired_at.isoformat() if self.lock_acquired_at else None
        }

coordinator = DMCoordinator()
