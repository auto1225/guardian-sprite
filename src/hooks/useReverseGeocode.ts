import { useState, useEffect } from "react";

interface ReverseGeocodeResult {
  address: string | null;
  loading: boolean;
}

/**
 * Reverse geocode coordinates to a human-readable address using Nominatim.
 */
export function useReverseGeocode(lat: number | null | undefined, lng: number | null | undefined): ReverseGeocodeResult {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lat == null || lng == null) {
      setAddress(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ko`,
      { headers: { "User-Agent": "MeerCop/1.0" } }
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.display_name) {
          setAddress(data.display_name);
        } else {
          setAddress(null);
        }
      })
      .catch(() => {
        if (!cancelled) setAddress(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return { address, loading };
}
