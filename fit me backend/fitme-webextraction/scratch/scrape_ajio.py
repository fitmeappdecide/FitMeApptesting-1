import urllib.request
import re
import json
import ssl

context = ssl._create_unverified_context()

url = "https://www.ajio.com/allen-solly-men-checks-slim-fit-shirt/p/702480071_white"
req = urllib.request.Request(
    url,
    headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"}
)

try:
    with urllib.request.urlopen(req, context=context) as response:
        html = response.read().decode("utf-8")
    print("HTML length:", len(html))
    
    # Find JSON-LD
    json_ld = re.findall(r"<script[^>]*type=\"application/ld\+json\"[^>]*>(.*?)</script>", html, re.DOTALL)
    print("Found JSON-LD scripts:", len(json_ld))
    for i, j in enumerate(json_ld):
        try:
            data = json.loads(j.strip())
            print(f"JSON-LD {i}:")
            if isinstance(data, dict):
                print("  Keys:", list(data.keys()))
                if "image" in data:
                    print("  Image:", data["image"])
            elif isinstance(data, list):
                print("  List of length:", len(data))
        except Exception as e:
            pass

    # Find preloaded state
    for match in re.finditer(r"window\.__PRELOADED_STATE__\s*=\s*(.*?);", html):
        print("Found __PRELOADED_STATE__")
        state_str = match.group(1)
        print("State length:", len(state_str))
        try:
            state = json.loads(state_str)
            # Find product images inside state
            def find_images(obj, path=""):
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        find_images(v, f"{path}.{k}" if path else k)
                elif isinstance(obj, list):
                    for idx, item in enumerate(obj):
                        find_images(item, f"{path}[{idx}]")
                elif isinstance(obj, str) and "assets.ajio.com" in obj:
                    print(f"Found URL at {path}: {obj}")
            find_images(state)
        except Exception as e:
            print("Error parsing state:", e)

    # Let us search for assets.ajio.com in the html
    ajio_urls = re.findall(r"https://assets\.ajio\.com/[^\s\"'\(\)>]+", html)
    print("Total assets.ajio.com URLs in raw HTML:", len(ajio_urls))
    for u in sorted(list(set(ajio_urls)))[:40]:
        print("Raw URL:", u)
        
except Exception as e:
    print("Error:", e)
