"""
Hardware capability detector.
Doc 1 §11: On startup, detect NVIDIA GPU & VRAM via NVML.
If VRAM >= 2 GB, expose SINGLE_BROWSER and MULTI_BROWSER modes.
Otherwise, enforce SINGLE_BROWSER only.
"""
import shutil
import subprocess
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

def detect_gpu_capabilities() -> Dict[str, Any]:
    gpu_name = None
    vram_mb = 0
    has_nvidia = False

    # Check via pynvml if installed
    try:
        import pynvml
        pynvml.nvmlInit()
        device_count = pynvml.nvmlDeviceGetCount()
        if device_count > 0:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle)
            gpu_name = name.decode("utf-8") if isinstance(name, bytes) else str(name)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_mb = int(mem_info.total / (1024 * 1024))
            has_nvidia = True
        pynvml.nvmlShutdown()
    except Exception:
        # Fallback to nvidia-smi if binary exists
        if shutil.which("nvidia-smi"):
            try:
                res = subprocess.run(
                    ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                    capture_output=True,
                    text=True,
                    timeout=2
                )
                if res.returncode == 0 and res.stdout.strip():
                    parts = res.stdout.strip().split("\n")[0].split(",")
                    if len(parts) >= 2:
                        gpu_name = parts[0].strip()
                        vram_mb = int(float(parts[1].strip()))
                        has_nvidia = True
            except Exception:
                pass

    supported_modes = ["SINGLE_BROWSER"]
    # If VRAM >= 2000 MB (~2 GB), allow MULTI_BROWSER
    if has_nvidia and vram_mb >= 2000:
        supported_modes.append("MULTI_BROWSER")
        recommended_mode = "MULTI_BROWSER"
    else:
        recommended_mode = "SINGLE_BROWSER"

    return {
        "has_nvidia_gpu": has_nvidia,
        "gpu_name": gpu_name,
        "vram_mb": vram_mb,
        "supported_modes": supported_modes,
        "recommended_mode": recommended_mode,
        "enforce_single_browser": len(supported_modes) == 1
    }
