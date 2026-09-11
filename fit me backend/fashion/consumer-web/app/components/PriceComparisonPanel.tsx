const rows = [
  { platform: "Myntra", title: "Roadster navy cotton shirt", price: "Rs 899", old: "Rs 1499", badge: "BEST PRICE" },
  { platform: "Amazon", title: "Roadster navy cotton shirt", price: "Rs 949", old: "Rs 1599", badge: "ORIGINAL" },
  { platform: "Flipkart", title: "Roadster navy cotton shirt", price: "Rs 999", old: "Rs 1699", badge: "" }
];

export function PriceComparisonPanel() {
  return (
    <section className="mt-6">
      <div className="label">Price Comparison <span className="ml-3 font-normal normal-case tracking-normal text-[#9E9080]">Same brand only</span></div>
      <div className="mt-3 space-y-3">
        {rows.map((row) => (
          <div key={row.platform} className="grid grid-cols-[64px_1fr_auto_auto] items-center gap-3 rounded-lg border border-fitmeBorder bg-fitmeBg p-3">
            <div className="text-sm font-semibold">{row.platform}</div>
            <div className="line-clamp-2 text-sm">{row.title}</div>
            <div className="text-right"><div className="font-semibold">{row.price}</div><div className="text-xs text-[#6A5A48] line-through">{row.old}</div></div>
            <a className="rounded-full border border-fitmeBorder px-3 py-2 text-xs font-bold text-fitmeGold" href="#">{row.badge || "VIEW"}</a>
          </div>
        ))}
      </div>
    </section>
  );
}

