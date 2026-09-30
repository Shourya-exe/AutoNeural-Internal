"use client";
export function PrintButton() {
  return (
    <button className="button" onClick={() => window.print()}>
      Download PDF / Print
    </button>
  );
}
