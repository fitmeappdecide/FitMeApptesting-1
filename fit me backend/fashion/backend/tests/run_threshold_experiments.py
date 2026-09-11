"""
Experimental Threshold and Geometry Evaluation Runner for Phase 2.

Evaluates person detection, occupancy ratios, smart cropping behavior, and latency
across a multi-dimensional matrix of scales, positions, and aspect ratios.
"""
import os
import sys
import io
import time
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.preprocessing.person_detector import PersonBox, detector
from app.services.preprocessing.smart_crop import calculate_smart_crop_box, apply_smart_crop
from app.services.preprocessing.vton_preprocessor import preprocess_user_image


def run_experiments():
    print("=" * 80)
    print("FITME PHASE 2: EXPERIMENTAL EVALUATION & THRESHOLD ANALYSIS")
    print("=" * 80)

    ui_assets = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../fitme-ui/assets/images"))
    real_photo_path = os.path.join(ui_assets, "fullphoto.png")
    
    if not os.path.exists(real_photo_path):
        print(f"Error: Asset not found at {real_photo_path}")
        return

    person_src = Image.open(real_photo_path).convert("RGBA")
    print(f"Base Person Asset: fullphoto.png ({person_src.size[0]}x{person_src.size[1]})")
    print()

    # ------------------------------------------------------------------------
    # EXPERIMENT 1: Scale Variation Sweep (Center Position on 1920x1080 canvas)
    # ------------------------------------------------------------------------
    print("1. SCALE VARIATION SWEEP (1920x1080 Landscape Canvas)")
    print(f"{'Target Scale':<12} | {'Detected Occ':<14} | {'Crop (Thresh=50%)':<18} | {'Output Dims':<14} | {'Latency':<10}")
    print("-" * 75)

    scales = [0.90, 0.80, 0.70, 0.60, 0.50, 0.40, 0.30, 0.20]
    scale_results = []

    for scale in scales:
        target_h = int(1080 * scale)
        scale_factor = target_h / person_src.height
        target_w = int(person_src.width * scale_factor)
        scaled_person = person_src.resize((target_w, target_h), Image.Resampling.LANCZOS)
        
        bg = Image.new("RGBA", (1920, 1080), (225, 230, 235, 255))
        paste_x = (1920 - target_w) // 2
        paste_y = (1080 - target_h) // 2
        bg.paste(scaled_person, (paste_x, paste_y), scaled_person)
        
        bio = io.BytesIO()
        bg.convert("RGB").save(bio, format="JPEG", quality=95)
        img_bytes = bio.getvalue()
        
        res_bytes, report = preprocess_user_image(img_bytes, occupancy_threshold=0.50)
        scale_results.append((scale, report))
        
        print(
            f"{scale*100:>9.0f}%   | {report.occupancy_ratio*100:>10.1f}%   | "
            f"{str(report.crop_applied):<18} | {str(report.prepared_dimensions):<14} | "
            f"{report.total_time_ms:>6.1f}ms"
        )
    print()

    # ------------------------------------------------------------------------
    # EXPERIMENT 2: Spatial Position Variations (Scale = 35% in 1920x1080)
    # ------------------------------------------------------------------------
    print("2. SPATIAL POSITION VARIATIONS (Person Height = 35% of Frame)")
    print(f"{'Position':<15} | {'Person Placed At':<22} | {'Crop Box (px)':<25} | {'Person Centered?':<16}")
    print("-" * 80)

    positions = [
        ("Left Edge", 50, 350),
        ("Left-Center", 450, 350),
        ("Center", (1920 - 280) // 2, 350),
        ("Right-Center", 1150, 350),
        ("Right Edge", 1920 - 50 - 280, 350),
        ("Top-Center", (1920 - 280) // 2, 30),
        ("Bottom-Center", (1920 - 280) // 2, 1080 - 378 - 30),
    ]

    target_h = int(1080 * 0.35)
    scale_factor = target_h / person_src.height
    target_w = int(person_src.width * scale_factor)
    scaled_person = person_src.resize((target_w, target_h), Image.Resampling.LANCZOS)

    for pos_name, px, py in positions:
        bg = Image.new("RGBA", (1920, 1080), (225, 230, 235, 255))
        bg.paste(scaled_person, (px, py), scaled_person)
        
        bio = io.BytesIO()
        bg.convert("RGB").save(bio, format="JPEG", quality=95)
        img_bytes = bio.getvalue()
        
        res_bytes, report = preprocess_user_image(img_bytes, occupancy_threshold=0.50)
        cb = report.crop_box
        cb_str = f"[{cb[0]},{cb[1]} x {cb[2]},{cb[3]}]" if cb else "No Crop"
        
        # Verify person is encompassed and horizontally centered in crop
        if cb:
            crop_cx = (cb[0] + cb[2]) / 2.0
            person_cx = px + target_w / 2.0
            centered = abs(crop_cx - person_cx) < 35
        else:
            centered = False
            
        print(
            f"{pos_name:<15} | x=[{px:>4},{px+target_w:>4}], y={py:>4} | {cb_str:<25} | "
            f"{'YES (Aligned)' if centered else 'NO'}"
        )
    print()

    # ------------------------------------------------------------------------
    # EXPERIMENT 3: Aspect Ratio Robustness (Square, 4:3, 16:9, 3:4)
    # ------------------------------------------------------------------------
    print("3. ASPECT RATIO MATRIX")
    print(f"{'Canvas Ratio':<15} | {'Dimensions':<14} | {'Person Occ':<12} | {'Crop Applied':<14} | {'Cropped Size':<14}")
    print("-" * 75)

    ratios = [
        ("1:1 Square", 1000, 1000, 0.35),
        ("4:3 Standard", 1200, 900, 0.35),
        ("16:9 Wide", 1920, 1080, 0.35),
        ("3:4 Portrait", 900, 1200, 0.35),
    ]

    for r_name, cw, ch, scale in ratios:
        target_h = int(ch * scale)
        scale_factor = target_h / person_src.height
        target_w = int(person_src.width * scale_factor)
        scaled_person = person_src.resize((target_w, target_h), Image.Resampling.LANCZOS)
        
        bg = Image.new("RGBA", (cw, ch), (225, 230, 235, 255))
        paste_x = (cw - target_w) // 2
        paste_y = (ch - target_h) // 2
        bg.paste(scaled_person, (paste_x, paste_y), scaled_person)
        
        bio = io.BytesIO()
        bg.convert("RGB").save(bio, format="JPEG", quality=95)
        img_bytes = bio.getvalue()
        
        res_bytes, report = preprocess_user_image(img_bytes, occupancy_threshold=0.50)
        print(
            f"{r_name:<15} | {cw}x{ch:<10} | {report.occupancy_ratio*100:>8.1f}%   | "
            f"{str(report.crop_applied):<14} | {str(report.prepared_dimensions):<14}"
        )
    print()

    # ------------------------------------------------------------------------
    # EXPERIMENT 4: Threshold Sensitivity Analysis
    # ------------------------------------------------------------------------
    print("4. THRESHOLD SENSITIVITY EVALUATION")
    print("Evaluating which threshold correctly separates large vs small subjects:")
    print(f"{'Scale Tier':<15} | {'Occupancy':<10} | {'T=0.40':<8} | {'T=0.45':<8} | {'T=0.50':<8} | {'T=0.55':<8} | {'T=0.60':<8} | {'T=0.65':<8}")
    print("-" * 80)

    for scale, report in scale_results:
        occ = report.occupancy_ratio
        t40 = "CROP" if occ < 0.40 else "KEEP"
        t45 = "CROP" if occ < 0.45 else "KEEP"
        t50 = "CROP" if occ < 0.50 else "KEEP"
        t55 = "CROP" if occ < 0.55 else "KEEP"
        t60 = "CROP" if occ < 0.60 else "KEEP"
        t65 = "CROP" if occ < 0.65 else "KEEP"
        print(f"Scale {scale*100:>3.0f}%        | {occ*100:>7.1f}%  | {t40:<8} | {t45:<8} | {t50:<8} | {t55:<8} | {t60:<8} | {t65:<8}")

    print("=" * 80)


if __name__ == "__main__":
    run_experiments()
