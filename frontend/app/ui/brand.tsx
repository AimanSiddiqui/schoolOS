import { GraduationCap } from "lucide-react";
import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand-symbol">
        <GraduationCap size={22} strokeWidth={1.8} />
      </span>
      <span>
        School<span className="brand-os">OS</span>
      </span>
    </Link>
  );
}
