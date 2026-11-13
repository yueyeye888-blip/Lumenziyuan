"use client";

import { useEffect, useMemo, useState } from "react";
import SupplierTemplateLibrary from "@/components/supplier-template-library";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Filter,
  Folder,
  FolderPlus,
  Globe2,
  Heart,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Bot,
  CreditCard,
  KeyRound,
  LogOut,
  Mail,
  PackageCheck,
  Pencil,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Upload,
  UserCircle,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";

type Product = {
  id: string;
  type: "eSIM" | "手机号码";
  name: string;
  description: string;
  region: string;
  country: string;
  flag: string;
  validity: string;
  data: string;
  supplier: string;
  delivery: string;
  tone: string;
  price?: number;
  currency?: string;
  packageCode?: string;
  operators?: Array<{ name: string; networkType: string }>;
};

type GroupProduct = {
  id: string;
  name: string;
  packageCode?: string | null;
  country?: string | null;
  supplier?: string;
};
type ResourceGroup = {
  id: string;
  name: string;
  productIds: string[];
  products: GroupProduct[];
  accent: string;
  memberEmails?: string[];
  canPurchase?: boolean;
  assignedToMe?: boolean;
};

type PurchaseHistoryItem = {
  availabilityStatus?: string;
  availabilityNote?: string | null;
  availabilityRecheckAt?: string | null;
  orderNo: string;
  transactionId: string | null;
  esimTranNo: string;
  iccid: string | null;
  imsi: string | null;
  msisdn: string | null;
  activationCode: string | null;
  qrCodeUrl: string | null;
  shortUrl: string | null;
  eid: string | null;
  smsStatus: number | null;
  activeType: number | null;
  dataType: number | null;
  activateTime: string | null;
  esimStatus: string;
  smdpStatus: string;
  totalVolume: number;
  orderUsage: number;
  expiredTime: string | null;
  totalDuration: number | null;
  durationUnit: string | null;
  pin: string | null;
  puk: string | null;
  apn: string | null;
  packageName: string;
  packageCode: string | null;
  locationCode: string | null;
  createTime: string | null;
};

type TopUpPackage = {
  id: string;
  packageCode: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  volume: number;
  duration: number;
  durationUnit: string;
  location: string;
};

type PlatformOverview = {
  connected: boolean;
  viewer?: {
    userId: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  };
  balance?: { raw: number; amount: number; currency: string };
  history?: {
    total: number;
    supplierTotal?: number;
    items: PurchaseHistoryItem[];
  };
  syncedAt?: string;
  error?: string;
};

type CatalogResponse = {
  connected: boolean;
  total: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  items: Array<{
    id: string;
    packageCode: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    volume: number;
    duration: number;
    durationUnit: string;
    location: string;
    countryName: string;
    operators: Array<{ name: string; networkType: string }>;
  }>;
};

type WarehouseBatch = {
  id: string;
  batchId: string;
  supplier: string;
  productName: string;
  category: string;
  country: string | null;
  unitPrice: number | null;
  currency: string;
  createdAt: string;
  available: number;
};

type WarehouseClaim = {
  id: string;
  batchId: string;
  supplier: string;
  productName: string;
  category: string;
  country: string | null;
  unitPrice: number | null;
  currency: string;
  payload: string;
  claimedByName: string | null;
  claimedByEmail: string | null;
  recipientEmail: string | null;
  claimedAt: string | null;
  emailStatus: string;
  emailError: string | null;
  availabilityStatus?: string;
  availabilityNote?: string | null;
  availabilityRecheckAt?: string | null;
};

type ResourceStatusTarget = {
  supplier: string;
  resourceId: string;
  name: string;
  currentStatus?: string;
  note?: string | null;
};

type WarehouseResponse = {
  viewer: { email: string; displayName: string; isAdmin: boolean };
  emailConfigured: boolean;
  stats: { available: number; claimed: number; batches: number };
  batches: WarehouseBatch[];
  claims: WarehouseClaim[];
};

type SampleDocumentRecord = {
  id: string;
  requestNo: string;
  userEmail: string;
  userName: string;
  documentType: string;
  country: string;
  subjectName: string;
  addressLine: string;
  purpose: string;
  recipientEmail: string;
  status: string;
  emailStatus: string;
  emailError: string | null;
  createdAt: string;
};

type SampleDocumentsResponse = {
  viewer: { email: string; displayName: string; isAdmin: boolean };
  emailConfigured: boolean;
  documentTypes: string[];
  records: SampleDocumentRecord[];
};

const fallbackProducts: Product[] = [
  {
    id: "eu-10",
    type: "eSIM",
    name: "欧洲区域流量套餐",
    description: "覆盖欧洲主要国家，适合商务差旅与跨国项目。",
    region: "欧洲",
    country: "欧洲 39 国",
    flag: "EU",
    validity: "有效期以供应商为准",
    data: "套餐规格实时同步",
    supplier: "eSIMAccess",
    delivery: "API 自动交付",
    tone: "from-[#e8f0ff] to-[#dbe7ff] text-[#315cbd]",
  },
  {
    id: "global-20",
    type: "eSIM",
    name: "全球通用流量套餐",
    description: "适合多段跨区域行程，一个二维码覆盖多个目的地。",
    region: "全球",
    country: "全球多地区",
    flag: "GL",
    validity: "有效期以供应商为准",
    data: "套餐规格实时同步",
    supplier: "eSIMAccess",
    delivery: "API 自动交付",
    tone: "from-[#e4f7ef] to-[#d4f0e5] text-[#16795e]",
  },
  {
    id: "us-data",
    type: "eSIM",
    name: "美国本地流量套餐",
    description: "适合美国当地业务人员、临时出差及设备联网。",
    region: "美国",
    country: "美国",
    flag: "US",
    validity: "有效期以供应商为准",
    data: "套餐规格实时同步",
    supplier: "eSIMAccess",
    delivery: "API 自动交付",
    tone: "from-[#fff0e7] to-[#ffe3d2] text-[#c8632e]",
  },
  {
    id: "ee-number",
    type: "手机号码",
    name: "爱沙尼亚实体手机号码",
    description: "适合海外业务注册与长期项目使用，库存需人工确认。",
    region: "爱沙尼亚",
    country: "爱沙尼亚 +372",
    flag: "EE",
    validity: "长期使用",
    data: "号码与库存人工确认",
    supplier: "外部采购供应商",
    delivery: "采购专员处理",
    tone: "from-[#f2edff] to-[#e7dcff] text-[#7251b5]",
  },
];

const initialGroups: ResourceGroup[] = [
  {
    id: "all",
    name: "全部资源",
    productIds: [],
    products: [],
    accent: "bg-[#335c9e]",
  },
];

function formatData(bytes: number) {
  if (!bytes) return "流量规格以供应商为准";
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb >= 1 ? Number(gb.toFixed(gb % 1 ? 1 : 0)) : Math.round(bytes / 1024 / 1024)}${gb >= 1 ? "GB" : "MB"}`;
}

function mapCatalogItems(items: CatalogResponse["items"]): Product[] {
  return items.map((item) => ({
    id: item.id,
    type: "eSIM" as const,
    name: item.name,
    description: item.description || `${item.countryName} eSIM 数据套餐`,
    region: item.location,
    country: item.countryName || item.location,
    flag: item.location?.split(",")[0]?.slice(0, 2) || "ES",
    validity: `${item.duration} ${item.durationUnit === "DAY" ? "天" : item.durationUnit}`,
    data: formatData(item.volume),
    supplier: "eSIMAccess",
    delivery: "API 自动交付",
    tone: "from-[#e8f0ff] to-[#dbe7ff] text-[#315cbd]",
    price: item.price,
    currency: item.currency,
    packageCode: item.packageCode,
    operators: item.operators || [],
  }));
}

function formatMoney(amount?: number, currency = "USD") {
  if (typeof amount !== "number") return "同步中";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount,
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    GOT_RESOURCE: "已交付",
    IN_USE: "使用中",
    USED_UP: "已用尽",
    USED_EXPIRED: "已过期",
    UNUSED_EXPIRED: "未使用过期",
    CANCEL: "已取消",
    SUSPENDED: "已暂停",
  };
  return labels[status] || status;
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "尚未返回";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

function maskIdentifier(value: string | null) {
  if (!value) return "—";
  if (value.length <= 8) return value;
  return `${value.slice(0, 5)}••••${value.slice(-4)}`;
}

export default function Home() {
  const [view, setView] = useState<
    | "store"
    | "favorites"
    | "history"
    | "warehouse"
    | "samples"
    | "templates"
    | "admin"
    | "quota"
    | "sync"
    | "security"
  >("store");
  const [activeGroup, setActiveGroup] = useState("全部资源");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [success, setSuccess] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ResourceGroup | null>(null);
  const [groups, setGroups] = useState<ResourceGroup[]>(initialGroups);
  const [mobileNav, setMobileNav] = useState(false);
  const [overview, setOverview] = useState<PlatformOverview>({
    connected: false,
  });
  const [catalog, setCatalog] = useState<Product[]>(fallbackProducts);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [minDataGb, setMinDataGb] = useState("0");
  const [maxDuration, setMaxDuration] = useState("0");
  const [maxPrice, setMaxPrice] = useState("0");
  const [userMenu, setUserMenu] = useState(false);
  const [addressTemplateId, setAddressTemplateId] = useState<number | null>(null);
  const isAdmin = Boolean(overview.viewer?.isAdmin);

  const loadGroups = async () => {
    const response = await fetch("/api/groups", { cache: "no-store" });
    const data = (await response.json()) as {
      groups?: Array<
        Omit<ResourceGroup, "productIds"> & { products: GroupProduct[] }
      >;
    };
    if (!response.ok) return;
    const sharedGroups = (data.groups || []).map((group) => ({
      ...group,
      productIds: group.products.map((product) => product.id),
    }));
    setGroups([initialGroups[0], ...sharedGroups]);
  };

  useEffect(() => {
    let active = true;
    fetch("/api/session", { cache: "no-store" })
      .then(
        (response) =>
          response.json() as Promise<{ viewer?: PlatformOverview["viewer"] }>,
      )
      .then((session) => {
        if (active && session.viewer)
          setOverview((current) => ({ ...current, viewer: session.viewer }));
      })
      .catch(() => undefined);
    fetch("/api/esim/overview")
      .then((response) => response.json() as Promise<PlatformOverview>)
      .then((overviewData) => {
        if (!active) return;
        setOverview(overviewData);
      })
      .catch(() => {
        if (active)
          setOverview((current) => ({
            ...current,
            connected: false,
            error: "实时数据同步失败",
          }));
      });
    const stored = window.localStorage.getItem("lumen-favorites");
    if (stored) {
      try {
        setFavorites(JSON.parse(stored));
      } catch {
        /* ignore invalid local state */
      }
    }
    void loadGroups();
    return () => {
      active = false;
    };
  }, []);

  const activeGroupConfig =
    groups.find((group) => group.name === activeGroup) || groups[0];

  useEffect(() => {
    setCatalogOffset(0);
  }, [activeGroup, maxDuration, maxPrice, minDataGb, query, view]);

  useEffect(() => {
    let active = true;
    setSyncing(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        limit: "100",
        offset: String(catalogOffset),
      });
      if (query.trim()) params.set("q", query.trim());
      if (minDataGb !== "0") params.set("minDataGb", minDataGb);
      if (maxDuration !== "0") params.set("maxDuration", maxDuration);
      if (maxPrice !== "0") params.set("maxPrice", maxPrice);
      if (view === "favorites" && favorites.length)
        params.set("ids", favorites.join(","));
      else if (activeGroupConfig.id !== "all")
        params.set("ids", activeGroupConfig.productIds.join(","));
      fetch(`/api/esim/packages?${params.toString()}`)
        .then((response) => response.json() as Promise<CatalogResponse>)
        .then((packageData) => {
          if (!active) return;
          if (packageData.connected && Array.isArray(packageData.items)) {
            setCatalogTotal(packageData.total || packageData.items.length);
            const mapped = mapCatalogItems(packageData.items);
            setCatalog((current) =>
              catalogOffset === 0
                ? mapped
                : [
                    ...current,
                    ...mapped.filter(
                      (item) =>
                        !current.some((existing) => existing.id === item.id),
                    ),
                  ],
            );
            setCatalogHasMore(Boolean(packageData.hasMore));
          }
        })
        .catch(() => {
          if (active) setCatalogTotal(0);
        })
        .finally(() => {
          if (active) setSyncing(false);
        });
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    activeGroupConfig.id,
    activeGroupConfig.productIds,
    catalogOffset,
    favorites,
    maxDuration,
    maxPrice,
    minDataGb,
    query,
    view,
  ]);

  useEffect(() => {
    window.localStorage.setItem("lumen-favorites", JSON.stringify(favorites));
  }, [favorites]);

  const visibleProducts = useMemo(
    () =>
      catalog.filter(
        (product) => view !== "favorites" || favorites.includes(product.id),
      ),
    [catalog, favorites, view],
  );

  const toggleFavorite = (id: string) =>
    setFavorites((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  const toggleSelected = (id: string) =>
    setSelected((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  const openPurchase = (id?: string) => {
    if (id && !selected.includes(id)) setSelected([id]);
    setPin("");
    setPurchaseOpen(true);
  };
  const confirmPurchase = (event: React.FormEvent) => {
    event.preventDefault();
    setPurchaseOpen(false);
    setSelected([]);
    setPin("");
    setSuccess(true);
    window.setTimeout(() => setSuccess(false), 4200);
  };
  const openNewGroup = () => {
    setEditingGroup(null);
    setGroupOpen(true);
  };
  const openEditGroup = (group: ResourceGroup) => {
    setEditingGroup(group);
    setGroupOpen(true);
  };
  const saveGroup = async (group: ResourceGroup) => {
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: group.id.startsWith("group-") ? undefined : group.id,
        name: group.name,
        accent: group.accent,
        products: group.products,
        memberEmails: group.memberEmails || [],
      }),
    });
    if (!response.ok) throw new Error("分组保存失败");
    await loadGroups();
    setActiveGroup(group.name);
    setGroupOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-[#172033]">
      <aside
        className={`${mobileNav ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col bg-[#172a52] text-white transition-transform lg:translate-x-0`}
      >
        <div className="flex h-[82px] items-center justify-between border-b border-white/10 px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#172a52]">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-wide">LUMEN</p>
              <p className="text-[10px] tracking-[.2em] text-blue-200">
                RESOURCE HUB
              </p>
            </div>
          </div>
          <button className="lg:hidden" onClick={() => setMobileNav(false)}>
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 px-3 py-6 text-sm">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.18em] text-blue-200/70">
            员工工作台
          </p>
          <NavItem
            icon={<LayoutDashboard size={18} />}
            label="资源商城"
            active={view === "store"}
            onClick={() => setView("store")}
          />
          <NavItem
            icon={<PackageCheck size={18} />}
            label="我的购买"
            active={view === "history"}
            onClick={() => setView("history")}
          />
          <NavItem
            icon={<Archive size={18} />}
            label="库存仓库"
            active={view === "warehouse"}
            onClick={() => setView("warehouse")}
          />
          <NavItem
            icon={<ReceiptText size={18} />}
            label="全球地址证明模版库"
            active={view === "templates"}
            onClick={() => setView("templates")}
          />
          <NavItem
            icon={<ReceiptText size={18} />}
            label="地址证明生成器"
            active={view === "samples"}
            onClick={() => setView("samples")}
          />
          {isAdmin && (
            <>
              <p className="mt-7 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.18em] text-blue-200/70">
                管理员
              </p>
              <NavItem
                icon={<Heart size={18} />}
                label="我的收藏"
                badge={String(favorites.length)}
                active={view === "favorites"}
                onClick={() => setView("favorites")}
              />
              <NavItem
                icon={<WalletCards size={18} />}
                label="额度明细"
                active={view === "quota"}
                onClick={() => setView("quota")}
              />
              <NavItem
                icon={<Users size={18} />}
                label="账号与额度"
                active={view === "admin"}
                onClick={() => setView("admin")}
              />
              <NavItem
                icon={<Folder size={18} />}
                label="国家分组管理"
                onClick={() => {
                  setView("store");
                  openNewGroup();
                }}
              />
              <NavItem
                icon={<Database size={18} />}
                label="供应商同步"
                active={view === "sync"}
                onClick={() => setView("sync")}
              />
              <NavItem
                icon={<Clock3 size={18} />}
                label="全部购买记录"
                active={view === "history"}
                onClick={() => setView("history")}
              />
            </>
          )}
        </nav>
        {isAdmin && (
          <div className="m-3 rounded-2xl bg-white/[.07] p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-blue-100">供应方式</span>
              <ShieldCheck size={15} className="text-[#72d6b3]" />
            </div>
            <p className="text-lg font-semibold">API + 库存仓库</p>
            <p className="mt-1.5 text-[11px] leading-5 text-blue-200">
              API 平台按额度购买；无 API 平台库存认领不限额度
            </p>
          </div>
        )}
        {isAdmin && (
          <button
            onClick={() => setView("security")}
            className={`${view === "security" ? "bg-white/10 text-white" : "text-blue-100 hover:bg-white/[.06]"} m-3 mt-0 flex items-center gap-3 rounded-xl px-4 py-3 text-sm`}
          >
            <Settings size={17} /> 安全与支付设置
          </button>
        )}
      </aside>
      {mobileNav && (
        <button
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileNav(false)}
        />
      )}

      <main className="lg:pl-[244px]">
        <header className="sticky top-0 z-20 flex h-[82px] items-center gap-4 border-b border-[#e6eaf1] bg-white/90 px-5 backdrop-blur-xl md:px-8">
          <button
            className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="relative max-w-[430px] flex-1">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              size={17}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索国家、套餐或供应商…"
              className="h-11 w-full rounded-xl border border-[#e2e7ef] bg-[#f8fafc] pl-10 pr-4 text-sm outline-none transition focus:border-[#87a3d9] focus:bg-white focus:ring-4 focus:ring-blue-50"
            />
          </div>
          <div className="ml-auto flex items-center gap-2 md:gap-4">
            <button className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#e6eaf1] text-slate-500">
              <Bell size={18} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#f2784b] ring-2 ring-white" />
            </button>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div className="relative">
              <button
                onClick={() => setUserMenu((open) => !open)}
                className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-slate-50"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf0ff] text-sm font-semibold text-[#31559b]">
                  {overview.viewer?.displayName?.slice(0, 1).toUpperCase() ||
                    "U"}
                </span>
                <span className="hidden text-left md:block">
                  <span className="block max-w-36 truncate text-sm font-medium">
                    {overview.viewer?.displayName || "正在识别账号"}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {isAdmin
                      ? "资源管理员 · 全部权限"
                      : "员工账号 · 仅本人资源"}
                  </span>
                </span>
                <ChevronDown
                  className={`${userMenu ? "rotate-180" : ""} hidden text-slate-400 transition md:block`}
                  size={15}
                />
              </button>
              {userMenu && (
                <div className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="border-b border-slate-100 px-3 py-3">
                    <p className="truncate text-sm font-semibold">
                      {overview.viewer?.displayName}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {overview.viewer?.email}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setView("history");
                      setUserMenu(false);
                    }}
                    className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <UserCircle size={16} />
                    我的资源
                  </button>
                  <button
                    onClick={() => {
                      setView("security");
                      setUserMenu(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <KeyRound size={16} />
                    安全与支付设置
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        setView("admin");
                        setUserMenu(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50"
                    >
                      <Settings size={16} />
                      管理员控制台
                    </button>
                  )}
                  <a
                    href="/signout-with-chatgpt?return_to=%2F"
                    target="_top"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#bd5947] hover:bg-[#fff4f1]"
                  >
                    <LogOut size={16} />
                    退出登录
                  </a>
                </div>
              )}
            </div>
          </div>
        </header>

        {(view === "store" || view === "favorites") && (
          <StoreView
            activeGroup={activeGroup}
            setActiveGroup={setActiveGroup}
            visibleProducts={visibleProducts}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            selected={selected}
            toggleSelected={toggleSelected}
            openPurchase={openPurchase}
            connected={overview.connected}
            syncing={syncing}
            catalogTotal={catalogTotal}
            historyTotal={overview.history?.total || 0}
            groups={groups}
            onNewGroup={openNewGroup}
            onEditGroup={openEditGroup}
            favoriteOnly={view === "favorites"}
            showFavorites={() => setView("favorites")}
            minDataGb={minDataGb}
            setMinDataGb={setMinDataGb}
            maxDuration={maxDuration}
            setMaxDuration={setMaxDuration}
            maxPrice={maxPrice}
            setMaxPrice={setMaxPrice}
            isAdmin={isAdmin}
            hasMore={catalogHasMore}
            loadMore={() => setCatalogOffset((offset) => offset + 100)}
          />
        )}
        {view === "history" && <HistoryView overview={overview} />}
        {view === "warehouse" && <WarehouseView />}
        {view === "samples" && <SupplierTemplateLibrary key="address-generator" selectionMode initialTemplateId={addressTemplateId} onChooseTemplate={setAddressTemplateId} />}
        {view === "templates" && <SupplierTemplateLibrary key="global-library" onChooseTemplate={(id) => { setAddressTemplateId(id); setView("samples"); }} />}
        {view === "admin" && isAdmin && <AdminView overview={overview} />}
        {view === "quota" && <QuotaView overview={overview} />}
        {view === "sync" && isAdmin && <SupplierSyncView overview={overview} />}
        {view === "security" && <SecurityView overview={overview} />}
      </main>

      {selected.length > 0 && !purchaseOpen && (
        <div className="fixed bottom-5 left-1/2 z-30 flex w-[calc(100%-32px)] max-w-[620px] -translate-x-1/2 items-center gap-4 rounded-2xl bg-[#172a52] px-5 py-4 text-white shadow-2xl lg:left-[calc(50%+122px)]">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10">
            <ShoppingBag size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              已选择 {selected.length} 个套餐
            </p>
            <p className="mt-0.5 text-[11px] text-blue-200">
              结算时从供应商获取实时价格
            </p>
          </div>
          <button
            onClick={() => setSelected([])}
            className="text-xs text-blue-200 hover:text-white"
          >
            清空
          </button>
          <button
            onClick={() => openPurchase()}
            className="rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-[#172a52]"
          >
            批量购买
          </button>
        </div>
      )}

      {purchaseOpen && (
        <PurchaseModal
          count={selected.length || 1}
          pin={pin}
          setPin={setPin}
          close={() => setPurchaseOpen(false)}
          confirm={confirmPurchase}
        />
      )}
      {groupOpen && (
        <GroupModal
          group={editingGroup}
          close={() => setGroupOpen(false)}
          save={saveGroup}
        />
      )}
      {success && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 rounded-2xl bg-[#173f35] px-5 py-4 text-sm font-medium text-white shadow-2xl">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15">
            <Check size={16} />
          </span>
          购买确认流程验证完成（未产生真实订单）
        </div>
      )}
    </div>
  );
}

