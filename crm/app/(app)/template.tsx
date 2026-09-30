/**
 * Re-mounted on every navigation inside the app: the page glides in and its top-level
 * sections cascade after it (see .page-cascade in globals.css).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-cascade animate-page-in">{children}</div>;
}
