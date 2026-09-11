import { Link, Sparkles } from "lucide-react";

const platforms = [
  ["Myntra", "#FF3F6C"], ["Amazon", "#4A90D9"], ["Meesho", "#9B5DE5"], ["Flipkart", "#F7B731"], ["AJIO", "#E8532B"],
  ["+12 more", "#C9974A"]
];

export function UniversalTryOnHero() {
  return (
    <section className="min-h-screen bg-fitmeBg px-5 py-8 md:px-12">
      <nav className="mx-auto flex max-w-6xl items-center justify-between border-b border-fitmeBorder pb-5">
        <div className="font-serif text-2xl font-bold">FitMe</div>
        <a className="rounded-full border border-fitmeBorder px-4 py-2 text-sm text-fitmeGold" href="/auth">Sign in</a>
      </nav>
      <div className="mx-auto grid max-w-6xl items-center gap-10 py-16 md:grid-cols-[1fr_1.05fr]">
        <div>
          <div className="label">Universal Try-On</div>
          <h1 className="mt-4 font-serif text-5xl font-bold leading-tight md:text-7xl">Try any product from any <span className="italic text-fitmeGold">platform</span></h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#9E9080]">Paste a fashion product link and see the garment on your body, with size guidance and same-brand price comparisons across Indian marketplaces.</p>
        </div>
        <div>
          <div className="flex items-center gap-3 rounded-full border border-fitmeBorder bg-fitmeCard p-2 pl-5 shadow-2xl">
            <Link className="h-5 w-5 text-fitmeGold" />
            <input className="min-w-0 flex-1 bg-transparent py-4 text-white outline-none placeholder:text-[#6A5A48]" placeholder="Paste Myntra, Amazon, Meesho, Flipkart URL" />
            <button className="flex items-center gap-2 rounded-full bg-fitmeRed px-6 py-4 font-semibold text-white hover:bg-[#B8432F]"><Sparkles className="h-4 w-4" />Try it on me</button>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {platforms.map(([name, color]) => <span key={name} className="flex items-center gap-2 rounded-full border border-fitmeBorder bg-fitmeCard px-4 py-2 text-sm text-[#9E9080]"><i className="h-2 w-2 rounded-full" style={{ background: color }} />{name}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

