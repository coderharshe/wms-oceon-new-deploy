export default function Copyright({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted ${className}`}>
      © {new Date().getFullYear()} SHP Stacks
    </p>
  );
}
