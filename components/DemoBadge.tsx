"use client";

export default function DemoBadge() {
  return (
    <div className="fixed top-4 right-4 z-50">
      <span
        className="rounded-xl px-3 py-1 text-sm font-semibold"
        style={{
          background: "#0fc2cb22",
          color: "#0fc2cb",
          border: "1px solid #0fc2cb55",
        }}
      >
        DEMO
      </span>
    </div>
  );
}
