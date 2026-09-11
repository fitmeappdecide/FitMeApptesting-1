import asyncio
import os
import sys

# Add the current directory to sys.path so 'app' can be found
sys.path.append(os.getcwd())

from app.services.product_scraper import scrape_product

async def test():
    # Force Myntra to trigger scraper service (stealth scrape)
    url = "https://www.myntra.com/dresses/maison-cleo/silk-slip-midi-dress/12345/buy"
    result = await scrape_product(url)
    print("Scraper result:")
    print(result)

if __name__ == "__main__":
    asyncio.run(test())
