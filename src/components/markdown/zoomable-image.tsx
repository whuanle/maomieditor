"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { X } from "lucide-react";

interface ZoomableImageProps {
  src?: string;
  alt?: string;
  className?: string;
}

export function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const [isZoomed, setIsZoomed] = useState(false);

  if (!src) return null;

  return (
    <>
      <img
        src={src}
        alt={alt || "图片"}
        className={className ?? "max-w-full rounded-md my-6 cursor-zoom-in border border-[var(--border-default)]"}
        onClick={() => setIsZoomed(true)}
      />

      {isZoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setIsZoomed(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsZoomed(false);
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={src}
            alt={alt || "图片"}
            className="max-w-full max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
