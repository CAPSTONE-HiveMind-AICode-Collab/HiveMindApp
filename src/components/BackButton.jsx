"use client";

import { useRouter } from "next/navigation";

export default function BackButton({
  fallback = "/dashboard",
  label = "Back",
  className = "",
}) {
  const router = useRouter();

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallback);
  };

  return (
    <button
      type="button"
      onClick={goBack}
      className={`button-ghost ${className}`.trim()}
    >
      {label}
    </button>
  );
}
