"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

const NAV_ITEMS = [
  { href: "/triage", label: "Briefing" },
  { href: "/dream-100", label: "Dream 100" },
  { href: "/pool", label: "Pool" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {NAV_ITEMS.map(({ href, label }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            data-cy={`nav-${label.toLowerCase().replace(' ', '-')}`}
            className={`${styles.nav__link} ${isActive ? styles["nav__link--active"] : ""}`}
          >
            {label}
          </Link>
        );
      })}
      <Link
        href="/settings"
        data-cy="nav-settings"
        className={`${styles.nav__link} ${styles["nav__link--end"]} ${pathname === "/settings" ? styles["nav__link--active"] : ""}`}
      >
        Settings
      </Link>
    </>
  );
}