type StoreViewProps = {
  activeGroup: string;
  setActiveGroup: (value: string) => void;
  visibleProducts: Product[];
  favorites: string[];
  toggleFavorite: (id: string) => void;
  selected: string[];
  toggleSelected: (id: string) => void;
  openPurchase: (id: string) => void;
  connected: boolean;
  syncing: boolean;
  catalogTotal: number;
  historyTotal: number;
  groups: ResourceGroup[];
  onNewGroup: () => void;
  onEditGroup: (group: ResourceGroup) => void;
  favoriteOnly: boolean;
  showFavorites: () => void;
  minDataGb: string;
  setMinDataGb: (value: string) => void;
  maxDuration: string;
  setMaxDuration: (value: string) => void;
  maxPrice: string;
  setMaxPrice: (value: string) => void;
  isAdmin: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

function StoreView(props: StoreViewProps) {
  const {
    activeGroup,
    setActiveGroup,
    visibleProducts,
    favorites,
    toggleFavorite,
    selected,
    toggleSelected,
    openPurchase,
    connected,
    syncing,
    catalogTotal,
    groups,
    onNewGroup,
    onEditGroup,
    favoriteOnly,
    showFavorites,
    minDataGb,
    setMinDataGb,
    maxDuration,
    setMaxDuration,
    maxPrice,
    setMaxPrice,
    isAdmin,
    hasMore,
    loadMore,
  } = props;
  const filtersActive =
    minDataGb !== "0" || maxDuration !== "0" || maxPrice !== "0";
  const canBuyProduct = (product: Product) =>
    isAdmin ||
    groups.some(
      (group) => group.canPurchase && group.productIds.includes(product.id),
    );
  return (
    <div className="mx-auto max-w-[1480px] px-5 py-6 md:px-8 md:py-8">
      <section className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
            {favoriteOnly
              ? "我的收藏"
              : isAdmin
                ? "资源商城"
                : "我的专属资源区"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            {favoriteOnly
              ? "常用套餐"
              : isAdmin
                ? "选择需要的资源"
                : "选择已获授权的资源"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {isAdmin
              ? "价格、流量、有效期和运营商均来自供应商实时目录。"
              : "管理员为你配置专属区域；已授权区域可购买，其他区域仅供查看。"}
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={onNewGroup}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1d3b72] px-4 text-xs font-medium text-white"
            >
              <FolderPlus size={15} />
              新建业务分组
            </button>
          )}
          <button
            onClick={showFavorites}
            className={`${favoriteOnly ? "border-[#d8755d] bg-[#fff2ee] text-[#c65c45]" : "border-slate-200 bg-white text-slate-600"} inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-medium`}
          >
            <Heart size={15} fill={favoriteOnly ? "currentColor" : "none"} />
            收藏 {favorites.length}
          </button>
        </div>
      </section>

      {isAdmin && (
        <section className="mb-5 grid gap-3 sm:grid-cols-2">
          <Metric
            icon={<Database size={18} />}
            iconClass="bg-[#edf2ff] text-[#4266b2]"
            label="供应商匹配总数"
            value={syncing ? "同步中" : `${catalogTotal} 个`}
            note="页面每次加载 100 个，可继续加载全部"
          />
          <Metric
            icon={<Folder size={18} />}
            iconClass="bg-[#e9f7f1] text-[#208267]"
            label="手动业务分组"
            value={`${Math.max(0, groups.length - 1)} 个`}
            note="分组商品由管理员逐项添加"
          />
        </section>
      )}

      <section className="mb-4 rounded-2xl border border-[#e3e8f0] bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveGroup("全部资源")}
            className={`${activeGroup === "全部资源" ? "bg-[#1d3b72] text-white" : "bg-[#f3f6fa] text-slate-600"} h-9 rounded-xl px-4 text-xs font-medium`}
          >
            全部资源
          </button>
          {groups
            .filter((group) => group.id !== "all")
            .map((group) => (
              <div
                key={group.id}
                className={`${activeGroup === group.name ? "border-[#5879b2] bg-[#eef3fb]" : "border-transparent bg-[#f6f8fb]"} flex h-9 items-center rounded-xl border`}
              >
                <button
                  onClick={() => setActiveGroup(group.name)}
                  className="flex h-full items-center gap-2 px-4 text-xs font-medium text-slate-700"
                >
                  <span>{group.name}</span>
                  <span className="text-[10px] text-slate-400">
                    {group.productIds.length}
                  </span>
                  {!isAdmin && (
                    <span
                      className={`${group.canPurchase ? "bg-[#dff5eb] text-[#187158]" : "bg-slate-200 text-slate-500"} rounded-full px-1.5 py-0.5 text-[9px]`}
                    >
                      {group.canPurchase ? "可购买" : "仅查看"}
                    </span>
                  )}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => onEditGroup(group)}
                    className="mr-1 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-[#315c9f]"
                    title="编辑分组商品和成员权限"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            ))}
          {groups.length === 1 && (
            <span className="px-2 text-xs text-slate-400">
              {isAdmin
                ? "尚未建立业务分组，可点击右上角创建"
                : "管理员尚未配置业务分组"}
            </span>
          )}
        </div>
      </section>

      <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-[#e3e8f0] bg-white p-4 lg:flex-row lg:items-end">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-600">
          <Filter size={14} />
          快速筛选
          {filtersActive && (
            <span className="rounded-full bg-[#eaf1fd] px-2 py-0.5 text-[10px] text-[#4267ae]">
              已启用
            </span>
          )}
        </div>
        <div className="grid flex-[3] gap-3 sm:grid-cols-3">
          <FilterSelect
            value={minDataGb}
            onChange={setMinDataGb}
            label="最低流量"
            options={[
              { value: "0", label: "不限流量" },
              { value: "1", label: "至少 1GB" },
              { value: "5", label: "至少 5GB" },
              { value: "10", label: "至少 10GB" },
              { value: "20", label: "至少 20GB" },
            ]}
          />
          <FilterSelect
            value={maxDuration}
            onChange={setMaxDuration}
            label="最长有效期"
            options={[
              { value: "0", label: "不限有效期" },
              { value: "7", label: "7 天以内" },
              { value: "15", label: "15 天以内" },
              { value: "30", label: "30 天以内" },
              { value: "90", label: "90 天以内" },
            ]}
          />
          <FilterSelect
            value={maxPrice}
            onChange={setMaxPrice}
            label="最高价格"
            options={[
              { value: "0", label: "不限价格" },
              { value: "5", label: "$5 以下" },
              { value: "10", label: "$10 以下" },
              { value: "20", label: "$20 以下" },
              { value: "50", label: "$50 以下" },
            ]}
          />
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {favoriteOnly ? "收藏的套餐" : activeGroup}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            已显示 {visibleProducts.length} / {catalogTotal} 个结果
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span
            className={`${connected ? "bg-[#39aa80]" : "bg-[#e7a94d]"} h-2 w-2 rounded-full`}
          />
          {syncing ? "正在读取" : connected ? "实时目录" : "同步暂不可用"}
        </div>
      </div>
      {visibleProducts.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleProducts.map((product) => (
            <SimpleProductCard
              key={product.id}
              product={product}
              favorite={favorites.includes(product.id)}
              selected={selected.includes(product.id)}
              canPurchase={canBuyProduct(product)}
              toggleFavorite={() => toggleFavorite(product.id)}
              toggleSelected={() => toggleSelected(product.id)}
              buy={() => openPurchase(product.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
          {syncing
            ? "正在加载供应商资源…"
            : favoriteOnly
              ? "还没有收藏任何套餐"
              : "当前分组没有符合条件的资源"}
        </div>
      )}
      {hasMore && !favoriteOnly && (
        <div className="mt-6 text-center">
          <button
            disabled={syncing}
            onClick={loadMore}
            className="h-11 rounded-xl border border-[#cad7ea] bg-white px-7 text-sm font-medium text-[#315c9f] shadow-sm disabled:opacity-50"
          >
            {syncing
              ? "正在加载"
              : `继续加载（还剩 ${Math.max(0, catalogTotal - visibleProducts.length)} 个）`}
          </button>
        </div>
      )}
    </div>
  );
}

function SimpleProductCard({
  product,
  favorite,
  selected,
  canPurchase,
  toggleFavorite,
  toggleSelected,
  buy,
}: {
  product: Product;
  favorite: boolean;
  selected: boolean;
  canPurchase: boolean;
  toggleFavorite: () => void;
  toggleSelected: () => void;
  buy: () => void;
}) {
  return (
    <article
      className={`${selected ? "border-[#6385bd] ring-2 ring-[#dce6f6]" : "border-[#e5e9f0]"} flex min-h-[250px] flex-col rounded-2xl border bg-white p-4 shadow-[0_3px_14px_rgba(28,48,82,.035)]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xs font-bold ${product.tone}`}
          >
            {product.flag}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {product.country}
            </p>
            <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
              {product.name}
            </h3>
          </div>
        </div>
        <button
          onClick={toggleFavorite}
          className={`${favorite ? "bg-[#fff0ec] text-[#e36b50]" : "bg-slate-50 text-slate-400"} grid h-8 w-8 shrink-0 place-items-center rounded-lg`}
          aria-label="收藏套餐"
        >
          <Heart size={14} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
        <span
          className={`${canPurchase ? "bg-[#e5f6ef] text-[#187158]" : "bg-slate-100 text-slate-500"} rounded-md px-2 py-1 font-medium`}
        >
          {canPurchase ? "已授权购买" : "仅查看"}
        </span>
        <span className="rounded-md bg-[#f3f6fa] px-2 py-1">
          {product.data}
        </span>
        <span className="rounded-md bg-[#f3f6fa] px-2 py-1">
          {product.validity}
        </span>
        {product.operators?.slice(0, 2).map((operator) => (
          <span
            key={`${operator.name}-${operator.networkType}`}
            className="rounded-md bg-[#eef4ff] px-2 py-1 text-[#4267ae]"
          >
            {operator.name}
          </span>
        ))}
      </div>
      <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-500">
        {product.description}
      </p>
      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
        <label
          className={`${canPurchase ? "cursor-pointer" : "cursor-not-allowed"} flex items-center gap-2 text-[10px] text-slate-400`}
        >
          <input
            disabled={!canPurchase}
            type="checkbox"
            checked={selected}
            onChange={toggleSelected}
            className="h-3.5 w-3.5 accent-[#315c9f] disabled:opacity-40"
          />
          批量选择
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[#294d88]">
            {formatMoney(product.price, product.currency)}
          </span>
          <button
            disabled={!canPurchase}
            onClick={buy}
            className="rounded-lg bg-[#1d3b72] px-3 py-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {canPurchase ? "购买" : "未授权"}
          </button>
        </div>
      </div>
    </article>
  );
}

function LegacyStoreView(props: {
  activeGroup: string;
  setActiveGroup: (value: string) => void;
  visibleProducts: Product[];
  favorites: string[];
  toggleFavorite: (id: string) => void;
  selected: string[];
  toggleSelected: (id: string) => void;
  openPurchase: (id: string) => void;
  connected: boolean;
  syncing: boolean;
  catalogTotal: number;
  historyTotal: number;
  groups: ResourceGroup[];
  onNewGroup: () => void;
  onEditGroup: (group: ResourceGroup) => void;
  favoriteOnly: boolean;
  showFavorites: () => void;
  minDataGb: string;
  setMinDataGb: (value: string) => void;
  maxDuration: string;
  setMaxDuration: (value: string) => void;
  maxPrice: string;
  setMaxPrice: (value: string) => void;
}) {
  const {
    activeGroup,
    setActiveGroup,
    visibleProducts,
    favorites,
    toggleFavorite,
    selected,
    toggleSelected,
    openPurchase,
    connected,
    syncing,
    catalogTotal,
    historyTotal,
    groups,
    onNewGroup,
    onEditGroup,
    favoriteOnly,
    showFavorites,
    minDataGb,
    setMinDataGb,
    maxDuration,
    setMaxDuration,
    maxPrice,
    setMaxPrice,
  } = props;
  const filtersActive =
    minDataGb !== "0" || maxDuration !== "0" || maxPrice !== "0";
  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
            {favoriteOnly ? "我的收藏" : "员工资源商城"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            {favoriteOnly ? "常用套餐快捷入口" : "按需购买全球数字资源"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            支持按国家、流量、有效期和价格筛选，套餐运营商来自供应商实时目录。
          </p>
        </div>
        <button
          onClick={showFavorites}
          className={`${favoriteOnly ? "border-[#d8755d] bg-[#fff2ee] text-[#c65c45]" : "border-slate-200 bg-white text-slate-600"} inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium`}
        >
          <Heart size={16} fill={favoriteOnly ? "currentColor" : "none"} />{" "}
          收藏夹{" "}
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px]">
            {favorites.length}
          </span>
        </button>
      </section>
      <section className="mb-7 grid gap-4 sm:grid-cols-3">
        <Metric
          icon={<WalletCards size={19} />}
          iconClass="bg-[#edf2ff] text-[#4266b2]"
          label="eSIMAccess 可用额度"
          value="待管理员分配"
          note="每个供应平台独立设置额度"
        />
        <Metric
          icon={<ShoppingBag size={19} />}
          iconClass="bg-[#e9f7f1] text-[#208267]"
          label="当前账号可见资源"
          value={`${historyTotal} 件`}
          note="管理员看全部，员工仅看本人购买"
        />
        <Metric
          icon={<Zap size={19} />}
          iconClass="bg-[#fff3e9] text-[#dc702b]"
          label="当前匹配套餐"
          value={catalogTotal ? `${catalogTotal} 个` : "同步中"}
          note="价格、运营商和规格来自 eSIMAccess"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[20px] border border-[#e5e9f0] bg-white p-4 shadow-[0_4px_24px_rgba(28,48,82,.04)]">
          <div className="mb-3 flex items-center justify-between px-2">
            <div>
              <p className="text-sm font-semibold">国家与项目分组</p>
              <p className="mt-1 text-[11px] text-slate-400">
                点击铅笔可编辑分组
              </p>
            </div>
            <button
              onClick={onNewGroup}
              className="grid h-8 w-8 place-items-center rounded-lg bg-[#eef3fb] text-[#3b609f]"
              title="新建分组"
            >
              <FolderPlus size={15} />
            </button>
          </div>
          <div className="space-y-1">
            {groups.map((group) => (
              <div
                key={group.id}
                className={`${activeGroup === group.name ? "bg-[#eef3fb] text-[#264c8c]" : "text-slate-600 hover:bg-slate-50"} group/row flex items-center rounded-xl transition`}
              >
                <button
                  onClick={() => setActiveGroup(group.name)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm"
                >
                  <span
                    className={`${group.accent} h-2 w-2 shrink-0 rounded-full`}
                  />
                  <span className="truncate">{group.name}</span>
                  <span className="ml-auto text-[10px] text-slate-400">
                    {group.productIds.length || "全部"}
                  </span>
                </button>
                {group.id !== "all" && (
                  <button
                    onClick={() => onEditGroup(group)}
                    className="mr-2 grid h-7 w-7 place-items-center rounded-lg text-slate-400 opacity-100 hover:bg-white hover:text-[#4168ab] xl:opacity-0 xl:group-hover/row:opacity-100"
                    title="编辑分组"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              onClick={onNewGroup}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[#4267ae] hover:bg-blue-50"
            >
              <Plus size={14} />
              新建国家分组
            </button>
          </div>
        </aside>

        <div>
          <div className="mb-4 rounded-2xl border border-[#e3e8f0] bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <Filter size={14} />
              套餐筛选
              {filtersActive && (
                <span className="rounded-full bg-[#eaf1fd] px-2 py-0.5 text-[10px] text-[#4267ae]">
                  已启用
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FilterSelect
                value={minDataGb}
                onChange={setMinDataGb}
                label="最低流量"
                options={[
                  { value: "0", label: "不限流量" },
                  { value: "1", label: "至少 1GB" },
                  { value: "5", label: "至少 5GB" },
                  { value: "10", label: "至少 10GB" },
                  { value: "20", label: "至少 20GB" },
                ]}
              />
              <FilterSelect
                value={maxDuration}
                onChange={setMaxDuration}
                label="最长有效期"
                options={[
                  { value: "0", label: "不限有效期" },
                  { value: "7", label: "7 天以内" },
                  { value: "15", label: "15 天以内" },
                  { value: "30", label: "30 天以内" },
                  { value: "90", label: "90 天以内" },
                ]}
              />
              <FilterSelect
                value={maxPrice}
                onChange={setMaxPrice}
                label="最高价格"
                options={[
                  { value: "0", label: "不限价格" },
                  { value: "5", label: "$5 以下" },
                  { value: "10", label: "$10 以下" },
                  { value: "20", label: "$20 以下" },
                  { value: "50", label: "$50 以下" },
                ]}
              />
            </div>
          </div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                {favoriteOnly ? "收藏的套餐" : activeGroup}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                当前展示 {visibleProducts.length} 个 · 全量目录服务端搜索
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#dfe6f0] bg-white px-3 py-2 text-xs text-slate-500">
              <span
                className={`${connected ? "bg-[#39aa80]" : "bg-[#e7a94d]"} h-2 w-2 rounded-full`}
              />
              {syncing
                ? "正在筛选"
                : connected
                  ? "eSIMAccess 已连接"
                  : "同步暂不可用"}
            </div>
          </div>
          {visibleProducts.length ? (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  favorite={favorites.includes(product.id)}
                  selected={selected.includes(product.id)}
                  toggleFavorite={() => toggleFavorite(product.id)}
                  toggleSelected={() => toggleSelected(product.id)}
                  buy={() => openPurchase(product.id)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
              {favoriteOnly
                ? "还没有收藏任何套餐，点击套餐右上角的爱心即可收藏。"
                : "没有找到符合条件的套餐，请调整搜索或筛选条件。"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-[#f8fafc] px-3 text-xs outline-none focus:border-[#87a3d9]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResourceStatusPicker({
  items,
  onManage,
}: {
  items: PurchaseHistoryItem[];
  onManage: (item: PurchaseHistoryItem) => void;
}) {
  const [resourceId, setResourceId] = useState("");
  const selectedItem = items.find((item) => item.esimTranNo === resourceId);
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#eadfd7] bg-[#fffaf6] p-4 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1">
        <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-[#9d7157]">
          异常状态归类
        </span>
        <select
          value={resourceId}
          onChange={(event) => setResourceId(event.target.value)}
          className="h-10 w-full rounded-xl border border-[#eadfd7] bg-white px-3 text-xs outline-none"
        >
          <option value="">选择要标记或恢复的 eSIM / 手机号码</option>
          {items.slice(0, 200).map((item) => (
            <option key={item.esimTranNo} value={item.esimTranNo}>
              {item.availabilityStatus === "temporary_unavailable"
                ? "[暂不可用] "
                : ""}
              {item.packageName} · {item.msisdn || maskIdentifier(item.iccid)} ·{" "}
              {item.esimTranNo}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!selectedItem}
        onClick={() => selectedItem && onManage(selectedItem)}
        className="h-10 shrink-0 rounded-xl bg-[#7d4d3b] px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {selectedItem?.availabilityStatus === "temporary_unavailable"
          ? "恢复为可用"
          : "标记暂时无法使用"}
      </button>
    </div>
  );
}

function HistoryView({ overview }: { overview: PlatformOverview }) {
  const items = overview.history?.items || [];
  const isAdmin = Boolean(overview.viewer?.isAdmin);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<PurchaseHistoryItem | null>(null);
  const [renewTargets, setRenewTargets] = useState<PurchaseHistoryItem[]>([]);
  const [status, setStatus] = useState("all");
  const [resourceQuery, setResourceQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [statusTarget, setStatusTarget] = useState<ResourceStatusTarget | null>(
    null,
  );
  const [availabilityOverrides, setAvailabilityOverrides] = useState<
    Record<
      string,
      { status: string; note: string | null; recheckAt: string | null }
    >
  >({});
  const decoratedItems = items.map((item) => {
    const override = availabilityOverrides[item.esimTranNo];
    return override
      ? {
          ...item,
          availabilityStatus: override.status,
          availabilityNote: override.note,
          availabilityRecheckAt: override.recheckAt,
        }
      : item;
  });
  const visibleItems = decoratedItems.filter((item) => {
    const matchesStatus =
      status === "all" ||
      (status === "temporary_unavailable"
        ? item.availabilityStatus === "temporary_unavailable"
        : status === "active"
          ? ["GOT_RESOURCE", "IN_USE"].includes(item.esimStatus) &&
            item.availabilityStatus !== "temporary_unavailable"
          : status === "expiring"
            ? (daysUntil(item.expiredTime) ?? 999) <= 30
            : item.esimStatus === status);
    const haystack =
      `${item.packageName} ${item.orderNo} ${item.esimTranNo} ${item.iccid || ""} ${item.msisdn || ""} ${item.locationCode || ""}`.toLowerCase();
    return (
      matchesStatus &&
      (!resourceQuery.trim() ||
        haystack.includes(resourceQuery.trim().toLowerCase()))
    );
  });
  const renewableItems = decoratedItems.filter(
    (item) => item.iccid && (daysUntil(item.expiredTime) ?? 1) >= 0,
  );
  const expiringItems = decoratedItems.filter((item) => {
    const days = daysUntil(item.expiredTime);
    return days !== null && days >= 0 && days <= 30;
  });
  const unavailableItems = decoratedItems.filter(
    (item) => item.availabilityStatus === "temporary_unavailable",
  );
  const selectedItems = decoratedItems.filter((item) =>
    selected.includes(item.esimTranNo),
  );
  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const toggleAll = () =>
    setSelected((current) =>
      current.length === visibleItems.length
        ? []
        : visibleItems.map((item) => item.esimTranNo),
    );
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4200);
  };
  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
            {isAdmin ? "主账号全部资源" : "我的资源"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            已购买产品与交付信息
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {isAdmin
              ? "管理员可查看供应商主账号内的全部历史产品与二维码。"
              : "仅显示当前账号在本站购买的产品、二维码和续订信息。"}
          </p>
        </div>
        <button
          disabled={!selectedItems.length}
          onClick={() =>
            setRenewTargets(
              selectedItems.filter(
                (item) => item.iccid && (daysUntil(item.expiredTime) ?? 1) >= 0,
              ),
            )
          }
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1d3b72] px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw size={16} />
          批量续订 {selectedItems.length ? `(${selectedItems.length})` : ""}
        </button>
      </section>
      {isAdmin ? (
        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={<PackageCheck size={19} />}
            iconClass="bg-[#edf2ff] text-[#4266b2]"
            label="主账号已同步资源"
            value={`${items.length} 件`}
            note={`供应商共返回 ${overview.history?.supplierTotal ?? items.length} 件`}
          />
          <Metric
            icon={<RefreshCw size={19} />}
            iconClass="bg-[#e9f7f1] text-[#208267]"
            label="当前可续订"
            value={`${renewableItems.length} 件`}
            note="逐张 ICCID 匹配原套餐"
          />
          <Metric
            icon={<AlertTriangle size={19} />}
            iconClass="bg-[#fff3e9] text-[#dc702b]"
            label="30 天内到期"
            value={`${expiringItems.length} 件`}
            note="Telegram 将在到期前 5 天提醒管理员"
          />
          <Metric
            icon={<AlertTriangle size={19} />}
            iconClass="bg-[#fff0ee] text-[#bd604e]"
            label="暂时无法使用"
            value={`${unavailableItems.length} 件`}
            note="按 24/48 小时复查归类"
          />
        </section>
      ) : (
        <section className="mb-5 flex flex-wrap gap-x-6 gap-y-2 rounded-2xl border border-[#e5e9f0] bg-white px-5 py-4 text-sm">
          <span>
            <strong className="text-[#294d88]">{items.length}</strong>{" "}
            个我的资源
          </span>
          <span>
            <strong className="text-[#208267]">{renewableItems.length}</strong>{" "}
            个可续订
          </span>
          {unavailableItems.length > 0 && (
            <span>
              <strong className="text-[#bd604e]">
                {unavailableItems.length}
              </strong>{" "}
              个暂时无法使用
            </span>
          )}
        </section>
      )}
      <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#e3e8f0] bg-white p-4 md:flex-row md:items-end">
        <label className="flex-1">
          <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-slate-400">
            搜索已购资源
          </span>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={15}
            />
            <input
              value={resourceQuery}
              onChange={(event) => setResourceQuery(event.target.value)}
              placeholder="套餐、订单号、ICCID、手机号…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-[#f8fafc] pl-9 pr-3 text-xs outline-none focus:border-[#87a3d9]"
            />
          </div>
        </label>
        <FilterSelect
          value={status}
          onChange={setStatus}
          label="资源状态"
          options={[
            { value: "all", label: "全部状态" },
            { value: "temporary_unavailable", label: "暂时无法使用" },
            { value: "active", label: "可用/使用中" },
            { value: "expiring", label: "30 天内到期" },
            { value: "USED_UP", label: "流量已用尽" },
            { value: "USED_EXPIRED", label: "已过期" },
          ]}
        />
      </section>
      <ResourceStatusPicker
        items={visibleItems}
        onManage={(item) =>
          setStatusTarget({
            supplier: "eSIMAccess",
            resourceId: item.esimTranNo,
            name: item.packageName,
            currentStatus: item.availabilityStatus,
            note: item.availabilityNote,
          })
        }
      />
      <PurchaseTable
        items={visibleItems}
        total={overview.history?.total || 0}
        selected={selected}
        toggleSelected={toggleSelected}
        toggleAll={toggleAll}
        onDetail={setDetail}
        onRenew={(item) => setRenewTargets([item])}
        manageable
      />
      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <LifecycleNote
          icon={<QrCode size={18} />}
          title="交付信息完整同步"
          text="供应商返回二维码、AC 激活码、ICCID、IMSI、MSISDN、EID、PIN/PUK 和 APN 时，本站统一展示并支持复制。"
        />
        <LifecycleNote
          icon={<CalendarDays size={18} />}
          title="到期与流量提醒"
          text="资源进入 30 天到期窗口或余量不足时标记提醒；后续接入 Webhook 后可发送站内通知。"
        />
        <LifecycleNote
          icon={<RefreshCw size={18} />}
          title="兼容套餐续订"
          text="续订前按 ICCID 实时查询兼容套餐，过期资源不允许充值，批量续订按供应商拆单处理。"
        />
      </section>
      {detail && (
        <ResourceDetailModal
          item={detail}
          close={() => setDetail(null)}
          renew={() => {
            setDetail(null);
            setRenewTargets([detail]);
          }}
          notify={notify}
        />
      )}
      {!!renewTargets.length && (
        <RenewModal
          items={renewTargets}
          close={() => setRenewTargets([])}
          complete={() => {
            setRenewTargets([]);
            setSelected([]);
            notify(
              `已完成 ${renewTargets.length} 项续订确认（当前未向供应商产生付费订单）`,
            );
          }}
        />
      )}
      {statusTarget && (
        <ResourceStatusModal
          target={statusTarget}
          close={() => setStatusTarget(null)}
          saved={(next) => {
            setAvailabilityOverrides((current) => ({
              ...current,
              [statusTarget.resourceId]: next,
            }));
            setStatusTarget(null);
            notify(
              next.status === "temporary_unavailable"
                ? "已归类为暂时无法使用"
                : "已恢复为正常可用",
            );
          }}
        />
      )}
      {notice && (
        <div className="fixed bottom-6 right-6 z-[70] flex max-w-[420px] items-center gap-3 rounded-2xl bg-[#173f35] px-5 py-4 text-sm font-medium text-white shadow-2xl">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
    </div>
  );
}

function QuotaView({ overview }: { overview: PlatformOverview }) {
  const [transactions, setTransactions] = useState<
    Array<{
      id: string;
      platform: string;
      kind: string;
      amount: number;
      balanceAfter: number;
      currency: string;
      reference?: string | null;
      note?: string | null;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/quota/transactions")
      .then(
        (response) =>
          response.json() as Promise<{ items?: typeof transactions }>,
      )
      .then((data) => setTransactions(data.items || []))
      .finally(() => setLoading(false));
  }, []);
  const spent = transactions
    .filter((item) => item.amount < 0)
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
          额度明细
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
          分平台额度与使用流水
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          管理员分配的额度、购买扣款、续订扣款和退款都按供应平台独立记录。
        </p>
      </section>
      <section className="mb-7 grid gap-4 sm:grid-cols-3">
        <Metric
          icon={<WalletCards size={19} />}
          iconClass="bg-[#edf2ff] text-[#4266b2]"
          label="eSIMAccess 当前额度"
          value={
            transactions.length
              ? formatMoney(
                  transactions[0].balanceAfter,
                  transactions[0].currency,
                )
              : "待管理员分配"
          }
          note="员工额度不会超过供应商主账号余额"
        />
        <Metric
          icon={<CreditCard size={19} />}
          iconClass="bg-[#fff3e9] text-[#dc702b]"
          label="累计使用"
          value={formatMoney(spent, "USD")}
          note="购买与续订扣款合计"
        />
        <Metric
          icon={<ReceiptText size={19} />}
          iconClass="bg-[#e9f7f1] text-[#208267]"
          label="流水记录"
          value={`${transactions.length} 条`}
          note="每次额度变化均保留审计记录"
        />
      </section>
      <div className="rounded-[20px] border border-[#e5e9f0] bg-white p-5 md:p-7">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">额度流水</h2>
          <p className="mt-1 text-sm text-slate-500">
            仅显示当前登录账号的记录
          </p>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">
            正在读取额度流水…
          </div>
        ) : transactions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="pb-3 font-medium">时间</th>
                  <th className="pb-3 font-medium">平台</th>
                  <th className="pb-3 font-medium">类型</th>
                  <th className="pb-3 font-medium">关联单号</th>
                  <th className="pb-3 text-right font-medium">变动 / 余额</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="py-4 text-xs text-slate-500">
                      {formatDate(item.createdAt, true)}
                    </td>
                    <td className="py-4">{item.platform}</td>
                    <td className="py-4 text-slate-600">{item.kind}</td>
                    <td className="py-4 font-mono text-[11px] text-slate-400">
                      {item.reference || "—"}
                    </td>
                    <td className="py-4 text-right">
                      <p
                        className={
                          item.amount < 0 ? "text-[#c55e49]" : "text-[#208267]"
                        }
                      >
                        {item.amount > 0 ? "+" : ""}
                        {formatMoney(item.amount, item.currency)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        余额 {formatMoney(item.balanceAfter, item.currency)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center">
            <WalletCards className="mx-auto text-slate-300" size={34} />
            <p className="mt-4 text-sm font-medium text-slate-600">
              暂无额度流水
            </p>
            <p className="mt-2 text-xs text-slate-400">
              管理员分配额度后，充值、购买、续订和退款会显示在这里。
            </p>
          </div>
        )}
      </div>
      {overview.viewer?.isAdmin && (
        <div className="mt-5 rounded-xl bg-[#f4f7fd] p-4 text-xs text-[#425b88]">
          当前为管理员账号。员工额度分配入口位于“账号与额度”，供应商主账号余额不会直接成为员工可用额度。
        </div>
      )}
    </div>
  );
}

function SupplierSyncView({ overview }: { overview: PlatformOverview }) {
  const [snapshot, setSnapshot] = useState(overview);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      setSnapshot(
        await fetch("/api/esim/overview").then(
          (response) => response.json() as Promise<PlatformOverview>,
        ),
      );
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
            供应商同步
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            平台连接与数据同步状态
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            手动刷新余额、套餐目录和主账号全部历史产品。
          </p>
        </div>
        <button
          disabled={refreshing}
          onClick={refresh}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1d3b72] px-5 text-sm font-medium text-white disabled:opacity-50"
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
          {refreshing ? "正在同步" : "立即同步"}
        </button>
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[20px] border border-[#dce5f3] bg-white p-6">
          <div className="flex items-start justify-between">
            <div className="flex gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf2ff] font-semibold text-[#315c9f]">
                EA
              </span>
              <div>
                <h2 className="font-semibold">eSIMAccess</h2>
                <p className="mt-1 text-xs text-slate-500">
                  余额、套餐、运营商、二维码及历史资源
                </p>
              </div>
            </div>
            <span
              className={`${snapshot.connected ? "bg-[#e9f8f2] text-[#177359]" : "bg-[#fff1ed] text-[#b95c45]"} rounded-full px-3 py-1 text-[11px] font-medium`}
            >
              {snapshot.connected ? "连接正常" : "连接异常"}
            </span>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-4">
            <DetailMetric
              label="主账号余额"
              value={formatMoney(
                snapshot.balance?.amount,
                snapshot.balance?.currency,
              )}
            />
            <DetailMetric
              label="历史资源"
              value={`${snapshot.history?.supplierTotal ?? snapshot.history?.total ?? 0} 件`}
            />
            <DetailMetric
              label="上次同步"
              value={
                snapshot.syncedAt
                  ? formatDate(snapshot.syncedAt, true)
                  : "等待同步"
              }
            />
          </div>
          {snapshot.error && (
            <div className="mt-4 rounded-xl bg-[#fff4f1] p-4 text-xs text-[#a85b48]">
              {snapshot.error}
            </div>
          )}
        </div>
        <div className="rounded-[20px] border border-[#e5e9f0] bg-white p-6">
          <div className="flex gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f3edff] font-semibold text-[#7652b3]">
              GG
            </span>
            <div>
              <h2 className="font-semibold">eSIM.GG / TravelSIM</h2>
              <p className="mt-1 text-xs text-slate-500">等待商务 API 凭证</p>
            </div>
          </div>
          <div className="mt-7 rounded-xl bg-[#faf8ff] p-4 text-xs leading-5 text-slate-600">
            取得白标或批发 API
            后，将在此同步号码、余额、到期日、二维码和续订能力。
          </div>
          <a
            href="https://topconnect.com/sales-inquiries/"
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex text-xs font-semibold text-[#65479e]"
          >
            申请上游 API ↗
          </a>
        </div>
      </section>
      <section className="mt-6 rounded-[20px] border border-[#e5e9f0] bg-white p-6">
        <h2 className="text-lg font-semibold">同步范围</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SyncItem label="账户余额" ready />
          <SyncItem label="套餐与实时价格" ready />
          <SyncItem label="运营商网络" ready />
          <SyncItem label="全部历史产品" ready />
          <SyncItem label="二维码与激活码" ready />
          <SyncItem label="ICCID / IMSI / EID" ready />
          <SyncItem label="到期与用量" ready />
          <SyncItem label="兼容续订套餐" ready />
        </div>
      </section>
    </div>
  );
}

function SyncItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#f7f9fc] p-3 text-xs text-slate-600">
      <CheckCircle2
        size={15}
        className={ready ? "text-[#2a9a74]" : "text-slate-300"}
      />
      {label}
    </div>
  );
}

function SecurityView({ overview }: { overview: PlatformOverview }) {
  const [configured, setConfigured] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  useEffect(() => {
    fetch("/api/settings/security")
      .then((response) => response.json() as Promise<{ configured?: boolean }>)
      .then((data) => setConfigured(Boolean(data.configured)));
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (newPin !== confirmPin) {
      setMessage({ ok: false, text: "两次输入的新支付密码不一致" });
      return;
    }
    setSaving(true);
    const response = await fetch("/api/settings/security", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPin, newPin }),
    });
    const data = (await response.json()) as {
      configured?: boolean;
      error?: string;
    };
    setSaving(false);
    if (!response.ok) {
      setMessage({ ok: false, text: data.error || "保存失败" });
      return;
    }
    setConfigured(true);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setMessage({ ok: true, text: "支付密码已安全保存" });
  };
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
          安全中心
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
          安全与支付设置
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          管理当前登录账号的支付密码和敏感资源访问规则。
        </p>
      </section>
      <section className="grid gap-6 lg:grid-cols-[1fr_.75fr]">
        <form
          onSubmit={submit}
          className="rounded-[20px] border border-[#e5e9f0] bg-white p-6 md:p-7"
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">6位支付密码</h2>
              <p className="mt-1 text-sm text-slate-500">
                购买和批量续订时使用
              </p>
            </div>
            <span
              className={`${configured ? "bg-[#e9f8f2] text-[#177359]" : "bg-[#fff4e5] text-[#ae671c]"} rounded-full px-3 py-1 text-[11px] font-medium`}
            >
              {configured ? "已设置" : "未设置"}
            </span>
          </div>
          <div className="mt-6 space-y-4">
            {configured && (
              <PinInput
                label="当前支付密码"
                value={currentPin}
                setValue={setCurrentPin}
              />
            )}
            <PinInput
              label={configured ? "新支付密码" : "设置支付密码"}
              value={newPin}
              setValue={setNewPin}
            />
            <PinInput
              label="再次确认"
              value={confirmPin}
              setValue={setConfirmPin}
            />
            {message && (
              <div
                className={`${message.ok ? "bg-[#eef9f4] text-[#26775f]" : "bg-[#fff3ef] text-[#a85845]"} rounded-xl p-3 text-xs`}
              >
                {message.text}
              </div>
            )}
            <button
              disabled={
                saving ||
                newPin.length !== 6 ||
                confirmPin.length !== 6 ||
                (configured && currentPin.length !== 6)
              }
              className="h-11 w-full rounded-xl bg-[#1d3b72] text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving
                ? "正在保存"
                : configured
                  ? "更新支付密码"
                  : "启用支付密码"}
            </button>
          </div>
        </form>
        <div className="space-y-4">
          <div className="rounded-[20px] border border-[#dfe8fa] bg-[#f4f7fd] p-6">
            <ShieldCheck size={22} className="text-[#4267ae]" />
            <h3 className="mt-4 font-semibold">账号保护</h3>
            <p className="mt-2 text-xs leading-5 text-[#526b95]">
              密码经过高强度单向哈希后保存，后台无法查看明文。二维码和完整编号仅对购买人及管理员开放。
            </p>
          </div>
          <div className="rounded-[20px] border border-[#e5e9f0] bg-white p-6">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              当前账号
            </p>
            <p className="mt-2 text-sm font-semibold">
              {overview.viewer?.displayName}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {overview.viewer?.email}
            </p>
            <span className="mt-4 inline-flex rounded-full bg-[#eef3fb] px-3 py-1 text-[11px] text-[#4267ae]">
              {overview.viewer?.isAdmin ? "资源管理员" : "员工账号"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function PinInput({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      <input
        required
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) =>
          setValue(event.target.value.replace(/\D/g, "").slice(0, 6))
        }
        placeholder="请输入6位数字"
        className="h-12 w-full rounded-xl border border-slate-200 px-4 tracking-[.3em] outline-none focus:border-[#87a3d9] focus:ring-4 focus:ring-blue-50"
      />
    </label>
  );
}

function AdminView({ overview }: { overview: PlatformOverview }) {
  const balance = formatMoney(
    overview.balance?.amount,
    overview.balance?.currency,
  );
  const [telegram, setTelegram] = useState<{
    configured: boolean;
    botUsername?: string | null;
    maskedChatId?: string | null;
  } | null>(null);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const loadTelegram = () =>
    fetch("/api/settings/telegram")
      .then(
        (response) =>
          response.json() as Promise<{
            configured?: boolean;
            botUsername?: string | null;
            maskedChatId?: string | null;
          }>,
      )
      .then((data) =>
        setTelegram({
          configured: Boolean(data.configured),
          botUsername: data.botUsername,
          maskedChatId: data.maskedChatId,
        }),
      )
      .catch(() => setTelegram({ configured: false }));
  useEffect(() => {
    void loadTelegram();
  }, []);
  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
            管理员控制台
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            平台钱包、员工额度与购买记录
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            每个供应平台独立同步余额，再从对应平台钱包向员工分配额度。
          </p>
        </div>
        <button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1d3b72] px-5 text-sm font-medium text-white">
          <Plus size={17} /> 新增供应平台
        </button>
      </section>
      <section className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={<CircleDollarSign size={19} />}
          iconClass="bg-[#e9f7f1] text-[#208267]"
          label="eSIMAccess 账户余额"
          value={balance}
          note={
            overview.connected ? "已通过官方 API 实时同步" : "平台连接暂不可用"
          }
        />
        <Metric
          icon={<WalletCards size={19} />}
          iconClass="bg-[#edf2ff] text-[#4266b2]"
          label="eSIMAccess 已分配额度"
          value="待配置"
          note="额度账本将在数据库启用后生效"
        />
        <Metric
          icon={<Database size={19} />}
          iconClass="bg-[#fff3e9] text-[#dc702b]"
          label="已连接平台"
          value="1 个"
          note="eSIMAccess 已连接，其他平台可继续添加"
        />
        <Metric
          icon={<ShoppingBag size={19} />}
          iconClass="bg-[#f3edff] text-[#7551b6]"
          label="供应商历史产品"
          value={`${overview.history?.total || 0} 件`}
          note="来自主账号历史订单"
        />
      </section>

      <section className="mb-7 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-[20px] border border-[#dce5f3] bg-white p-6 shadow-[0_4px_24px_rgba(28,48,82,.04)]">
          <div className="flex items-start justify-between">
            <div className="flex gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf2ff] font-semibold text-[#315c9f]">
                EA
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">eSIMAccess 平台钱包</h2>
                  <span className="rounded-full bg-[#e9f8f2] px-2 py-0.5 text-[10px] font-medium text-[#177359]">
                    API 已连接
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  官方账户余额决定该平台可分配额度上限
                </p>
              </div>
            </div>
            <button className="text-xs font-medium text-[#4168ab]">刷新</button>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-4">
            <div>
              <p className="text-[11px] text-slate-400">账户余额</p>
              <p className="mt-1 text-xl font-semibold">{balance}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">已分配</p>
              <p className="mt-1 text-xl font-semibold">待配置</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">可继续分配</p>
              <p className="mt-1 text-xl font-semibold">待配置</p>
            </div>
          </div>
        </div>
        <div className="rounded-[20px] border border-[#e5e9f0] bg-white p-6">
          <div className="flex gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#f3edff] font-semibold text-[#7652b3]">
              GG
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">eSIM.GG</h2>
                <span className="rounded-full bg-[#fff4e5] px-2 py-0.5 text-[10px] font-medium text-[#ae671c]">
                  待商务接入
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                官网没有公开 API 文档，需要联系支持申请
              </p>
            </div>
          </div>
          <div className="mt-6 rounded-xl bg-[#faf8ff] p-4 text-xs leading-5 text-slate-600">
            已登记为第二供应平台。获得 reseller/API
            凭证后，可同步余额、号码、套餐和历史订单。
          </div>
          <a
            href="https://esim.gg/support/contact-us"
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#65479e]"
          >
            联系 eSIM.GG 支持 <span aria-hidden>↗</span>
          </a>
        </div>
      </section>

      <section className="mb-7 rounded-[20px] border border-[#dce5f3] bg-white p-5 shadow-[0_4px_24px_rgba(28,48,82,.04)] md:p-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e8f4ff] text-[#3281b6]">
              <Bot size={21} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Telegram 资源提醒</h2>
                <span
                  className={`${telegram?.configured ? "bg-[#e9f8f2] text-[#177359]" : "bg-[#fff4e5] text-[#ae671c]"} rounded-full px-2.5 py-1 text-[10px] font-medium`}
                >
                  {telegram === null
                    ? "正在检查"
                    : telegram.configured
                      ? `@${telegram.botUsername || "Bot 已连接"}`
                      : "等待配置"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                仅发送提醒，不会自动续费：到期前 5 天，或剩余流量低于 10%
                时推送到管理员 Telegram。
                {telegram?.maskedChatId
                  ? ` 接收方 ${telegram.maskedChatId}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid min-w-[320px] grid-cols-3 gap-3">
              <div className="rounded-xl bg-[#f6f9fd] p-3 text-center">
                <p className="text-[10px] text-slate-400">检查频率</p>
                <p className="mt-1 text-xs font-semibold">凭证配置后启用</p>
              </div>
              <div className="rounded-xl bg-[#f6f9fd] p-3 text-center">
                <p className="text-[10px] text-slate-400">到期阈值</p>
                <p className="mt-1 text-xs font-semibold">提前 5 天</p>
              </div>
              <div className="rounded-xl bg-[#f6f9fd] p-3 text-center">
                <p className="text-[10px] text-slate-400">余量阈值</p>
                <p className="mt-1 text-xs font-semibold">低于 10%</p>
              </div>
            </div>
            <button
              onClick={() => setTelegramOpen(true)}
              className="h-11 shrink-0 rounded-xl bg-[#1d3b72] px-5 text-sm font-medium text-white"
            >
              {telegram?.configured ? "修改配置" : "配置机器人"}
            </button>
          </div>
        </div>
      </section>

      <section className="mb-7 rounded-[20px] border border-[#e5e9f0] bg-white p-5 shadow-[0_4px_24px_rgba(28,48,82,.04)] md:p-7">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">员工分平台额度</h2>
            <p className="mt-1 text-sm text-slate-500">
              同一员工可分别拥有 eSIMAccess、号码平台等不同钱包额度
            </p>
          </div>
          <button className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-600">
            分配额度
          </button>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
          额度账本尚未初始化。接入员工账号数据库后，可在这里按平台分配额度。
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.45fr_.65fr]">
        <PurchaseTable
          items={overview.history?.items || []}
          total={overview.history?.total || 0}
          compact
        />
        <div className="rounded-[20px] bg-[#1b3768] p-7 text-white shadow-[0_12px_32px_rgba(25,50,96,.16)]">
          <span className="mb-8 grid h-10 w-10 place-items-center rounded-xl bg-white/10">
            <Database size={19} />
          </span>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-200">
            供应商主账号
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-tight">
            历史数据已连通
          </h2>
          <p className="mt-4 text-sm leading-6 text-blue-100">
            余额、3,000+ 套餐目录和历史产品已通过官方 API
            读取。未来本站创建的订单仍会保留在原 eSIMAccess 主账号中。
          </p>
          <div className="mt-6 rounded-xl bg-white/[.07] p-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#61d0a9]" /> eSIMAccess
              · API 已连接
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#f0b35b]" /> 其他平台 ·
              等待接入
            </div>
          </div>
        </div>
      </section>
      {telegramOpen && (
        <TelegramConfigModal
          current={telegram}
          close={() => setTelegramOpen(false)}
          saved={() => {
            setTelegramOpen(false);
            void loadTelegram();
          }}
        />
      )}
    </div>
  );
}

function TelegramConfigModal({
  current,
  close,
  saved,
}: {
  current: {
    configured: boolean;
    botUsername?: string | null;
    maskedChatId?: string | null;
  } | null;
  close: () => void;
  saved: () => void;
}) {
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [sendTest, setSendTest] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch("/api/settings/telegram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botToken, chatId, sendTest }),
    });
    const data = (await response.json()) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setError(data.error || "配置失败");
      return;
    }
    saved();
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0d1b35]/60 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-[580px] rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
              管理员集成
            </p>
            <h2 className="mt-2 text-xl font-semibold">配置 Telegram 机器人</h2>
            <p className="mt-2 text-xs text-slate-500">
              凭证会在服务端加密保存，不会出现在网页源码中。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          {current?.configured && (
            <div className="rounded-xl bg-[#eef9f4] p-4 text-xs text-[#26775f]">
              当前已连接{" "}
              {current.botUsername ? `@${current.botUsername}` : "Telegram Bot"}
              ，接收方 {current.maskedChatId || "已隐藏"}。留空可保留原值。
            </div>
          )}
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Bot Token</span>
            <input
              required={!current?.configured}
              type="password"
              autoComplete="off"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value.trim())}
              placeholder={
                current?.configured ? "留空表示不修改" : "例如 123456789:AA..."
              }
              className="h-12 w-full rounded-xl border border-slate-200 px-4 font-mono text-sm outline-none focus:border-[#87a3d9] focus:ring-4 focus:ring-blue-50"
            />
            <span className="mt-2 block text-[11px] text-slate-400">
              在 Telegram 的 @BotFather 中创建机器人后获取。
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">接收 Chat ID</span>
            <input
              required={!current?.configured}
              value={chatId}
              onChange={(event) => setChatId(event.target.value.trim())}
              placeholder={
                current?.configured
                  ? "留空表示不修改"
                  : "个人、群组或频道 Chat ID"
              }
              className="h-12 w-full rounded-xl border border-slate-200 px-4 font-mono text-sm outline-none focus:border-[#87a3d9] focus:ring-4 focus:ring-blue-50"
            />
            <span className="mt-2 block text-[11px] leading-5 text-slate-400">
              机器人必须已经加入目标会话；频道可填写 @channel_username。
            </span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-[#dfe8fa] bg-[#f4f7fd] p-4 text-xs text-[#425b88]">
            <input
              type="checkbox"
              checked={sendTest}
              onChange={(event) => setSendTest(event.target.checked)}
              className="h-4 w-4 accent-[#315c9f]"
            />
            保存时发送一条测试消息
          </label>
          {error && (
            <div className="rounded-xl bg-[#fff3ef] p-3 text-xs text-[#a85845]">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
          >
            取消
          </button>
          <button
            disabled={
              saving || (!current?.configured && (!botToken || !chatId))
            }
            className="h-11 rounded-xl bg-[#1d3b72] px-6 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "正在验证并保存" : "验证并保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PurchaseTable({
  items,
  total,
  compact = false,
  manageable = false,
  selected = [],
  toggleSelected,
  toggleAll,
  onDetail,
  onRenew,
}: {
  items: PurchaseHistoryItem[];
  total: number;
  compact?: boolean;
  manageable?: boolean;
  selected?: string[];
  toggleSelected?: (id: string) => void;
  toggleAll?: () => void;
  onDetail?: (item: PurchaseHistoryItem) => void;
  onRenew?: (item: PurchaseHistoryItem) => void;
}) {
  return (
    <div className="rounded-[20px] border border-[#e5e9f0] bg-white p-5 shadow-[0_4px_24px_rgba(28,48,82,.04)] md:p-7">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {compact ? "最近同步记录" : "资源清单"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            共 {total} 件 · 数据来自 eSIMAccess 主账号
          </p>
        </div>
        <span className="rounded-full bg-[#e9f8f2] px-3 py-1 text-[11px] font-medium text-[#177359]">
          实时同步
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
              {manageable && (
                <th className="w-10 pb-3">
                  <input
                    type="checkbox"
                    checked={!!items.length && selected.length === items.length}
                    onChange={toggleAll}
                    aria-label="全选资源"
                    className="h-4 w-4 accent-[#315c9f]"
                  />
                </th>
              )}
              <th className="pb-3 font-medium">资源 / 编号</th>
              <th className="pb-3 font-medium">状态</th>
              <th className="pb-3 font-medium">流量使用</th>
              <th className="pb-3 font-medium">到期日</th>
              <th className="pb-3 font-medium">交付</th>
              {manageable && (
                <th className="pb-3 text-right font-medium">操作</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.slice(0, compact ? 6 : 50).map((item) => {
                const remainingDays = daysUntil(item.expiredTime);
                const renewable =
                  Boolean(item.iccid) && (remainingDays ?? 1) >= 0;
                return (
                  <tr
                    key={item.esimTranNo}
                    className="border-b border-slate-50 last:border-0"
                  >
                    {manageable && (
                      <td className="py-4">
                        <input
                          type="checkbox"
                          checked={selected.includes(item.esimTranNo)}
                          onChange={() => toggleSelected?.(item.esimTranNo)}
                          aria-label={`选择 ${item.packageName}`}
                          className="h-4 w-4 accent-[#315c9f]"
                        />
                      </td>
                    )}
                    <td className="py-4">
                      <p className="font-medium">{item.packageName}</p>
                      <p className="mt-1 font-mono text-[10px] text-slate-400">
                        ICCID {maskIdentifier(item.iccid)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-400">
                        {item.orderNo} · {item.esimTranNo}
                      </p>
                    </td>
                    <td className="py-4">
                      <span className="rounded-full bg-[#e9f8f2] px-2.5 py-1 text-[11px] font-medium text-[#177359]">
                        {statusLabel(item.esimStatus)}
                      </span>
                      <p className="mt-2 text-[10px] text-slate-400">
                        SM-DP+ {item.smdpStatus || "—"}
                      </p>
                    </td>
                    <td className="py-4 text-xs text-slate-500">
                      <p>
                        {formatData(item.orderUsage)} /{" "}
                        {formatData(item.totalVolume)}
                      </p>
                      <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#5b83c4]"
                          style={{
                            width: `${item.totalVolume ? Math.min(100, (item.orderUsage / item.totalVolume) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-4 text-xs">
                      <p
                        className={
                          remainingDays !== null && remainingDays <= 30
                            ? "font-medium text-[#c76436]"
                            : "text-slate-600"
                        }
                      >
                        {formatDate(item.expiredTime)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {remainingDays === null
                          ? "等待供应商返回"
                          : remainingDays < 0
                            ? "已到期"
                            : `剩余 ${remainingDays} 天`}
                      </p>
                    </td>
                    <td className="py-4">
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        {item.qrCodeUrl ? (
                          <QrCode size={15} className="text-[#315c9f]" />
                        ) : (
                          <AlertTriangle size={15} className="text-[#d18a42]" />
                        )}
                        {item.qrCodeUrl ? "二维码已同步" : "等待交付信息"}
                      </div>
                    </td>
                    {manageable && (
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => onDetail?.(item)}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                          >
                            查看详情
                          </button>
                          <button
                            disabled={!renewable}
                            onClick={() => onRenew?.(item)}
                            className="rounded-lg bg-[#edf2fb] px-3 py-2 text-[11px] font-medium text-[#315c9f] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            续订
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={manageable ? 7 : 5}
                  className="py-12 text-center text-sm text-slate-500"
                >
                  没有找到符合条件的已购资源
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LifecycleNote({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e9f0] bg-white p-5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf2fb] text-[#315c9f]">
        {icon}
      </span>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  );
}

function ResourceDetailModal({
  item,
  close,
  renew,
  notify,
}: {
  item: PurchaseHistoryItem;
  close: () => void;
  renew: () => void;
  notify: (message: string) => void;
}) {
  const [showSensitive, setShowSensitive] = useState(false);
  const remainingDays = daysUntil(item.expiredTime);
  const canRenew = Boolean(item.iccid) && (remainingDays ?? 1) >= 0;
  const copy = async (label: string, value: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    notify(`${label} 已复制`);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0d1b35]/60 backdrop-blur-[2px] sm:items-center sm:p-5">
      <div className="max-h-[94vh] w-full max-w-[980px] overflow-y-auto rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 p-5 backdrop-blur md:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
              资源详情 · eSIMAccess
            </p>
            <h2 className="mt-2 text-xl font-semibold">{item.packageName}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-[#e9f8f2] px-2.5 py-1 text-[10px] font-medium text-[#177359]">
                {statusLabel(item.esimStatus)}
              </span>
              <span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-medium text-[#4267ae]">
                SM-DP+ {item.smdpStatus || "—"}
              </span>
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="grid gap-6 p-5 md:grid-cols-[280px_minmax(0,1fr)] md:p-6">
          <aside>
            <div className="rounded-2xl border border-[#dfe6f0] bg-[#f8fafc] p-5 text-center">
              <div className="mx-auto grid aspect-square w-full max-w-[210px] place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-3">
                {showSensitive && item.qrCodeUrl ? (
                  <img
                    src={item.qrCodeUrl}
                    alt="eSIM 安装二维码"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="text-slate-400">
                    <QrCode className="mx-auto" size={66} />
                    <p className="mt-3 text-xs">
                      {item.qrCodeUrl
                        ? "点击显示安装二维码"
                        : "供应商尚未返回二维码"}
                    </p>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowSensitive((value) => !value)}
                className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#315c9f]"
              >
                {showSensitive ? <EyeOff size={15} /> : <Eye size={15} />}
                {showSensitive ? "隐藏敏感信息" : "显示二维码与完整编号"}
              </button>
              {item.qrCodeUrl && (
                <a
                  href={item.qrCodeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600"
                >
                  <Download size={14} />
                  打开并保存二维码
                </a>
              )}
            </div>
            <div className="mt-4 rounded-2xl border border-[#f0e3d8] bg-[#fffaf5] p-4 text-xs leading-5 text-[#825a3b]">
              <div className="flex gap-2">
                <ShieldCheck className="mt-0.5 shrink-0" size={15} />
                <p>
                  二维码和激活码属于敏感交付信息。建议仅向购买人、所属管理员和授权运维人员显示，并记录查看与复制日志。
                </p>
              </div>
            </div>
          </aside>
          <section>
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailMetric
                label="购买时间"
                value={formatDate(item.createTime, true)}
              />
              <DetailMetric
                label="激活时间"
                value={formatDate(item.activateTime, true)}
              />
              <DetailMetric
                label="到期时间"
                value={formatDate(item.expiredTime, true)}
                emphasis={remainingDays !== null && remainingDays <= 30}
              />
              <DetailMetric
                label="流量使用"
                value={`${formatData(item.orderUsage)} / ${formatData(item.totalVolume)}`}
              />
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold">交付与技术编号</h3>
                <span className="text-[10px] text-slate-400">
                  完整同步供应商返回字段
                </span>
              </div>
              <div className="grid gap-x-6 px-4 py-2 sm:grid-cols-2">
                <CopyField
                  label="ICCID"
                  value={item.iccid}
                  visible={showSensitive}
                  copy={copy}
                />
                <CopyField
                  label="IMSI"
                  value={item.imsi}
                  visible={showSensitive}
                  copy={copy}
                />
                <CopyField
                  label="手机号码 MSISDN"
                  value={item.msisdn}
                  visible={showSensitive}
                  copy={copy}
                />
                <CopyField
                  label="设备 EID"
                  value={item.eid}
                  visible={showSensitive}
                  copy={copy}
                />
                <CopyField
                  label="订单号"
                  value={item.orderNo}
                  visible
                  copy={copy}
                />
                <CopyField
                  label="eSIM 交易号"
                  value={item.esimTranNo}
                  visible
                  copy={copy}
                />
                <CopyField
                  label="业务交易号"
                  value={item.transactionId}
                  visible
                  copy={copy}
                />
                <CopyField
                  label="套餐代码"
                  value={item.packageCode}
                  visible
                  copy={copy}
                />
                <CopyField label="APN" value={item.apn} visible copy={copy} />
                <CopyField
                  label="PIN / PUK"
                  value={
                    [item.pin, item.puk].filter(Boolean).join(" / ") || null
                  }
                  visible={showSensitive}
                  copy={copy}
                />
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">eSIM 激活码（AC）</h3>
                <button
                  disabled={!item.activationCode}
                  onClick={() => copy("激活码", item.activationCode)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#4267ae] disabled:opacity-40"
                >
                  <Copy size={13} />
                  复制
                </button>
              </div>
              <p className="mt-3 break-all rounded-xl bg-[#f6f8fb] p-3 font-mono text-[11px] leading-5 text-slate-600">
                {item.activationCode
                  ? showSensitive
                    ? item.activationCode
                    : maskIdentifier(item.activationCode)
                  : "供应商尚未返回激活码"}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={close}
                className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
              >
                关闭
              </button>
              <button
                disabled={!canRenew}
                onClick={renew}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1d3b72] px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw size={15} />
                {canRenew ? "续订该资源" : "当前不可续订"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#f7f9fc] p-4">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={`mt-2 text-sm font-medium ${emphasis ? "text-[#c76436]" : "text-slate-700"}`}
      >
        {value}
      </p>
    </div>
  );
}

function CopyField({
  label,
  value,
  visible,
  copy,
}: {
  label: string;
  value: string | null;
  visible: boolean;
  copy: (label: string, value: string | null) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 py-3">
      <div className="min-w-0">
        <p className="text-[10px] text-slate-400">{label}</p>
        <p
          className="mt-1 truncate font-mono text-[11px] text-slate-700"
          title={visible ? value || "" : undefined}
        >
          {visible ? value || "—" : maskIdentifier(value)}
        </p>
      </div>
      <button
        disabled={!value}
        onClick={() => copy(label, value)}
        className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-[#315c9f] disabled:opacity-30"
        aria-label={`复制${label}`}
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function RenewModal({
  items,
  close,
  complete,
}: {
  items: PurchaseHistoryItem[];
  close: () => void;
  complete: () => void;
}) {
  const [plans, setPlans] = useState<TopUpPackage[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const firstIccid = items[0]?.iccid;
  useEffect(() => {
    let active = true;
    if (items.length > 1) {
      setLoading(false);
      return;
    }
    if (!firstIccid) {
      setLoading(false);
      setError("资源缺少 ICCID，无法匹配续订套餐");
      return;
    }
    fetch(
      `/api/esim/topups?iccid=${encodeURIComponent(firstIccid)}&resourceId=${encodeURIComponent(items[0]?.esimTranNo || "")}`,
    )
      .then(
        (response) =>
          response.json() as Promise<{
            connected?: boolean;
            items?: TopUpPackage[];
            error?: string;
          }>,
      )
      .then((data) => {
        if (!active) return;
        if (data.connected && data.items?.length) {
          setPlans(data.items);
          setSelectedPlan(data.items[0].id);
        } else setError(data.error || "当前资源没有可用续订套餐");
      })
      .catch(() => {
        if (active) setError("续订套餐同步失败，请稍后重试");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [firstIccid, items.length]);
  const plan = plans.find((item) => item.id === selectedPlan);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pin.length === 6 && (plan || items.length > 1)) complete();
  };
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-[#0d1b35]/60 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form
        onSubmit={submit}
        className="max-h-[94vh] w-full max-w-[680px] overflow-y-auto rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
              {items.length > 1 ? "批量续订" : "资源续订"}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              为 {items.length} 项资源增加流量/有效期
            </h2>
            <p className="mt-2 text-xs text-slate-500">
              续订将写入原 ICCID，无需重新安装二维码。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          <div className="rounded-2xl bg-[#f6f8fc] p-4">
            <p className="text-xs font-semibold text-slate-700">续订资源</p>
            <div className="mt-3 max-h-28 space-y-2 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.esimTranNo}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-slate-600">
                    {item.packageName}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">
                    {maskIdentifier(item.iccid)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {items.length > 1 ? (
            <div className="rounded-2xl border border-[#dfe8fa] bg-[#f4f7fd] p-5">
              <div className="flex gap-3">
                <RefreshCw
                  className="mt-0.5 shrink-0 text-[#4267ae]"
                  size={17}
                />
                <div>
                  <h3 className="text-sm font-semibold text-[#314f80]">
                    逐张匹配原套餐
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#526b95]">
                    系统不会把同一个套餐套用到全部资源。执行时会根据每张卡的
                    ICCID、原套餐代码和当前状态，分别查询对应的兼容续订方案与实时价格。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">兼容续订套餐</h3>
                <span className="text-[10px] text-slate-400">
                  按 ICCID 实时查询
                </span>
              </div>
              {loading ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
                  正在向供应商查询可续订套餐…
                </div>
              ) : error ? (
                <div className="rounded-xl border border-[#f0dfd4] bg-[#fff8f3] p-4 text-xs leading-5 text-[#925c39]">
                  {error}
                </div>
              ) : (
                <div className="grid max-h-56 gap-2 overflow-y-auto">
                  {plans.slice(0, 12).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setSelectedPlan(item.id)}
                      className={`${selectedPlan === item.id ? "border-[#557ab7] bg-[#f2f6fd] ring-2 ring-[#e2eaf7]" : "border-slate-200 bg-white"} flex items-center justify-between gap-4 rounded-xl border p-3 text-left`}
                    >
                      <div>
                        <p className="text-xs font-medium text-slate-700">
                          {item.name}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {formatData(item.volume)} · {item.duration}{" "}
                          {item.durationUnit === "DAY"
                            ? "天"
                            : item.durationUnit}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-[#294d88]">
                        {formatMoney(item.price, item.currency)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}{" "}
          {items.length > 1 && (
            <div className="flex gap-3 rounded-xl border border-[#dfe8fa] bg-[#f4f7fd] p-4 text-xs leading-5 text-[#425b88]">
              <ShieldCheck className="mt-0.5 shrink-0" size={16} />
              <p>
                每张卡都会分别校验兼容性、到期状态和实时价格；支付密码只验证一次。若单张匹配失败，其余资源继续处理并单独记录失败原因。
              </p>
            </div>
          )}
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium">
              <LockKeyhole size={15} className="text-[#486ba5]" />
              支付密码
            </span>
            <input
              required
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="请输入 6 位支付密码"
              minLength={6}
              className="h-12 w-full rounded-xl border border-slate-200 px-4 tracking-[.35em] outline-none focus:border-[#87a3d9] focus:ring-4 focus:ring-blue-50"
            />
          </label>
          <div className="rounded-xl bg-[#fffaf3] p-4 text-xs leading-5 text-[#835d34]">
            当前站点尚未启用员工额度账本，因此这里只完成续订确认流程，不会向供应商发送付费订单。额度与真实下单启用后，续订金额将从对应平台额度扣除。
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
          >
            取消
          </button>
          <button
            disabled={pin.length !== 6 || (!plan && items.length === 1)}
            type="submit"
            className="h-11 rounded-xl bg-[#1d3b72] px-6 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            验证并确认续订
          </button>
        </div>
      </form>
    </div>
  );
}

function ResourceStatusModal({
  target,
  close,
  saved,
}: {
  target: ResourceStatusTarget;
  close: () => void;
  saved: (result: {
    status: string;
    note: string | null;
    recheckAt: string | null;
  }) => void;
}) {
  const restoring = target.currentStatus === "temporary_unavailable";
  const [note, setNote] = useState(target.note || "");
  const [recheckHours, setRecheckHours] = useState(24);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/resources/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplier: target.supplier,
        resourceId: target.resourceId,
        status: restoring ? "normal" : "temporary_unavailable",
        note: restoring ? "已恢复可用" : note,
        recheckHours,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      status?: string;
      recheckAt?: string | null;
    };
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error || "资源状态保存失败");
      return;
    }
    saved({
      status: result.status || "normal",
      note: restoring ? null : note.trim(),
      recheckAt: result.recheckAt || null,
    });
  };
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-[#0d1b35]/60 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-[560px] rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#9c674e]">
              资源可用性管理
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {restoring ? "恢复为正常可用" : "标记为暂时无法使用"}
            </h2>
            <p className="mt-2 text-xs text-slate-500">{target.name}</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          {restoring ? (
            <div className="rounded-xl border border-[#cfe8de] bg-[#eef9f4] p-4 text-xs leading-5 text-[#26775f]">
              恢复后会退出“暂时无法使用”分类，供应商原始状态和历史备注不会被修改。
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  无法使用的原因（必填）
                </span>
                <textarea
                  required
                  value={note}
                  onChange={(event) =>
                    setNote(event.target.value.slice(0, 500))
                  }
                  rows={4}
                  placeholder="例如：激活失败，等待运营商侧恢复；号码暂时无法接收短信…"
                  className="w-full rounded-xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-[#87a3d9]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">复查时间</span>
                <select
                  value={recheckHours}
                  onChange={(event) =>
                    setRecheckHours(Number(event.target.value))
                  }
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm"
                >
                  <option value={24}>24 小时后复查</option>
                  <option value={48}>48 小时后复查</option>
                </select>
              </label>
              <div className="rounded-xl bg-[#fff8f3] p-4 text-xs leading-5 text-[#895c43]">
                这是内部管理标记，不会暂停、删除或覆盖原供应商中的资源。恢复后可随时改回正常可用。
              </div>
            </>
          )}
          {error && (
            <div className="rounded-xl bg-[#fff1ed] p-3 text-xs text-[#aa5644]">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
          >
            取消
          </button>
          <button
            disabled={submitting || (!restoring && !note.trim())}
            className={`${restoring ? "bg-[#1f745b]" : "bg-[#7d4d3b]"} h-11 rounded-xl px-6 text-sm font-medium text-white disabled:opacity-40`}
          >
            {submitting ? "正在保存" : restoring ? "确认恢复可用" : "确认标记"}
          </button>
        </div>
      </form>
    </div>
  );
}

function WarehouseStatusManager({
  claims,
  onManage,
}: {
  claims: WarehouseClaim[];
  onManage: (claim: WarehouseClaim) => void;
}) {
  const [resourceId, setResourceId] = useState("");
  const [showOnlyUnavailable, setShowOnlyUnavailable] = useState(false);
  const selectedClaim = claims.find((claim) => claim.id === resourceId);
  const unavailable = claims.filter(
    (claim) => claim.availabilityStatus === "temporary_unavailable",
  );
  const displayed = showOnlyUnavailable ? unavailable : claims;
  return (
    <section className="mb-6 rounded-[20px] border border-[#eadfd7] bg-[#fffaf6] p-5 md:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">暂时无法使用归类</h2>
            <span className="rounded-full bg-[#fff0ee] px-2.5 py-1 text-[10px] font-medium text-[#b95748]">
              {unavailable.length} 项待复查
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            库存资源、账号、号码都可按 24/48 小时复查；恢复后移回正常分类。
          </p>
        </div>
        <button
          onClick={() => setShowOnlyUnavailable((value) => !value)}
          className="h-9 rounded-xl border border-[#dfcfc5] bg-white px-4 text-xs font-medium text-[#795342]"
        >
          {showOnlyUnavailable ? "显示全部认领" : "只看暂不可用"}
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <select
          value={resourceId}
          onChange={(event) => setResourceId(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-[#eadfd7] bg-white px-3 text-xs"
        >
          <option value="">选择已认领资源</option>
          {displayed.slice(0, 500).map((claim) => (
            <option key={claim.id} value={claim.id}>
              {claim.availabilityStatus === "temporary_unavailable"
                ? "[暂不可用] "
                : ""}
              {claim.productName} · {claim.recipientEmail || claim.id}
            </option>
          ))}
        </select>
        <button
          disabled={!selectedClaim}
          onClick={() => selectedClaim && onManage(selectedClaim)}
          className="h-10 shrink-0 rounded-xl bg-[#7d4d3b] px-4 text-xs font-medium text-white disabled:opacity-40"
        >
          {selectedClaim?.availabilityStatus === "temporary_unavailable"
            ? "恢复为可用"
            : "标记暂时无法使用"}
        </button>
      </div>
      {showOnlyUnavailable && unavailable.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {unavailable.slice(0, 12).map((claim) => (
            <button
              key={claim.id}
              onClick={() => onManage(claim)}
              className="rounded-xl border border-[#eadfd7] bg-white p-3 text-left"
            >
              <p className="text-xs font-medium text-slate-700">
                {claim.productName}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-[#9b645a]">
                {claim.availabilityNote || "等待复查"}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                {claim.availabilityRecheckAt
                  ? `${formatDate(claim.availabilityRecheckAt, true)} 复查`
                  : "待安排复查"}
              </p>
            </button>
          ))}
        </div>
      )}
      {showOnlyUnavailable && !unavailable.length && (
        <p className="mt-4 rounded-xl border border-dashed border-[#e3d8d0] py-6 text-center text-xs text-slate-500">
          当前没有暂时无法使用的库存资源
        </p>
      )}
    </section>
  );
}

function WarehouseView() {
  const [data, setData] = useState<WarehouseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [claimBatch, setClaimBatch] = useState<WarehouseBatch | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [supplier, setSupplier] = useState("AccsMarket");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("数字账号");
  const [country, setCountry] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [inventoryText, setInventoryText] = useState("");
  const [statusTarget, setStatusTarget] = useState<ResourceStatusTarget | null>(
    null,
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/warehouse", { cache: "no-store" });
      const result = (await response.json()) as WarehouseResponse & {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "仓库加载失败");
      setData(result);
      setRecipientEmail((current) => current || result.viewer.email);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "仓库加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openClaim = (batch: WarehouseBatch) => {
    setClaimBatch(batch);
    setQuantity(1);
    setRecipientEmail(data?.viewer.email || "");
    setError("");
  };

  const submitClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!claimBatch) return;
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/warehouse/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        batchId: claimBatch.batchId,
        quantity,
        recipientEmail,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      claimed?: number;
      emailStatus?: string;
      emailError?: string;
    };
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error || "认领失败");
      return;
    }
    setClaimBatch(null);
    setNotice(
      result.emailStatus === "sent"
        ? `已认领 ${result.claimed} 项，交付邮件已发送至 ${recipientEmail}`
        : `已认领 ${result.claimed} 项并保存到站内；${result.emailError || "邮件等待发送"}`,
    );
    window.setTimeout(() => setNotice(""), 6500);
    await load();
  };

  const submitImport = async (event: React.FormEvent) => {
    event.preventDefault();
    const items = inventoryText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/warehouse/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplier,
        productName,
        category,
        country,
        unitPrice: unitPrice.trim() ? Number(unitPrice) : null,
        currency,
        items,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      imported?: number;
    };
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error || "入库失败");
      return;
    }
    setInventoryText("");
    setNotice(`已加密入库 ${result.imported} 项资源`);
    window.setTimeout(() => setNotice(""), 4500);
    await load();
  };

  const retryEmail = async (id: string) => {
    setError("");
    const response = await fetch("/api/warehouse/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error || "邮件重发失败");
      return;
    }
    setNotice("交付邮件已重新发送");
    window.setTimeout(() => setNotice(""), 4200);
    await load();
  };

  const emailLabel = (status: string) =>
    status === "sent"
      ? "邮件已发送"
      : status === "failed"
        ? "邮件发送失败"
        : status === "pending"
          ? "邮件待发送"
          : "尚未发送";

  return (
    <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">
      <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#6582bd]">
            无 API 平台
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[30px]">
            库存仓库与资源认领
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            管理员提前采购并加密入库；业务员可单个或批量认领，不占用任何平台额度。
          </p>
        </div>
        <div
          className={`${data?.emailConfigured ? "border-[#cde9df] bg-[#eef9f4] text-[#26775f]" : "border-[#f0dfc8] bg-[#fff8ed] text-[#9a672f]"} inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-xs`}
        >
          <Mail size={15} />
          {data?.emailConfigured
            ? "邮件自动交付已启用"
            : "邮件通道待配置，认领仍会保存在站内"}
        </div>
      </section>

      {data?.viewer.isAdmin ? (
        <section className="mb-7 grid gap-4 sm:grid-cols-3">
          <Metric
            icon={<Archive size={19} />}
            iconClass="bg-[#edf2ff] text-[#4266b2]"
            label="可认领库存"
            value={data ? `${data.stats.available} 项` : "加载中"}
            note="无 API 平台库存不设置额度限制"
          />
          <Metric
            icon={<PackageCheck size={19} />}
            iconClass="bg-[#e9f7f1] text-[#208267]"
            label="我的/全部认领"
            value={data ? `${data.stats.claimed} 项` : "加载中"}
            note={
              data?.viewer.isAdmin
                ? "管理员查看全部认领记录"
                : "仅显示当前账号认领记录"
            }
          />
          <Metric
            icon={<Database size={19} />}
            iconClass="bg-[#fff3e9] text-[#dc702b]"
            label="可用批次"
            value={data ? `${data.stats.batches} 个` : "加载中"}
            note="同一批次支持一次批量认领"
          />
        </section>
      ) : (
        <section className="mb-5 flex gap-6 rounded-2xl border border-[#e5e9f0] bg-white px-5 py-4 text-sm">
          <span>
            <strong className="text-[#294d88]">
              {data?.stats.available ?? 0}
            </strong>{" "}
            项可认领
          </span>
          <span>
            <strong className="text-[#208267]">
              {data?.stats.claimed ?? 0}
            </strong>{" "}
            项我的认领
          </span>
        </section>
      )}

      {error && (
        <div className="mb-5 rounded-xl border border-[#f0d9d1] bg-[#fff5f1] p-4 text-sm text-[#9b5444]">
          {error}
        </div>
      )}
      {loading ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
          正在读取加密库存…
        </div>
      ) : (
        <>
          <section className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">可认领资源</h2>
                <p className="mt-1 text-xs text-slate-500">
                  无需支付密码、无需审批、无需额度；认领时必须指定接收邮箱。
                </p>
              </div>
              <button
                onClick={() => void load()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-600"
              >
                <RefreshCw size={14} />
                刷新库存
              </button>
            </div>
            {data?.batches.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.batches.map((batch) => (
                  <article
                    key={batch.batchId}
                    className="rounded-[20px] border border-[#e3e8f0] bg-white p-5 shadow-[0_4px_22px_rgba(28,48,82,.04)]"
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#edf2fb] text-[#315c9f]">
                        <Archive size={19} />
                      </span>
                      <span className="rounded-full bg-[#e9f8f2] px-3 py-1 text-[11px] font-medium text-[#177359]">
                        库存 {batch.available}
                      </span>
                    </div>
                    <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">
                      {batch.supplier} · {batch.category}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold">
                      {batch.productName}
                    </h3>
                    <p className="mt-2 text-xs text-slate-500">
                      {batch.country || "未指定国家/地区"} · 批次{" "}
                      {batch.batchId.slice(0, 8)}
                    </p>
                    <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4">
                      <div>
                        <p className="text-sm font-semibold text-[#294d88]">
                          {batch.unitPrice === null
                            ? "不限额度"
                            : formatMoney(
                                batch.unitPrice / 100,
                                batch.currency,
                              )}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          认领不扣内部额度
                        </p>
                      </div>
                      <button
                        onClick={() => openClaim(batch)}
                        className="rounded-xl bg-[#1d3b72] px-4 py-2.5 text-xs font-semibold text-white"
                      >
                        {batch.available > 1 ? "批量认领" : "立即认领"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center text-sm text-slate-500">
                当前没有可认领库存
              </div>
            )}
          </section>

          <WarehouseStatusManager
            claims={data?.claims || []}
            onManage={(claim) =>
              setStatusTarget({
                supplier: "warehouse",
                resourceId: claim.id,
                name: claim.productName,
                currentStatus: claim.availabilityStatus,
                note: claim.availabilityNote,
              })
            }
          />

          <section className="mb-8 rounded-[20px] border border-[#e5e9f0] bg-white p-5 md:p-7">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">
                {data?.viewer.isAdmin ? "全部认领记录" : "我的认领"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                认领内容可在平台内查看，同时记录接收邮箱和邮件投递状态。
              </p>
            </div>
            {data?.claims.length ? (
              <div className="space-y-3">
                {data.claims.map((claim) => (
                  <div
                    key={claim.id}
                    className="rounded-2xl border border-slate-100 bg-[#fafbfd] p-4"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">
                            {claim.productName}
                          </h3>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] text-slate-500">
                            {claim.supplier}
                          </span>
                          <span
                            className={`${claim.emailStatus === "sent" ? "bg-[#e9f8f2] text-[#177359]" : "bg-[#fff4e5] text-[#a76a2a]"} rounded-full px-2.5 py-1 text-[10px]`}
                          >
                            {emailLabel(claim.emailStatus)}
                          </span>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          {formatDate(claim.claimedAt, true)} · 接收邮箱{" "}
                          {claim.recipientEmail}
                          {data.viewer.isAdmin && claim.claimedByEmail
                            ? ` · 认领人 ${claim.claimedByName || claim.claimedByEmail}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setRevealed((current) =>
                              current.includes(claim.id)
                                ? current.filter((id) => id !== claim.id)
                                : [...current, claim.id],
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600"
                        >
                          {revealed.includes(claim.id) ? (
                            <EyeOff size={13} />
                          ) : (
                            <Eye size={13} />
                          )}
                          {revealed.includes(claim.id)
                            ? "隐藏内容"
                            : "查看内容"}
                        </button>
                        {claim.emailStatus !== "sent" && (
                          <button
                            onClick={() => void retryEmail(claim.id)}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#edf2fb] px-3 py-2 text-[11px] font-medium text-[#315c9f]"
                          >
                            <Send size={13} />
                            重发邮件
                          </button>
                        )}
                      </div>
                    </div>
                    {revealed.includes(claim.id) && (
                      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-[#172a52] p-4 font-mono text-[11px] leading-5 text-blue-50">
                        {claim.payload}
                      </pre>
                    )}
                    {claim.emailError && claim.emailStatus !== "sent" && (
                      <p className="mt-3 text-[11px] text-[#a46437]">
                        {claim.emailError}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
                还没有认领记录
              </div>
            )}
          </section>

          {data?.viewer.isAdmin && (
            <section className="rounded-[20px] border border-[#dce5f3] bg-white p-5 md:p-7">
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
                  管理员入库
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  导入无 API 平台已采购资源
                </h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  每行作为一项独立资源加密保存，适合粘贴账号、密码、邮箱、2FA、Cookie
                  或卡密组合。
                </p>
              </div>
              <form onSubmit={submitImport} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <label>
                    <span className="mb-2 block text-xs font-medium">
                      供应商
                    </span>
                    <input
                      required
                      value={supplier}
                      onChange={(event) => setSupplier(event.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-xs font-medium">
                      商品名称
                    </span>
                    <input
                      required
                      value={productName}
                      onChange={(event) => setProductName(event.target.value)}
                      placeholder="例如：Gmail 2025 老号"
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-xs font-medium">分类</span>
                    <input
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-xs font-medium">
                      国家/地区
                    </span>
                    <input
                      value={country}
                      onChange={(event) => setCountry(event.target.value)}
                      placeholder="可留空"
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-xs font-medium">
                      采购单价（仅记录）
                    </span>
                    <input
                      value={unitPrice}
                      onChange={(event) =>
                        setUnitPrice(event.target.value.replace(/[^\d.]/g, ""))
                      }
                      placeholder="不填则显示不限额度"
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-xs font-medium">币种</span>
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                    >
                      <option>USD</option>
                      <option>EUR</option>
                      <option>CNY</option>
                      <option>SGD</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium">
                    资源内容（每行一项，最多 500 项）
                  </span>
                  <textarea
                    required
                    value={inventoryText}
                    onChange={(event) => setInventoryText(event.target.value)}
                    rows={8}
                    placeholder={
                      "account1:password:email:email_password:2FA\naccount2:password:email:email_password:2FA"
                    }
                    className="w-full rounded-xl border border-slate-200 p-4 font-mono text-xs leading-6 outline-none focus:border-[#87a3d9]"
                  />
                </label>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-500">
                    当前识别{" "}
                    {
                      inventoryText.split(/\r?\n/).filter((line) => line.trim())
                        .length
                    }{" "}
                    项；入库后业务员可直接认领。
                  </p>
                  <button
                    disabled={
                      submitting || !productName.trim() || !inventoryText.trim()
                    }
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1d3b72] px-5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    <Upload size={15} />
                    {submitting ? "正在加密入库" : "确认入库"}
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}

      {claimBatch && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0d1b35]/60 backdrop-blur-[2px] sm:items-center sm:p-5">
          <form
            onSubmit={submitClaim}
            className="w-full max-w-[540px] rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
          >
            <div className="flex items-start justify-between border-b border-slate-100 p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
                  库存认领
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {claimBatch.productName}
                </h2>
                <p className="mt-2 text-xs text-slate-500">
                  当前库存 {claimBatch.available} 项，本次认领不占用额度。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClaimBatch(null)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-5 p-6">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">认领数量</span>
                <input
                  required
                  type="number"
                  min={1}
                  max={Math.min(100, claimBatch.available)}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(
                      Math.max(
                        1,
                        Math.min(
                          Number(event.target.value),
                          Math.min(100, claimBatch.available),
                        ),
                      ),
                    )
                  }
                  className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#87a3d9]"
                />
              </label>
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Mail size={15} className="text-[#486ba5]" />
                  接收邮箱（必填）
                </span>
                <input
                  required
                  type="email"
                  value={recipientEmail}
                  onChange={(event) =>
                    setRecipientEmail(event.target.value.trim())
                  }
                  placeholder="name@company.com"
                  className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#87a3d9]"
                />
                <span className="mt-2 block text-[11px] leading-5 text-slate-400">
                  认领后资源会保存在“我的认领”，并投递到此邮箱。请确认邮箱准确无误。
                </span>
              </label>
              <div className="rounded-xl border border-[#dfe8fa] bg-[#f4f7fd] p-4 text-xs leading-5 text-[#425b88]">
                <ShieldCheck className="mr-2 inline" size={15} />
                无需支付密码和额度；提交后库存将立即归属当前账号，无法被其他人再次认领。
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
              <button
                type="button"
                onClick={() => setClaimBatch(null)}
                className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
              >
                取消
              </button>
              <button
                disabled={submitting || !recipientEmail.includes("@")}
                className="h-11 rounded-xl bg-[#1d3b72] px-6 text-sm font-medium text-white disabled:opacity-40"
              >
                {submitting ? "正在认领并发送" : `确认认领 ${quantity} 项`}
              </button>
            </div>
          </form>
        </div>
      )}
      {statusTarget && (
        <ResourceStatusModal
          target={statusTarget}
          close={() => setStatusTarget(null)}
          saved={async (next) => {
            setStatusTarget(null);
            setNotice(
              next.status === "temporary_unavailable"
                ? "已归类为暂时无法使用"
                : "已恢复为正常可用",
            );
            window.setTimeout(() => setNotice(""), 4200);
            await load();
          }}
        />
      )}
      {notice && (
        <div className="fixed bottom-6 right-6 z-[80] max-w-md rounded-2xl bg-[#173f35] px-5 py-4 text-sm leading-5 text-white shadow-2xl">
          {notice}
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  favorite,
  selected,
  toggleFavorite,
  toggleSelected,
  buy,
}: {
  product: Product;
  favorite: boolean;
  selected: boolean;
  toggleFavorite: () => void;
  toggleSelected: () => void;
  buy: () => void;
}) {
  const cardClass = `${selected ? "border-[#6385bd] ring-2 ring-[#dce6f6]" : "border-[#e6eaf1]"} group flex min-h-[330px] flex-col rounded-2xl border bg-white p-5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(35,57,97,.09)]`;
  return (
    <article className={cardClass}>
      <div className="mb-5 flex items-start justify-between">
        <button
          onClick={toggleSelected}
          className={`grid h-5 w-5 place-items-center rounded border ${selected ? "border-[#345d9e] bg-[#345d9e] text-white" : "border-slate-300 bg-white"}`}
          aria-label="选择商品"
        >
          {selected && <Check size={13} />}
        </button>
        <button
          onClick={toggleFavorite}
          className={`${favorite ? "bg-[#fff0ec] text-[#e36b50]" : "bg-slate-50 text-slate-400 hover:text-[#e36b50]"} grid h-9 w-9 place-items-center rounded-xl`}
          aria-label="收藏商品"
        >
          <Heart size={16} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`grid h-12 w-12 place-items-center rounded-[14px] bg-gradient-to-br text-sm font-bold ${product.tone}`}
        >
          {product.flag}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">
            {product.type} · {product.supplier}
          </p>
          <h3 className="mt-1 text-[17px] font-semibold">{product.name}</h3>
        </div>
      </div>
      <p className="text-xs leading-5 text-slate-500">{product.description}</p>
      <div className="mt-4 grid gap-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-2">
          <Globe2 size={13} className="text-slate-400" />
          {product.country}
        </span>
        <span className="flex items-center gap-2">
          <Clock3 size={13} className="text-slate-400" />
          {product.validity}
        </span>
        <span className="flex items-center gap-2">
          <Zap size={13} className="text-slate-400" />
          {product.delivery}
        </span>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          支持运营商
        </p>
        <div className="flex flex-wrap gap-1.5">
          {product.operators?.length ? (
            product.operators.slice(0, 4).map((operator) => (
              <span
                key={`${operator.name}-${operator.networkType}`}
                className="rounded-md bg-[#f1f4f8] px-2 py-1 text-[10px] text-slate-600"
              >
                {operator.name}
                {operator.networkType ? ` · ${operator.networkType}` : ""}
              </span>
            ))
          ) : (
            <span className="text-[10px] text-slate-400">
              供应商暂未返回运营商明细
            </span>
          )}
          {(product.operators?.length || 0) > 4 && (
            <span className="rounded-md bg-[#eef3fb] px-2 py-1 text-[10px] text-[#4267ae]">
              +{(product.operators?.length || 0) - 4}
            </span>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between border-t border-slate-100 pt-4">
        <div>
          <p className="text-lg font-semibold text-[#294d88]">
            {formatMoney(product.price, product.currency)}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            {product.data} · 供应商实时价
          </p>
        </div>
        <button
          onClick={buy}
          className="rounded-xl bg-[#1d3b72] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#254984]"
        >
          立即购买
        </button>
      </div>
    </article>
  );
}

function PurchaseModal({
  count,
  pin,
  setPin,
  close,
  confirm,
}: {
  count: number;
  pin: string;
  setPin: (value: string) => void;
  close: () => void;
  confirm: (event: React.FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0d1b35]/55 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form
        onSubmit={confirm}
        className="w-full max-w-[520px] rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
              确认购买
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {count > 1 ? `批量购买 ${count} 个套餐` : "购买数字资源"}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          <div className="rounded-2xl bg-[#f6f8fc] p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">商品金额</span>
              <span className="font-semibold text-[#294d88]">
                按所选套餐实时价
              </span>
            </div>
            <div className="mt-3 flex justify-between text-sm">
              <span className="text-slate-500">eSIMAccess 可用额度</span>
              <span className="font-semibold">待管理员分配</span>
            </div>
            <div className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">
              真实下单将在额度账本启用后开放；当前页面不会向供应商发送付费订单。
            </div>
          </div>
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium">
              <LockKeyhole size={15} className="text-[#486ba5]" />
              支付密码
            </span>
            <input
              required
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="请输入 6 位支付密码"
              minLength={6}
              className="h-12 w-full rounded-xl border border-slate-200 px-4 tracking-[.35em] outline-none focus:border-[#87a3d9] focus:ring-4 focus:ring-blue-50"
            />
          </label>
          <div className="flex items-start gap-3 rounded-xl border border-[#dfe8fa] bg-[#f4f7fd] p-4 text-xs leading-5 text-[#425b88]">
            <ShieldCheck className="mt-0.5 shrink-0" size={16} />
            <p>
              支付密码仅用于验证本次购买。连续输错将锁定账号，管理员可在安全设置中重置。
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
          >
            取消
          </button>
          <button
            disabled={pin.length !== 6}
            type="submit"
            className="h-11 rounded-xl bg-[#1d3b72] px-6 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            验证并确认
          </button>
        </div>
      </form>
    </div>
  );
}


function GroupModal({
  group,
  close,
  save,
}: {
  group: ResourceGroup | null;
  close: () => void;
  save: (group: ResourceGroup) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name || "");
  const [selectedProducts, setSelectedProducts] = useState<GroupProduct[]>(
    group?.products || [],
  );
  const [memberText, setMemberText] = useState(
    (group?.memberEmails || []).join("\n"),
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/esim/packages?${params.toString()}`)
        .then((response) => response.json() as Promise<CatalogResponse>)
        .then((data) => {
          if (!active) return;
          setResults(
            (data.items || []).map((item) => ({
              id: item.id,
              name: item.name,
              packageCode: item.packageCode,
              country: item.countryName,
              supplier: "eSIMAccess",
            })),
          );
        })
        .catch(() => {
          if (active) setError("套餐目录读取失败，请稍后重试");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  const toggle = (product: GroupProduct) =>
    setSelectedProducts((current) =>
      current.some((item) => item.id === product.id)
        ? current.filter((item) => item.id !== product.id)
        : [...current, product],
    );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await save({
        id: group?.id || `group-${Date.now()}`,
        name: name.trim(),
        productIds: selectedProducts.map((item) => item.id),
        products: selectedProducts,
        accent: group?.accent || "bg-[#5578b6]",
        memberEmails: Array.from(
          new Set(
            memberText
              .split(/[\n,，;；]+/)
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean),
          ),
        ),
      });
    } catch {
      setError("分组保存失败，请稍后重试");
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0d1b35]/60 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form
        onSubmit={submit}
        className="max-h-[94vh] w-full max-w-[880px] overflow-y-auto rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 p-6 backdrop-blur">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
              管理员 · 手动选品与权限
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {group ? "编辑专属区域" : "新建专属区域"}
            </h2>
            <p className="mt-2 text-xs text-slate-500">
              只有你勾选的产品才会显示在区域中；只有被授权员工可以购买。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">分组名称</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：印尼 Levi 专属"
              className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#87a3d9]"
            />
          </label>
          <label className="block rounded-2xl border border-[#dce5f3] bg-[#f7f9fc] p-4">
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700">
                允许购买的员工邮箱
              </span>
              <span className="text-xs text-slate-400">
                {
                  memberText
                    .split(/[\n,，;；]+/)
                    .map((email) => email.trim())
                    .filter(Boolean).length
                }{" "}
                人
              </span>
            </span>
            <textarea
              value={memberText}
              onChange={(event) => setMemberText(event.target.value)}
              rows={4}
              placeholder={"levi@company.com\nvin@company.com"}
              className="mt-3 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-[#87a3d9]"
            />
            <span className="mt-2 block text-xs leading-5 text-slate-500">
              请填写员工登录本平台所用的邮箱，每行一个或用逗号分隔。名单内员工可购买，其他员工只能查看。
            </span>
          </label>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">已添加产品</span>
              <span className="text-xs text-slate-400">
                {selectedProducts.length} 个
              </span>
            </div>
            {selectedProducts.length ? (
              <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-xl bg-[#f7f9fc] p-3">
                {selectedProducts.map((product) => (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => toggle(product)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#dce5f3] bg-white px-2.5 py-1.5 text-[11px] text-slate-600"
                  >
                    {product.name}
                    <X size={11} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
                尚未添加产品，请从下方目录勾选
              </div>
            )}
          </div>
          <div>
            <label className="block">
              <span className="mb-2 block text-sm font-medium">
                搜索并添加产品
              </span>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={15}
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入国家、套餐名、运营商或套餐代码"
                  className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#87a3d9]"
                />
              </div>
            </label>
            <div className="mt-3 grid max-h-[330px] gap-2 overflow-y-auto sm:grid-cols-2">
              {loading ? (
                <div className="col-span-full py-10 text-center text-xs text-slate-500">
                  正在查询完整套餐目录…
                </div>
              ) : (
                results.map((product) => {
                  const checked = selectedProducts.some(
                    (item) => item.id === product.id,
                  );
                  return (
                    <button
                      type="button"
                      key={product.id}
                      onClick={() => toggle(product)}
                      className={`${checked ? "border-[#6385bd] bg-[#eef3fb]" : "border-slate-200 bg-white"} flex items-start gap-3 rounded-xl border p-3 text-left`}
                    >
                      <span
                        className={`${checked ? "border-[#315c9f] bg-[#315c9f] text-white" : "border-slate-300"} mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border`}
                      >
                        {checked && <Check size={11} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-slate-700">
                          {product.name}
                        </span>
                        <span className="mt-1 block text-[10px] text-slate-400">
                          {product.country || "多地区"} · {product.packageCode}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {error && (
            <div className="rounded-xl bg-[#fff1ed] p-3 text-xs text-[#aa5644]">
              {error}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-100 bg-white p-5">
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
          >
            取消
          </button>
          <button
            disabled={saving || !name.trim()}
            className="h-11 rounded-xl bg-[#1d3b72] px-6 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving
              ? "正在保存"
              : `保存分组（${selectedProducts.length} 个产品）`}
          </button>
        </div>
      </form>
    </div>
  );
}

function LegacyGroupModal({
  group,
  close,
  save,
}: {
  group: any;
  close: () => void;
  save: (group: any) => void;
}) {
  const [name, setName] = useState(group?.name || "");
  const [codes, setCodes] = useState(group?.codes.join(", ") || "");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsedCodes = Array.from(
      new Set(
        codes
          .split(/[,，\s]+/)
          .map((code: string) => code.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    save({
      id: group?.id || `group-${Date.now()}`,
      name: name.trim(),
      codes: parsedCodes,
      accent: group?.accent || "bg-[#5578b6]",
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0d1b35]/55 backdrop-blur-[2px] sm:items-center sm:p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-[500px] rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6885bd]">
              分组管理
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {group ? "编辑国家或项目分组" : "新建国家或项目分组"}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">分组名称</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：日本市场组"
              className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#87a3d9]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">
              包含国家/地区代码
            </span>
            <input
              required
              value={codes}
              onChange={(event) => setCodes(event.target.value)}
              placeholder="例如：JP, KR, TW"
              className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-[#87a3d9]"
            />
            <span className="mt-2 block text-[11px] leading-5 text-slate-400">
              使用 ISO
              两位国家代码，多个国家用逗号分隔。保存后分组筛选立即生效。
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">默认可见成员</span>
            <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option>分组内全部成员</option>
              <option>仅管理员</option>
              <option>指定成员</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-600"
          >
            取消
          </button>
          <button
            type="submit"
            className="h-11 rounded-xl bg-[#1d3b72] px-6 text-sm font-medium text-white"
          >
            {group ? "保存修改" : "创建分组"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`${active ? "bg-white/10 text-white" : "text-blue-100/80 hover:bg-white/[.06] hover:text-white"} mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="grid min-w-5 place-items-center rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
function Metric({
  icon,
  iconClass,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-[18px] border border-[#e5e9f0] bg-white p-5 shadow-[0_4px_20px_rgba(28,48,82,.035)]">
      <div className="mb-5 flex items-center justify-between">
        <span
          className={`${iconClass} grid h-10 w-10 place-items-center rounded-xl`}
        >
          {icon}
        </span>
        <span className="text-[11px] text-slate-400">实时</span>
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1.5 text-[24px] font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-[11px] text-slate-500">{note}</p>
    </div>
  );
}
