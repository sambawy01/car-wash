import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-24 text-center">
      <div>
        <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[#0D3B66]">
          Elite Eco Car Wash
        </p>
        <h1 className="font-serif text-4xl font-medium sm:text-5xl">
          Elite Eco Car Wash
        </h1>
        <p className="mt-3 text-sm text-[#4A5568]">
          We Bring the Car Wash to You!
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/book"
          className="rounded-full bg-[#0D3B66] px-8 py-3 font-medium text-[#F8FAFC] transition-opacity hover:opacity-90"
        >
          Book a Car Wash
        </Link>
        <a
          href="https://eliteecocarwash.com/"
          className="rounded-full border border-[#0D3B66]/50 px-8 py-3 text-[#0A1A2F] transition-colors hover:border-[#0D3B66]"
        >
          Back to main site
        </a>
      </div>
    </main>
  );
}