// Hosts the standalone YouTube Growth Dashboard HTML at /tracking.
// We render it inside an iframe pointing to /tracking-dashboard.html (served
// statically by Vite/Nginx from public/) so the dashboard's original styling,
// fonts, and Chart.js setup are preserved exactly as in the source HTML —
// no Tailwind / shadcn interference.
export default function Tracking() {
  return (
    <iframe
      src="/tracking-dashboard.html"
      title="YouTube Growth Dashboard"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
        background: "#f5f5f3",
      }}
    />
  );
}
