from PIL import Image
import json

img_path = "/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/eva.png"
img = Image.open(img_path).convert("RGBA")
width, height = img.size
bbox = img.getbbox()

# Find center of bounding box
if bbox:
    cx = (bbox[0] + bbox[2]) / 2
    cy = (bbox[1] + bbox[3]) / 2
else:
    cx, cy = width/2, height/2

print(json.dumps({
    "canvas": f"{width}x{height}",
    "transparent_bbox": bbox,
    "bbox_width": bbox[2] - bbox[0] if bbox else 0,
    "bbox_height": bbox[3] - bbox[1] if bbox else 0,
    "bbox_center": [cx, cy],
    "canvas_center": [width/2, height/2],
    "diff_from_center_y": cy - (height/2)
}, indent=2))
