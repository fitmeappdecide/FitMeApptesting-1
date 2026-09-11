const API_BASE = "http://localhost:8000/api/v1";
export async function fetchProductFromUrl(url: string) { const res = await fetch(`${API_BASE}/product/from-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); return res.json(); }
