export function Header() {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-red-600 flex items-center justify-center text-white font-bold">
            TF
          </div>

          <div>
            <div className="font-semibold text-lg">TennisFit</div>
            <div className="text-xs text-neutral-500">
              Ranking mensual de jugadores
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
