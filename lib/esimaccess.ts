import { env } from "cloudflare:workers";

const API_BASE = "https://api.esimaccess.com";

type ApiEnvelope<T> = {
  success: boolean;
  errorCode?: string | null;
  errorMsg?: string | null;
  obj?: T;
};

export type EsimPackage = {
  packageCode: string;
  slug: string;
  name: string;
  price: number;
  currencyCode: string;
  volume: number;
  duration: number;
  durationUnit: string;
  location: string;
  description: string;
  speed?: string;
  favorite?: boolean;
  supportTopUpType?: number;
  locationNetworkList?: Array<{
    locationName?: string;
    locationLogo?: string;
    operatorList?: Array<{ operatorName?: string; networkType?: string }>;
  }>;
};

export type EsimProfile = {
  orderNo: string;
  transactionId?: string;
  esimTranNo: string;
  iccid?: string;
  imsi?: string;
  msisdn?: string;
  ac?: string;
  qrCodeUrl?: string;
  shortUrl?: string;
  eid?: string;
  smsStatus?: number;
  activeType?: number;
  dataType?: number;
  activateTime?: string;
  totalDuration?: number;
  durationUnit?: string;
  pin?: string;
  puk?: string;
  apn?: string;
  esimStatus: string;
  smdpStatus: string;
  totalVolume?: number;
  orderUsage?: number;
  expiredTime?: string;
  packageList?: Array<{
    packageName?: string;
    packageCode?: string;
    slug?: string;
    duration?: number;
    volume?: number;
    locationCode?: string;
    createTime?: string;
  }>;
};

async function signature(input: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(input));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function esimAccessRequest<T>(path: string, payload: unknown): Promise<T> {
  const accessCode = env.ESIM_ACCESS_CODE;
  const secretKey = env.ESIM_SECRET_KEY;
  if (!accessCode || !secretKey) throw new Error("eSIMAccess API credentials are not configured");

  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const requestId = crypto.randomUUID().replaceAll("-", "");
  const signed = await signature(`${timestamp}${requestId}${accessCode}${body}`, secretKey);
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "RT-AccessCode": accessCode,
      "RT-RequestID": requestId,
      "RT-Signature": signed,
      "RT-Timestamp": timestamp,
    },
    body,
  });

  if (!response.ok) throw new Error(`eSIMAccess HTTP ${response.status}`);
  const result = await response.json() as ApiEnvelope<T>;
  if (!result.success || !result.obj) {
    throw new Error(result.errorMsg || `eSIMAccess error ${result.errorCode || "unknown"}`);
  }
  return result.obj;
}

export async function getBalance() {
  return esimAccessRequest<{ balance: number }>("/api/v1/open/balance/query", {});
}

export async function getPackages(locationCode = "") {
  return esimAccessRequest<{ packageList: EsimPackage[] }>("/api/v1/open/package/list", {
    locationCode,
    type: "BASE",
    packageCode: "",
    iccid: "",
  });
}

export async function getTopUpPackages(iccid: string) {
  return esimAccessRequest<{ packageList: EsimPackage[] }>("/api/v1/open/package/list", {
    locationCode: "",
    type: "TOPUP",
    packageCode: "",
    slug: "",
    iccid,
  });
}

export async function getProfiles(pageNum = 1, pageSize = 20) {
  return esimAccessRequest<{ esimList: EsimProfile[]; pager: { pageNum: number; pageSize: number; total: number } }>("/api/v1/open/esim/query", {
    orderNo: "",
    esimTranNo: "",
    iccid: "",
    pager: { pageNum, pageSize },
  });
}

export async function getAllProfiles() {
  const pageSize = 50;
  const first = await getProfiles(1, pageSize);
  const totalPages = Math.ceil(first.pager.total / pageSize);
  if (totalPages <= 1) return first;

  const profiles = [...first.esimList];
  const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
  for (let offset = 0; offset < remainingPages.length; offset += 5) {
    const batch = remainingPages.slice(offset, offset + 5);
    const results = await Promise.all(batch.map((page) => getProfiles(page, pageSize)));
    for (const result of results) profiles.push(...result.esimList);
    if (offset + 5 < remainingPages.length) {
      await new Promise((resolve) => setTimeout(resolve, 850));
    }
  }

  return {
    esimList: profiles,
    pager: { pageNum: 1, pageSize, total: first.pager.total },
  };
}
