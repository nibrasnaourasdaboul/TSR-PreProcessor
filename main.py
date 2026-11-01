"""
TSR-PreProcessor & Autonomous Simulator — API Backend (FastAPI + OpenCV)

المراحل (Pipeline):
  1) CLAHE على قناة V (HSV)        → تحسين الإضاءة في الصور المظلمة
  2) قناع اللون الأحمر (HSV x2)    → عزل الشاخصات الحمراء
  3) bitwise_and + Bounding Box    → الشاخصة المعزولة الجاهزة لنموذج YOLO

التشغيل:  uvicorn main:app --reload --port 8000
ثم افتح:  http://localhost:8000   (الخادم يقدّم الواجهة أيضاً)
"""
import base64
import os

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(
    title="TSR-PreProcessor API",
    description="Smart Preprocessing Pipeline for Traffic Signs (CLAHE + HSV Masking)",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

CLIP_LIMIT = 3.0
TILE_GRID = (8, 8)


class SimulationRequest(BaseModel):
    object_type: str
    object_name: str = ""


REACTIONS = {
    "stop_sign":     {"speed": 0,  "action": "FULL_STOP",          "message_ar": "توقف كامل طارئ"},
    "speed_limit":   {"speed": 30, "action": "SLOW_DOWN",          "message_ar": "تخفيض السرعة إلى 30 كم/سا"},
    "pass_right":    {"speed": 50, "action": "LANE_SHIFT_RIGHT",   "message_ar": "الانحراف لليمين"},
    "cone":          {"speed": 25, "action": "AVOID_OBSTACLE",     "message_ar": "مناورة تفادي القمع"},
    "traffic_light": {"speed": 0,  "action": "WAIT_RED_LIGHT",     "message_ar": "توقف عند الإشارة الحمراء"},
    "pedestrian":    {"speed": 0,  "action": "PEDESTRIAN_STOP",    "message_ar": "فرملة طوارئ لحماية المشاة"},
    "zebra":         {"speed": 20, "action": "APPROACH_CROSSWALK", "message_ar": "الاستعداد للتوقف عند ممر المشاة"},
    "vehicle":       {"speed": 40, "action": "MAINTAIN_DISTANCE",  "message_ar": "الحفاظ على مسافة الأمان"},
}


def run_pipeline(img_bgr: np.ndarray) -> dict:
    """ينفّذ مراحل OpenCV ويعيد الصور الوسيطة (BGR) + الإحصاءات."""
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    # --- Stage 1: CLAHE ---
    clahe = cv2.createCLAHE(clipLimit=CLIP_LIMIT, tileGridSize=TILE_GRID)
    hsv_enh = cv2.merge((h, s, clahe.apply(v)))
    bgr_enh = cv2.cvtColor(hsv_enh, cv2.COLOR_HSV2BGR)

    # --- Stage 2: Red segmentation (الأحمر يلتف حول 0/180 في HSV) ---
    m1 = cv2.inRange(hsv_enh, np.array([0, 100, 100]), np.array([10, 255, 255]))
    m2 = cv2.inRange(hsv_enh, np.array([170, 100, 100]), np.array([180, 255, 255]))
    mask = cv2.bitwise_or(m1, m2)

    # --- Stage 3: isolation + bounding box ---
    isolated = cv2.bitwise_and(bgr_enh, bgr_enh, mask=mask)
    count = int(cv2.countNonZero(mask))
    bbox = None
    if count > 30:
        x, y, bw, bh = cv2.boundingRect(cv2.findNonZero(mask))
        bbox = {"x": int(x), "y": int(y), "w": int(bw), "h": int(bh)}

    return {"enhanced": bgr_enh, "mask": mask, "isolated": isolated,
            "mask_pixels": count, "bbox": bbox}


def _b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


@app.get("/api/health")
async def health():
    return {"status": "ok", "opencv": cv2.__version__}


@app.post("/api/process-object")
async def process_object(payload: SimulationRequest):
    """يستقبل نوع العنصر المسقط في المدينة ويعيد رد فعل المركبة."""
    result = REACTIONS.get(payload.object_type,
                           {"speed": 50, "action": "CRUISE", "message_ar": "المتابعة بحذر"})
    return {"status": "success", "detected_object": payload.object_name, "telemetry": result}


@app.post("/api/preprocess-frame")
async def preprocess_frame(file: UploadFile = File(...)):
    """يستقبل إطاراً (PNG/JPG) ويعيد مراحل المعالجة كصور Base64."""
    try:
        data = await file.read()
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        out = run_pipeline(img)
        return {
            "status": "success",
            "clahe_applied": True,
            "mask_pixels": out["mask_pixels"],
            "bbox": out["bbox"],
            "stages": {
                "clahe": _b64(out["enhanced"]),
                "mask": _b64(out["mask"]),
                "isolated": _b64(out["isolated"]),
            },
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


# تقديم الواجهة من نفس الخادم (يجب أن يكون آخر تعريف)
_ROOT = os.path.dirname(os.path.abspath(__file__))
app.mount("/", StaticFiles(directory=_ROOT, html=True), name="frontend")
