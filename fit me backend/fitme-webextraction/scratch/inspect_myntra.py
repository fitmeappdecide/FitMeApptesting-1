import json
import re

with open("/Users/selvi.none/Desktop/fit me/fitme-webextraction/tmp/myntra.html", "r", encoding="utf-8") as f:
    html = f.read()

# Extract __NEXT_DATA__
match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
if match:
    json_str = match.group(1)
    print("Found __NEXT_DATA__, length:", len(json_str))
    try:
        root = json.loads(json_str)
        print("Root keys:", list(root.keys()))
        
        # Define findProductBlob in Python to see what it finds
        def find_product_blob(node, path=""):
            if isinstance(node, dict):
                has_name = "name" in node or "productName" in node or "title" in node
                has_images = "images" in node or "media" in node
                has_price = "price" in node or "mrp" in node or "discountedPrice" in node
                if has_name and (has_images or has_price):
                    print(f"MATCH at path: {path}")
                    print("  Keys:", list(node.keys()))
                    print("  Name:", node.get("name") or node.get("productName") or node.get("title"))
                    print("  Price keys:", {k: node[k] for k in ["price", "mrp", "discountedPrice"] if k in node})
                    # Do not return immediately so we can see all matches
                for k, v in node.items():
                    find_product_blob(v, f"{path}.{k}" if path else k)
            elif isinstance(node, list):
                for idx, item in enumerate(node):
                    find_product_blob(item, f"{path}[{idx}]")

        find_product_blob(root)
    except Exception as e:
        print("Error parsing JSON:", e)
else:
    print("Could not find __NEXT_DATA__")
