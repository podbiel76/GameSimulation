import base64
import io
import os
import sys
import cv2
import torch
import numpy as np
from PIL import Image, ImageDraw
from fastapi import APIRouter
from pydantic import BaseModel

# ── Config ──────────────────────────────────────────────────────────

MODEL_PATH = os.environ.get(
    "YOLO_MODEL_PATH",
    r"C:\Users\patry\Downloads\best.engine",
)

PORT = int(os.environ.get("DETECT_PORT", "3002"))
CONF_THRESHOLD = float(os.environ.get("YOLO_CONF", "0.25"))

# stały rozmiar kafelka
TILE_W = 1590
TILE_H = 1045

# overlap między kafelkami
OVERLAP = 300

# im niżej tym mocniej usuwa nachodzące boxy
IOU_THRESHOLD = 0.05

# debug zapis kafelków
DEBUG_SAVE_TILES = True
DEBUG_DIR = "debug_tiles"

os.makedirs(DEBUG_DIR, exist_ok=True)

# ── Global model reference ──────────────────────────────────────────

model = None
router = APIRouter(tags=["detection"])


# ── YOLO Init ───────────────────────────────────────────────────────

def init_yolo():
    global model

    if model is not None:
        return

    print(f"🔍 Loading YOLO model from {MODEL_PATH} ...")

    _original_load = torch.load

    def _patched_load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return _original_load(*args, **kwargs)

    torch.load = _patched_load

    try:
        from ultralytics import YOLO

        model = YOLO(MODEL_PATH)

        dummy = np.zeros((1024, 1024, 3), dtype=np.uint8)

        model.predict(
            dummy,
            verbose=False,
            conf=CONF_THRESHOLD
        )

        print("✅ YOLO model loaded")
        print(f"✅ CUDA available: {torch.cuda.is_available()}")

    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        sys.exit(1)

    finally:
        torch.load = _original_load


# ── Utils ───────────────────────────────────────────────────────────

def iou(box1, box2):
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    inter = max(0, x2 - x1) * max(0, y2 - y1)

    area1 = max(0, box1[2] - box1[0]) * max(0, box1[3] - box1[1])
    area2 = max(0, box2[2] - box2[0]) * max(0, box2[3] - box2[1])

    union = area1 + area2 - inter

    if union <= 0:
        return 0

    return inter / union


def normalize_class_name(name: str) -> str:
    """
    Usuwa prefiksy typu:
    EN_
    PL_
    DE_
    FR_
    itd.

    dzięki temu:
    EN_Land_unit__Antitank_Antiarmor__Army
    Land_unit__Antitank_Antiarmor__Army

    będą traktowane jako ta sama klasa
    """

    prefixes = [
        "EN_",
        "PL_",
        "DE_",
        "FR_",
        "ES_",
        "IT_",
        "RU_",
        "UA_",
    ]

    for prefix in prefixes:
        if name.startswith(prefix):
            return name[len(prefix):]

    return name

def same_logical_class(name1: str, name2: str) -> bool:
    """
    Porównuje klasy po normalizacji nazw
    """

    return normalize_class_name(name1) == normalize_class_name(name2)

def nms_detections(detections, iou_threshold=0.05):
    """
    Zostawia tylko detekcję z najwyższym confidence,
    jeśli boxy nachodzą na siebie — niezależnie od klasy.
    """

    detections = sorted(
        detections,
        key=lambda d: d.confidence,
        reverse=True
    )

    kept = []

    while detections:
        best = detections.pop(0)
        kept.append(best)

        detections = [
            d for d in detections
            if iou(best.bbox, d.bbox) < iou_threshold
        ]

    return kept

def get_tile_positions(full_size, tile_size, overlap):
    step = tile_size - overlap

    if full_size <= tile_size:
        return [0]

    positions = list(range(
        0,
        max(1, full_size - tile_size + 1),
        step
    ))

    last_start = full_size - tile_size

    if positions[-1] != last_start:
        positions.append(last_start)

    return positions


# ── Request / Response Models ───────────────────────────────────────

class DetectRequest(BaseModel):
    image: str
    width: int = 0
    height: int = 0


class Detection(BaseModel):
    class_id: int
    class_name: str
    confidence: float
    bbox: list[float]
    center: list[float]


class DetectResponse(BaseModel):
    detections: list[Detection]
    inference_ms: float


# ── Endpoints ───────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None
    }

@router.post("/detect", response_model=DetectResponse)
async def detect(req: DetectRequest):
    import time
    t0 = time.perf_counter()

    if model is None:
        init_yolo()

    img_bytes = base64.b64decode(req.image)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

    # img_array = np.array(img)
    # img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    results = model.predict(
        img,
        verbose=False,
        conf=0.3,
        imgsz=640,
        device=0,
        iou=0.3,
    )

    detections = []

    result = results[0]

    if result.boxes is not None:
        boxes = result.boxes

        for i in range(len(boxes)):
            xyxy = boxes.xyxy[i].cpu().numpy().tolist()
            conf = float(boxes.conf[i].cpu().numpy())
            cls_id = int(boxes.cls[i].cpu().numpy())
            cls_name = model.names.get(cls_id, f"class_{cls_id}")

            cx = (xyxy[0] + xyxy[2]) / 2
            cy = (xyxy[1] + xyxy[3]) / 2

            detections.append(
                Detection(
                    class_id=cls_id,
                    class_name=cls_name,
                    confidence=round(conf, 4),
                    bbox=xyxy,
                    center=[cx, cy],
                )
            )

    detections = nms_detections(detections, IOU_THRESHOLD)

    elapsed = (time.perf_counter() - t0) * 1000

    return DetectResponse(
        detections=detections,
        inference_ms=round(elapsed, 1)
    )