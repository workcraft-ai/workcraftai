"use client";

import { useEffect, useState } from "react";

const mapsEmbedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

export function AddressMap({ address, language, compact = false }: { address: string; language: "en" | "es"; compact?: boolean }) {
  const [appleDevice, setAppleDevice] = useState(false);
  useEffect(() => {
    setAppleDevice(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent));
  }, []);

  const destination = encodeURIComponent(address.trim());
  if (!destination) return null;

  const directionsUrl = appleDevice
    ? `https://maps.apple.com/?daddr=${destination}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate`;
  const previewUrl = mapsEmbedKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapsEmbedKey)}&q=${destination}`
    : null;
  const widthClass = compact ? "max-w-52" : "max-w-80";

  return <div className={`space-y-2 ${widthClass}`}>
    <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700" aria-label={language === "es" ? `Abrir indicaciones a ${address}` : `Open directions to ${address}`}>
      {previewUrl ? <iframe src={previewUrl} title={language === "es" ? `Vista previa del mapa de ${address}` : `Map preview of ${address}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" tabIndex={-1} aria-hidden="true" className="pointer-events-none h-full w-full border-0" /> : <span className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 to-blue-100 px-5 text-center text-slate-700"><span aria-hidden="true" className="text-5xl">⌖</span><span className="text-sm font-semibold">{language === "es" ? "Vista previa del mapa no configurada" : "Map preview not configured"}</span></span>}
      <span className="absolute bottom-3 left-3 right-3 rounded-lg bg-white/95 px-3 py-2 text-center text-sm font-semibold text-slate-900 shadow-sm group-hover:bg-white">{language === "es" ? "Abrir indicaciones ↗" : "Open directions ↗"}</span>
    </a>
    <p className="text-xs text-slate-600">{language === "es" ? "Confirma la dirección antes de iniciar el viaje." : "Confirm the address before starting your trip."}</p>
  </div>;
}
