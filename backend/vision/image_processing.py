"""
Image preprocessing utilities for OCR.
Only executed when DOM extraction is insufficient.
"""
from typing import Optional

class ImageProcessor:
    @staticmethod
    def preprocess_for_ocr(image_path: str, output_path: Optional[str] = None) -> Optional[str]:
        """Apply OpenCV preprocessing to improve OCR accuracy."""
        try:
            import cv2
            import numpy as np
            img = cv2.imread(image_path)
            if img is None:
                return None
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            out = output_path or image_path.replace(".png", "_processed.png")
            cv2.imwrite(out, threshold)
            return out
        except ImportError:
            return image_path
        except Exception:
            return None
