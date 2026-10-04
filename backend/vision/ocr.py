"""
OCR / Vision layer — pluggable, optional.
Only invoked when DOM text extraction is insufficient.
"""
from typing import Optional, Dict, Any, List

class OCRService:
    """Pluggable OCR interface. PaddleOCR used when available."""

    def __init__(self, enabled: bool = False):
        self.enabled = enabled
        self._engine = None

    async def initialize(self) -> bool:
        if not self.enabled:
            return False
        try:
            from paddleocr import PaddleOCR
            self._engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
            return True
        except ImportError:
            self.enabled = False
            return False

    async def extract_text(self, image_path: str) -> List[str]:
        if not self.enabled or not self._engine:
            return []
        try:
            result = self._engine.ocr(image_path, cls=True)
            texts = []
            for line in result:
                if line:
                    for word_info in line:
                        if word_info and len(word_info) >= 2:
                            texts.append(word_info[1][0])
            return texts
        except Exception:
            return []

    async def extract_from_screenshot(self, screenshot_bytes: bytes) -> List[str]:
        """Extract text from in-memory screenshot bytes."""
        if not self.enabled:
            return []
        import tempfile, os
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        try:
            tmp.write(screenshot_bytes)
            tmp.close()
            return await self.extract_text(tmp.name)
        finally:
            os.unlink(tmp.name)
