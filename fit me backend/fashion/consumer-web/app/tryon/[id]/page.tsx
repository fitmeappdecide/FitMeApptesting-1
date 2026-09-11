import { PriceComparisonPanel } from "../../components/PriceComparisonPanel";

export default function TryOnResultPage() {
  return (
    <main className="min-h-screen bg-fitmeBg px-5 py-8 md:px-12">
      <nav className="mx-auto max-w-6xl border-b border-fitmeBorder pb-5 font-serif text-2xl font-bold">FitMe</nav>
      <section className="mx-auto max-w-6xl py-10">
        <div className="label">Step 03 Result</div>
        <h1 className="mt-3 font-serif text-5xl">Here you are.</h1>
        <div className="mt-8 grid gap-6 md:grid-cols-[1.15fr_.85fr]">
          <div className="card aspect-[4/5] min-h-[420px] bg-[linear-gradient(145deg,#2A2018,#1A1208)]" />
          <aside>
            <div className="card p-5"><div className="label">Fit Analysis</div><div className="mt-5 grid grid-cols-2 gap-4"><div><div className="text-[#9E9080]">Size</div><div className="text-4xl font-semibold">M</div></div><div><div className="text-[#9E9080]">Confidence</div><div className="text-4xl font-semibold">86%</div></div></div><div className="mt-5 grid gap-3">{["Chest comfortable", "Shoulder true", "Skin tone compatible"].map((item) => <div key={item} className="rounded-lg border border-fitmeBorder bg-fitmeBg p-3 text-sm">{item}</div>)}</div></div>
            <div className="card mt-5 p-5"><div className="label">The Piece</div><h2 className="mt-3 text-2xl font-semibold">Roadster navy cotton shirt</h2><p className="mt-2 text-[#9E9080]">Myntra</p><a className="mt-4 inline-block text-fitmeGold" href="#">View on Myntra</a></div>
            <PriceComparisonPanel />
          </aside>
        </div>
      </section>
    </main>
  );
}

