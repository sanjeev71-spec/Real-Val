// Shown instantly while a page is being prepared, so a click always gives feedback.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="loadbar" />
      <div className="skeleton h-7 w-56" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}
      </div>
      <div className="card space-y-2.5">
        {Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-5" style={{ width: `${96 - (i % 4) * 7}%` }} />)}
      </div>
    </div>
  );
}
