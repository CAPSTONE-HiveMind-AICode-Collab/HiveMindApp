"use client";

import { useEffect, useState } from "react";

function getInitials(value) {
  const raw = String(value || "").trim();
  if (!raw) return "HM";

  const source = raw.includes("@") ? raw.split("@")[0] : raw;
  const parts = source.split(/[\s._-]+/).filter(Boolean);

  if (!parts.length) {
    return source.slice(0, 2).toUpperCase();
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 2);
}

export default function UserAvatar({
  user = null,
  name = "",
  email = "",
  photoURL = "",
  size = "md",
  className = "",
  style = undefined,
  fallbackClassName = "",
  imageClassName = "",
  title = "",
}) {
  const source = String(photoURL || user?.photoURL || "").trim();
  const label = String(name || user?.displayName || email || user?.email || "User").trim();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [source]);

  return (
    <span
      className={`user-avatar user-avatar-${size} ${className}`.trim()}
      style={style}
      title={title || label}
      aria-hidden="true"
    >
      {source && !imageFailed ? (
        <img
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          className={`user-avatar-image ${imageClassName}`.trim()}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={`user-avatar-fallback ${fallbackClassName}`.trim()}>
          {getInitials(label)}
        </span>
      )}
    </span>
  );
}
