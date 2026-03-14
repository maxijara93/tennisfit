import { Header } from "@/components/Header";
import { RankingBoard } from "@/components/RankingBoard";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-6">
          <h1 className="text-3xl font-semibold">Ranking mensual</h1>
          <div className="mt-6">
            <RankingBoard />
          </div>
        </div>
      </main>
    </div>
  );
}
