import { getPackages } from "@/lib/esimaccess";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const location = (url.searchParams.get("location") || "").toUpperCase().slice(0, 3);
    const query = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 80);
    const minDataGb = Math.max(Number(url.searchParams.get("minDataGb")) || 0, 0);
    const maxPrice = Math.max(Number(url.searchParams.get("maxPrice")) || 0, 0);
    const maxDuration = Math.max(Number(url.searchParams.get("maxDuration")) || 0, 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 100);
    const offset = Math.max(Math.floor(Number(url.searchParams.get("offset")) || 0), 0);
    const requestedIds = new Set((url.searchParams.get("ids") || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 500));
    const result = await getPackages(location);
    const filtered = result.packageList.filter((item) => {
      const searchable = `${item.name} ${item.description} ${item.location} ${item.slug} ${item.locationNetworkList?.map((entry) => `${entry.locationName || ""} ${entry.operatorList?.map((operator) => `${operator.operatorName || ""} ${operator.networkType || ""}`).join(" ") || ""}`).join(" ") || ""}`.toLowerCase();
      if (requestedIds.size && !requestedIds.has(item.slug || item.packageCode) && !requestedIds.has(item.packageCode)) return false;
      if (query && !searchable.includes(query)) return false;
      if (minDataGb && item.volume < minDataGb * 1024 * 1024 * 1024) return false;
      if (maxPrice && item.price / 10_000 > maxPrice) return false;
      if (maxDuration && item.duration > maxDuration) return false;
      return true;
    });
    return Response.json({
      connected: true,
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + limit < filtered.length,
      items: filtered.slice(offset, offset + limit).map((item) => ({
        id: item.slug || item.packageCode,
        packageCode: item.packageCode,
        slug: item.slug,
        name: item.name,
        description: item.description,
        priceRaw: item.price,
        price: item.price / 10_000,
        currency: item.currencyCode,
        volume: item.volume,
        duration: item.duration,
        durationUnit: item.durationUnit,
        location: item.location,
        speed: item.speed || null,
        favoriteOnSupplier: Boolean(item.favorite),
        countryName: item.locationNetworkList?.[0]?.locationName || item.location,
        countryLogo: item.locationNetworkList?.[0]?.locationLogo || null,
        operators: Array.from(new Map(
          (item.locationNetworkList || []).flatMap((entry) => (entry.operatorList || []).map((operator) => [
            `${operator.operatorName || "未知运营商"}-${operator.networkType || ""}`,
            { name: operator.operatorName || "未知运营商", networkType: operator.networkType || "" },
          ] as const)),
        ).values()),
      })),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ connected: false, error: error instanceof Error ? error.message : "同步失败" }, { status: 502 });
  }
}
