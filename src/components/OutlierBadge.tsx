import { cn } from "@/lib/utils";

interface OutlierBadgeProps {
  score: number;
  className?: string;
}

function getOutlierColor(score: number): string {
  if (score >= 10) return 'bg-green-500 text-white';       // Viral (10x+)
  if (score >= 3) return 'bg-blue-500 text-white';         // Tres bon (3-10x)
  if (score >= 1.5) return 'bg-cyan-500 text-white';       // Bon (1.5-3x)
  if (score >= 0.5) return 'bg-gray-500 text-white';       // Normal (0.5-1.5x)
  return 'bg-red-500 text-white';                           // Sous-perf (<0.5x)
}

function formatScore(score: number): string {
  if (score >= 100) {
    return `${Math.round(score)}x`;
  }
  if (score >= 10) {
    return `${Math.round(score)}x`;
  }
  return `${score.toFixed(1)}x`;
}

export default function OutlierBadge({ score, className }: OutlierBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[3rem]",
        getOutlierColor(score),
        className
      )}
    >
      {formatScore(score)}
    </span>
  );
}
