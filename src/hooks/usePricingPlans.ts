import { useEffect, useState } from "react";
import { websiteSupabase } from "@/lib/websiteAuth";

/**
 * Plan catalog row fetched from the website's `cms_pricing` table.
 * The website is the single source of truth for prices and IAP product IDs.
 */
export interface PricingPlan {
  id: string;
  /** App-internal plan key — derived from sort_order: 1=basic, 2=premium */
  type: "basic" | "premium";
  name: string;          // English-preferred display name
  nameLocal: string;     // Korean (or original) name
  price: number;         // Numeric USD price
  period: string;        // English period label (e.g. "/ 6 months")
  periodLocal: string;
  months: number;        // Parsed duration in months (6, 12, ...)
  featured: boolean;
  iosProductId: string;  // Apple IAP product id (may be empty if not set)
}

const CACHE_KEY = "meercop_pricing_plans_v1";

// Fallback plans used only when DB fetch fails AND no cache exists.
// Kept conservative — these will be overwritten on first successful fetch.
const FALLBACK_PLANS: PricingPlan[] = [
  { id: "fallback-basic", type: "basic", name: "Basic Plan", nameLocal: "베이직 플랜", price: 24.99, period: "/ 6 months", periodLocal: "/ 6개월", months: 6, featured: false, iosProductId: "" },
  { id: "fallback-premium", type: "premium", name: "Premium Plan", nameLocal: "프리미엄 플랜", price: 39.99, period: "/ 1 year", periodLocal: "/ 1년", months: 12, featured: true, iosProductId: "" },
];

/** Parse a period string like "/ 6 months", "/ 1 year", "/ 6개월", "/ 1년" → months count */
function parseMonths(period: string, periodLocal: string): number {
  const haystack = `${period} ${periodLocal}`.toLowerCase();
  const yearMatch = haystack.match(/(\d+)\s*(year|yr|년)/);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  const monthMatch = haystack.match(/(\d+)\s*(month|mo|개월|달)/);
  if (monthMatch) return parseInt(monthMatch[1], 10);
  return 0;
}

interface CmsPricingRow {
  id: string;
  name: string;
  name_en: string | null;
  price: string;
  period: string;
  period_en: string | null;
  featured: boolean;
  sort_order: number;
  ios_product_id: string | null;
}

function transform(rows: CmsPricingRow[]): PricingPlan[] {
  return rows
    // Skip the free trial entry (price 0 / sort_order 0)
    .filter((r) => parseFloat(r.price) > 0)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r, idx): PricingPlan => {
      const period = r.period_en || r.period || "";
      const periodLocal = r.period || period;
      return {
        id: r.id,
        type: idx === 0 ? "basic" : "premium",
        name: r.name_en || r.name,
        nameLocal: r.name,
        price: parseFloat(r.price) || 0,
        period,
        periodLocal,
        months: parseMonths(period, periodLocal),
        featured: !!r.featured,
        iosProductId: r.ios_product_id || "",
      };
    });
}

function loadCache(): PricingPlan[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  return null;
}

export function usePricingPlans() {
  const [plans, setPlans] = useState<PricingPlan[]>(() => loadCache() || FALLBACK_PLANS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await websiteSupabase
          .from("cms_pricing")
          .select("id,name,name_en,price,period,period_en,featured,sort_order,ios_product_id")
          .order("sort_order", { ascending: true });

        if (cancelled) return;
        if (err) {
          setError(err.message);
        } else if (data) {
          const transformed = transform(data as CmsPricingRow[]);
          if (transformed.length > 0) {
            setPlans(transformed);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(transformed)); } catch { /* ignore */ }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { plans, loading, error };
}
