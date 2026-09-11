export async function action() { return new Response(JSON.stringify({ status: "accepted" }), { headers: { "Content-Type": "application/json" } }); }

