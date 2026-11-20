import { cn } from "@/lib/utils";

/**
 * Skeleton placeholder block. The soft base colour and the light sweep come
 * from the `.skeleton` class in styles.css, so it follows the active theme
 * (light, dark and black) and respects reduced-motion settings.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} {...props} />;
}

export { Skeleton };
