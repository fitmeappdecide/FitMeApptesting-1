from PIL import Image

try:
    img = Image.open("/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/eva.png")
    # Get bounding box of non-zero alpha pixels
    bbox = img.getbbox()
    if bbox:
        img_cropped = img.crop(bbox)
        img_cropped.save("/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/eva.png")
        print("Cropped successfully!")
    else:
        print("Image is entirely transparent or bounding box not found.")
except Exception as e:
    print("Error:", e)
