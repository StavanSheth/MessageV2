from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple

class SourceAdapter(ABC):
    @abstractmethod
    async def open(self) -> bool:
        """Open or load the data source."""
        pass

    @abstractmethod
    async def validate_access(self) -> Tuple[bool, str]:
        """Validate if the source is accessible or requires authentication."""
        pass

    @abstractmethod
    async def read_records(self) -> List[Dict[str, Any]]:
        """Read and parse records from the source."""
        pass

    @abstractmethod
    async def update_record(self, record_id: str, data: Dict[str, Any]) -> bool:
        """Update a specific record in the source (write-back)."""
        pass

    @abstractmethod
    async def sync(self) -> Dict[str, Any]:
        """Synchronize changes between the source and local database."""
        pass

    @abstractmethod
    async def close(self) -> None:
        """Close any open connections or files."""
        pass
