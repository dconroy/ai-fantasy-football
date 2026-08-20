import Image from "next/image";
import Link from "next/link";

export function BrandLockup({
  href = "/",
  kicker = "FANTASY WAR ROOM",
}: {
  href?: string;
  kicker?: string;
}) {
  return (
    <Link className="brand-lockup" href={href} aria-label="Draft Dojo home">
      <Image
        className="brand-mark"
        src="/brand-icon.svg"
        width={42}
        height={42}
        alt=""
        unoptimized
        priority
      />
      <span className="brand-copy">
        <strong>DRAFT DOJO</strong>
        <small>{kicker}</small>
      </span>
    </Link>
  );
}
