export function MyntraFallbackCard() {
  return (
    <div className="card p-5">
      <div className="label">Myntra fallback</div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {["Install FitMe Lens", "Paste image URL", "Upload screenshot"].map((item) => <button key={item} className="rounded-lg border border-fitmeBorder bg-fitmeBg p-4 text-left text-fitmeGold">{item}</button>)}
      </div>
    </div>
  );
}

