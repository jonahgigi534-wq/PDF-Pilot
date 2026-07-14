"""PDFPilot OCR sidecar.

Long-running worker speaking JSON-lines over stdin/stdout:
  request:  {"id": 1, "op": "ocr", "image": "C:/path/page.png"}
  response: {"id": 1, "ok": true, "width": W, "height": H,
             "lines": [{"text": str, "box": [[x,y]*4], "score": float}]}
  request:  {"id": 2, "op": "ping"}   -> {"id": 2, "ok": true, "engine": "..."}

Pipeline: OpenCV preprocessing (grayscale, denoise, deskew, upscale) then
RapidOCR (PaddleOCR PP-OCR models running on ONNX Runtime). Returned boxes
are mapped back to the original image's coordinate space.
"""
import json
import sys
import traceback

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

_engine = None


def engine():
    global _engine
    if _engine is None:
        _engine = RapidOCR()
    return _engine


def estimate_skew_angle(gray):
    """Estimates document skew in degrees from near-horizontal text lines."""
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 15
    )
    # Join characters into line-shaped blobs.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
    joined = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    angles = []
    for c in contours:
        (w_, h_) = cv2.minAreaRect(c)[1]
        if min(w_, h_) < 8 or max(w_, h_) < 60:
            continue
        angle = cv2.minAreaRect(c)[2]
        if angle > 45:
            angle -= 90
        if abs(angle) <= 15:  # only correct plausible document skew
            angles.append(angle)
    if len(angles) < 3:
        return 0.0
    return float(np.median(angles))


def preprocess(img):
    """Returns (processed_bgr, transform) where transform maps processed
    coordinates back to original coordinates: x' = (M_inv @ [x, y, 1])."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img

    gray = cv2.fastNlMeansDenoising(gray, None, h=7, templateWindowSize=7, searchWindowSize=21)

    angle = estimate_skew_angle(gray)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    if abs(angle) > 0.15:
        gray = cv2.warpAffine(
            gray, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )

    scale = 1.0
    if max(w, h) < 1500:  # upscale low-resolution scans
        scale = 1500.0 / max(w, h)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    # Full affine from original -> processed: rotate then scale.
    A = np.vstack([M, [0, 0, 1]])
    S = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]], dtype=np.float64)
    forward = S @ A
    inverse = np.linalg.inv(forward)

    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR), inverse


def map_box(box, inverse):
    out = []
    for x, y in box:
        p = inverse @ np.array([x, y, 1.0])
        out.append([round(float(p[0]), 2), round(float(p[1]), 2)])
    return out


def run_ocr(image_path):
    data = np.fromfile(image_path, dtype=np.uint8)  # np.fromfile handles Windows paths
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"could not read image: {image_path}")
    h, w = img.shape[:2]

    processed, inverse = preprocess(img)
    result, _ = engine()(processed)

    lines = []
    if result:
        for box, text, score in result:
            if not text or float(score) < 0.35:
                continue
            lines.append({
                "text": text,
                "box": map_box(box, inverse),
                "score": round(float(score), 3),
            })
    return {"width": w, "height": h, "lines": lines}


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            if req.get("op") == "ping":
                resp = {"id": req.get("id"), "ok": True, "engine": "rapidocr-onnxruntime"}
            elif req.get("op") == "ocr":
                resp = {"id": req.get("id"), "ok": True, **run_ocr(req["image"])}
            else:
                resp = {"id": req.get("id"), "ok": False, "error": f"unknown op {req.get('op')!r}"}
        except Exception as e:  # report, keep serving
            resp = {
                "id": req.get("id") if isinstance(req, dict) else None,
                "ok": False,
                "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc(limit=3),
            }
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
