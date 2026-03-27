'use client';

export default function FirmAssumptionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-800 mb-2">Error loading Firm Wide Assumptions</h2>
        <p className="text-sm text-red-700 font-mono mb-4">{error.message}</p>
        {error.digest && <p className="text-xs text-red-500 mb-4">Digest: {error.digest}</p>}
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
