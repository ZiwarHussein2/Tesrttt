"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// Silently refreshes server data on an interval (live boards).
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
