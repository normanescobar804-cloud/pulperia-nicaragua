import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Check,
  X,
  ArrowRight,
  RefreshCw,
  Copy,
  AlertTriangle,
  Bell,
  Download,
  BookOpen,
  MessageCircle,
  Zap,
} from 'lucide-react';
import {
  Product,
  StoreProfile,
  Order,
  BillingSummary,
  PaymentMethodConfig,
  CreditRecord,
} from '../types';
import {
  api,
  formatPrice,
  categoryLabel,
  PAYMENT_PROVIDERS,
  getProductImageUrl,
  PRODUCT_CATEGORIES,
  NICARAGUA_DEPARTMENTS,
  OFFICIAL_PLATFORM_ACCOUNTS,
  exportProductsToCsv,
  buildWhatsAppOrderUrl,
} from '../utils/format';
import { RealProductModal } from './RealProductModal';
import { SalesAndPriceTrendsChart } from './SalesAndPriceTrendsChart';

interface BusinessDashboardProps {
  onNotify: (message: string, isError?: boolean) => void;
  onCatalogChanged: () => void;
}

type BusinessTab = 'overview' | 'orders' | 'products' | 'credits' | 'settings' | 'subscription';

export function BusinessDashboard({ onNotify, onCatalogChanged }: BusinessDashboardProps) {
  const [activeTab, setActiveTab] = useState<BusinessTab>('overview');
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<StoreProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [credits, setCredits] = useState<CreditRecord[]>([]);

  // Filters for catalog
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');

  // Product Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Store Settings State
  const [storeName, setStoreName] = useState('');
  const [storeDepartment, setStoreDepartment] = useState('Managua');
  const [storeDesc, setStoreDesc] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeDelivery, setStoreDelivery] = useState(true);
  const [storePickup, setStorePickup] = useState(true);
  const [storeDeliveryFee, setStoreDeliveryFee] = useState('25');
  const [methodDrafts, setMethodDrafts] = useState<
    Record<string, { enabled: boolean; recipient: string; account: string; instructions: string }>
  >({});

  // Automatic Recharge (C$ 100 / 200 products) State
  const [selectedBillingMethod, setSelectedBillingMethod] = useState<'mobile_wallet' | 'lafise'>('mobile_wallet');
  const [billingReference, setBillingReference] = useState('');
  const [rechargePackages, setRechargePackages] = useState(1);
  const [copiedAccountKey, setCopiedAccountKey] = useState<string | null>(null);
  const [submittingRecharge, setSubmittingRecharge] = useState(false);

  // Cuaderno de Fiado State
  const [creditCustomerName, setCreditCustomerName] = useState('');
  const [creditCustomerPhone, setCreditCustomerPhone] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [creditAmount, setCreditAmount] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [storeRes, prodRes, ordersRes, billingRes, creditsRes] = await Promise.all([
        api<{ store: StoreProfile }>('/api/store/me'),
        api<{ products: Product[] }>('/api/store/products'),
        api<{ orders: Order[] }>('/api/orders'),
        api<BillingSummary>('/api/billing/me'),
        api<{ credits: CreditRecord[] }>('/api/store/credits').catch(() => ({ credits: [] })),
      ]);

      setStore(storeRes.store);
      setProducts(prodRes.products);
      setOrders(ordersRes.orders);
      setBilling(billingRes);
      setCredits(creditsRes.credits || []);

      // Populate store form
      const s = storeRes.store;
      setStoreName(s.name);
      setStoreDepartment(s.department || 'Managua');
      setStoreDesc(s.description);
      setStorePhone(s.phone);
      setStoreAddress(s.address);
      setStoreDelivery(s.delivery);
      setStorePickup(s.pickup);
      setStoreDeliveryFee(String(s.deliveryFee));

      const draftMap: Record<
        string,
        { enabled: boolean; recipient: string; account: string; instructions: string }
      > = {};
      for (const provider of PAYMENT_PROVIDERS) {
        const saved = s.paymentMethods.find((m) => m.id === provider.id);
        draftMap[provider.id] = {
          enabled: Boolean(saved),
          recipient: saved?.recipient || '',
          account: saved?.account || '',
          instructions: saved?.instructions || '',
        };
      }
      setMethodDrafts(draftMap);
    } catch (err: any) {
      onNotify(err.message || 'Error al cargar datos de la pulpería', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      const catMatch = productCategoryFilter === 'all' || p.category === productCategoryFilter;
      const searchMatch =
        !q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q);
      return catMatch && searchMatch;
    });
  }, [products, productSearch, productCategoryFilter]);

  const metrics = useMemo(() => {
    const countStatus = (st: string) => orders.filter((o) => o.status === st).length;
    const thisMonthPrefix = new Date().toISOString().slice(0, 7);
    const completedThisMonth = orders.filter(
      (o) =>
        o.status === 'Completado' &&
        o.paymentStatus === 'paid' &&
        o.createdAt.startsWith(thisMonthPrefix)
    );
    const subtotalSales = completedThisMonth.reduce((sum, o) => sum + Number(o.subtotal), 0);
    const commission = completedThisMonth.reduce((sum, o) => sum + Number(o.platformFee), 0);
    const netSales = completedThisMonth.reduce((sum, o) => sum + Number(o.sellerNet), 0);
    const pendingCreditsTotal = credits
      .filter((c) => c.status === 'pendiente')
      .reduce((sum, c) => sum + Math.max(0, Number(c.amount) - Number(c.paidAmount)), 0);

    return {
      pendingPayment: orders.filter((o) => o.paymentStatus === 'verification_pending').length,
      pending: countStatus('Pendiente'),
      preparing: countStatus('Preparando'),
      onRoute: countStatus('En camino') + countStatus('Listo para retirar'),
      completed: countStatus('Completado'),
      subtotalSales,
      commission,
      netSales,
      lowStockCount: products.filter((p) => p.stock < 5).length,
      outOfStockCount: products.filter((p) => p.stock === 0).length,
      pendingCreditsTotal,
    };
  }, [orders, products, credits]);

  const productCount = store?.productCount ?? products.length;
  const productLimit = store?.productLimit ?? billing?.productLimit ?? 200;
  const remainingQuota = Math.max(0, productLimit - productCount);
  const isQuotaExhausted = remainingQuota === 0 || Boolean(store?.quotaExhausted);
  const trialDaysRemaining = store?.trialDaysRemaining ?? billing?.trialDaysRemaining ?? 3;

  const openModalForCreate = () => {
    if (isQuotaExhausted) {
      onNotify(
        `¡Se terminaron tus ${productLimit} productos habilitados! Recarga C$ 100 por Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049) para subir 200 productos más automáticamente.`,
        true
      );
      setActiveTab('subscription');
      return;
    }
    setEditingProduct(null);
    setIsProductModalOpen(true);
  };

  const openModalForEdit = (product: Product) => {
    setEditingProduct(product);
    setIsProductModalOpen(true);
  };

  const handleQuickRestock = async (product: Product, addUnits = 15) => {
    try {
      await api(`/api/products/${product.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: product.name,
          category: product.category,
          price: product.price,
          stock: Number(product.stock) + addUnits,
          description: product.description,
          image: product.image,
          storeId: product.storeId,
        }),
      });
      onNotify(`+${addUnits} unidades agregadas a "${product.name}".`);
      await loadAll();
      onCatalogChanged();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    try {
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      onNotify(`"${product.name}" retirado del catálogo.`);
      await loadAll();
      onCatalogChanged();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleSimulateQuotaExhausted = async (mode: 'exhaust' | 'reset') => {
    try {
      await api('/api/store/me/simulate-quota', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      await loadAll();
      if (mode === 'exhaust') {
        onNotify(
          `¡Notificación enviada al dueño de la pulpería! Se completaron los ${productLimit} productos. Recarga C$ 100 para habilitar otros 200 productos.`,
          true
        );
      } else {
        onNotify('Contador de prueba restablecido al inventario real.');
      }
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleVerifyPayment = async (order: Order, status: 'paid' | 'rejected') => {
    try {
      await api(`/api/orders/${encodeURIComponent(order.id)}/payment`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onNotify(
        status === 'paid'
          ? `Pago de ${order.id} confirmado. Listo para preparar.`
          : `Pago de ${order.id} rechazado e inventario restaurado.`
      );
      await loadAll();
      onCatalogChanged();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const getNextStatus = (order: Order): string | null => {
    if (order.paymentStatus !== 'paid') return null;
    if (order.status === 'Pendiente') return 'Preparando';
    if (order.status === 'Preparando') {
      return order.fulfillment === 'pickup' ? 'Listo para retirar' : 'En camino';
    }
    if (order.status === 'En camino' || order.status === 'Listo para retirar') {
      return 'Completado';
    }
    return null;
  };

  const handleAdvanceOrder = async (order: Order) => {
    const next = getNextStatus(order);
    if (!next) return;
    try {
      await api(`/api/orders/${encodeURIComponent(order.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      onNotify(`Pedido ${order.id} actualizado a "${next}".`);
      await loadAll();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleSaveStoreSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const paymentMethods: PaymentMethodConfig[] = [];
    for (const provider of PAYMENT_PROVIDERS) {
      const draft = methodDrafts[provider.id];
      if (draft?.enabled) {
        paymentMethods.push({
          id: provider.id,
          label: provider.label,
          recipient: draft.recipient.trim(),
          account: draft.account.trim(),
          instructions: draft.instructions.trim(),
        });
      }
    }

    try {
      const res = await api<{ store: StoreProfile }>('/api/store/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: storeName.trim(),
          department: storeDepartment,
          description: storeDesc.trim(),
          phone: storePhone.trim(),
          address: storeAddress.trim(),
          delivery: storeDelivery,
          pickup: storePickup,
          deliveryFee: Number(storeDeliveryFee || 0),
          paymentMethods,
        }),
      });
      setStore(res.store);
      onNotify(`Configuración de ${res.store.name} (${res.store.department}) guardada correctamente.`);
      onCatalogChanged();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleSubmitSubscriptionPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBillingMethod || billingReference.trim().length < 3) {
      onNotify(
        'Ingresa el número de comprobante de tu Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049).',
        true
      );
      return;
    }
    setSubmittingRecharge(true);
    try {
      const res = await api<{ message?: string; unlockedProducts?: number; amount?: number }>(
        '/api/billing/me/payments',
        {
          method: 'POST',
          body: JSON.stringify({
            method: selectedBillingMethod,
            reference: billingReference.trim(),
            packages: rechargePackages,
          }),
        }
      );
      setBillingReference('');
      onNotify(
        res.message ||
          `¡Recarga de C$ ${rechargePackages * 100} activada automáticamente! Ya puedes subir +${
            rechargePackages * 200
          } productos sin perder tus 3 días de prueba gratis.`
      );
      await loadAll();
      onCatalogChanged();
    } catch (err: any) {
      onNotify(err.message, true);
    } finally {
      setSubmittingRecharge(false);
    }
  };

  const handleCreateCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditCustomerName.trim() || !Number(creditAmount)) {
      onNotify('Escribe el nombre del cliente y el monto en córdobas (C$).', true);
      return;
    }
    try {
      await api('/api/store/credits', {
        method: 'POST',
        body: JSON.stringify({
          customerName: creditCustomerName.trim(),
          customerPhone: creditCustomerPhone.trim(),
          note: creditNote.trim(),
          amount: Number(creditAmount),
        }),
      });
      setCreditCustomerName('');
      setCreditCustomerPhone('');
      setCreditNote('');
      setCreditAmount('');
      onNotify('Fiado registrado en el cuaderno de la pulpería.');
      await loadAll();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleCreditAction = async (credit: CreditRecord, abono: number, markPaid = false) => {
    try {
      await api(`/api/store/credits/${credit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ abono, markPaid }),
      });
      onNotify(
        markPaid
          ? `Cuenta de ${credit.customerName} marcada como pagada.`
          : `Abono de ${formatPrice(abono)} registrado para ${credit.customerName}.`
      );
      await loadAll();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleDeleteCredit = async (creditId: number) => {
    try {
      await api(`/api/store/credits/${creditId}`, { method: 'DELETE' });
      onNotify('Registro eliminado del cuaderno de fiado.');
      await loadAll();
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedAccountKey(key);
    onNotify(`Copiado al portapapeles: ${text}`);
    setTimeout(() => setCopiedAccountKey(null), 2200);
  };

  if (loading && !store) {
    return (
      <div className="max-w-[1360px] mx-auto px-6 py-12">
        <div className="h-8 w-64 bg-stone-200 animate-pulse rounded mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-stone-100 border border-stone-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-6">
      {/* AUTOMATIC OWNER NOTIFICATION WHEN THE 200 PRODUCTS ARE EXHAUSTED */}
      {isQuotaExhausted && (
        <div
          className="bg-amber-950 text-white border-2 border-amber-500 rounded-xl p-5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4"
          role="alert"
        >
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-lg bg-amber-800/80 text-amber-200 shrink-0 mt-0.5">
              <Bell className="w-5 h-5 animate-bounce" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500 text-stone-950 font-semibold">
                  Aviso al Dueño de la Pulpería
                </span>
                <span className="text-xs text-amber-200 font-mono">
                  Cupo alcanzado: {productCount} / {productLimit} productos
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-semibold text-white">
                ¡Se terminaron tus {productLimit} productos disponibles para subir!
              </h2>
              <p className="text-xs sm:text-sm text-amber-100/90 leading-relaxed max-w-3xl">
                Recarga únicamente <strong>C$ 100 Córdobas</strong> a través de{' '}
                <strong>Billetera Móvil (+505 58898311)</strong> o{' '}
                <strong>Cuenta Bancaria LAFISE (134082049)</strong> para habilitar automáticamente{' '}
                <strong>+200 productos más</strong> al instante, sin quitar tus{' '}
                <strong>{trialDaysRemaining} días de prueba gratis</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('subscription')}
              className="px-4 py-2.5 text-xs font-semibold bg-amber-400 text-stone-950 rounded-lg hover:bg-amber-300 transition-colors flex items-center gap-1.5"
            >
              <Zap className="w-4 h-4" />
              Recargar C$ 100 (+200 productos)
            </button>
            <button
              type="button"
              onClick={() => handleSimulateQuotaExhausted('reset')}
              className="px-3 py-2 text-xs font-medium text-amber-200 border border-amber-700 rounded-lg hover:bg-amber-900/60"
            >
              Restaurar contador real
            </button>
          </div>
        </div>
      )}

      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1">
            <span className="font-medium text-stone-800">
              Cobertura Nacional · {store?.department || 'Managua'}, Nicaragua
            </span>
            <span aria-hidden="true">·</span>
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
              {trialDaysRemaining} días de prueba gratis incluidos (intactos)
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-stone-800 font-semibold">
              Cupo: {productCount}/{productLimit} productos ({remainingQuota} libres)
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold text-stone-900">
            {store?.name || 'Mi Pulpería'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('subscription')}
            className="px-3.5 py-2 text-xs font-medium text-amber-950 bg-amber-100/90 border border-amber-300 rounded-lg hover:bg-amber-200/80 transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Zap className="w-3.5 h-3.5 text-amber-800" />
            Recargar C$ 100 (+200 prod.)
          </button>
          <button
            type="button"
            onClick={loadAll}
            className="px-3.5 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
          <button
            type="button"
            onClick={openModalForCreate}
            className="px-4 py-2 text-xs font-medium text-white bg-amber-800 rounded-lg hover:bg-amber-900 transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Subir producto
          </button>
        </div>
      </div>

      {/* Workspace Layout: Sidebar (250px) + Content */}
      <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-8 pt-2">
        <aside className="space-y-1.5">
          {(
            [
              { id: 'overview', label: 'Resumen operativo' },
              { id: 'orders', label: `Pedidos y pagos (${orders.length})` },
              { id: 'products', label: `Catálogo (${productCount}/${productLimit})` },
              { id: 'subscription', label: 'Recarga C$ 100 y Cupo (200)' },
              { id: 'credits', label: `Cuaderno de Fiado (${credits.filter((c) => c.status === 'pendiente').length})` },
              { id: 'settings', label: 'Departamento y Bancos' },
            ] as { id: BusinessTab; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full text-left px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === item.id
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
              }`}
            >
              {item.label}
            </button>
          ))}

          {/* Product Quota Progress Widget in Sidebar */}
          <div className="pt-5 mt-5 border-t border-stone-200 px-3.5 space-y-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center justify-between font-medium text-stone-900">
                <span>Cupo de productos</span>
                <span className="font-mono">
                  {productCount} / {productLimit}
                </span>
              </div>
              <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isQuotaExhausted ? 'bg-red-600' : 'bg-amber-800'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(4, (productCount / Math.max(1, productLimit)) * 100))}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-stone-500">
                {isQuotaExhausted
                  ? '¡Cupo lleno! Recarga C$ 100 para habilitar +200 productos.'
                  : `Te quedan ${remainingQuota} productos disponibles en tu plan actual.`}
              </p>
            </div>

            <div className="p-3 bg-stone-100 border border-stone-200 rounded-lg space-y-1 text-[11px] text-stone-600">
              <div className="font-semibold text-stone-900">Tarifa Oficial Reducida</div>
              <div>• <strong>3 días de prueba gratis</strong> garantizados (no se pierden al recargar).</div>
              <div>• <strong>C$ 100 Córdobas</strong> = <strong>200 productos</strong> con activación automática.</div>
              <div>• Billetera Móvil: <span className="font-mono font-semibold text-stone-900">+505 58898311</span></div>
              <div>• Cuenta LAFISE: <span className="font-mono font-semibold text-stone-900">134082049</span></div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-8">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <>
              {/* KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-white border border-stone-200 rounded-lg p-4">
                  <p className="text-xs text-stone-500">Pagos por verificar</p>
                  <p className="text-2xl font-semibold font-mono tabular-nums text-amber-800 mt-1">
                    {metrics.pendingPayment}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-lg p-4">
                  <p className="text-xs text-stone-500">En preparación / Ruta</p>
                  <p className="text-2xl font-semibold font-mono tabular-nums text-stone-900 mt-1">
                    {metrics.preparing + metrics.onRoute}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-lg p-4">
                  <p className="text-xs text-stone-500">Cupo de productos</p>
                  <p className="text-xl font-semibold font-mono tabular-nums text-stone-900 mt-1">
                    {productCount}/{productLimit}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-lg p-4">
                  <p className="text-xs text-stone-500">Ventas mes (Bruto)</p>
                  <p className="text-xl font-semibold font-mono tabular-nums text-emerald-700 mt-1">
                    {formatPrice(metrics.subtotalSales)}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-lg p-4">
                  <p className="text-xs text-stone-500">Fiado por cobrar</p>
                  <p className="text-xl font-semibold font-mono tabular-nums text-amber-800 mt-1">
                    {formatPrice(metrics.pendingCreditsTotal)}
                  </p>
                </div>
                <div className="bg-white border border-stone-200 rounded-lg p-4">
                  <p className="text-xs text-stone-500">Poco stock (&lt;5 uds)</p>
                  <p className="text-2xl font-semibold font-mono tabular-nums text-amber-800 mt-1">
                    {metrics.lowStockCount}
                  </p>
                </div>
              </div>

              {/* 30-Day Sales Trends & Top Products Price Behavior Chart (Recharts) */}
              <SalesAndPriceTrendsChart orders={orders} products={products} />

              {/* Recent Orders Action Table */}
              <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-stone-900">Pedidos recientes</h2>
                    <p className="text-xs text-stone-500">
                      Verifica el comprobante bancario o prepara el pedido con aviso en tiempo real al cliente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('orders')}
                    className="text-xs font-medium text-amber-800 hover:underline whitespace-nowrap"
                  >
                    Ver todos los pedidos
                  </button>
                </div>

                {orders.length === 0 ? (
                  <div className="p-8 text-center text-sm text-stone-500">
                    Todavía no has recibido pedidos en tu pulpería.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                          <th className="py-2.5 px-4 font-medium">Pedido</th>
                          <th className="py-2.5 px-4 font-medium">Cliente / Entrega</th>
                          <th className="py-2.5 px-4 font-medium">Pago</th>
                          <th className="py-2.5 px-4 font-medium text-right">Total</th>
                          <th className="py-2.5 px-4 font-medium">Estado</th>
                          <th className="py-2.5 px-4 font-medium text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {orders.slice(0, 6).map((order) => {
                          const nextSt = getNextStatus(order);
                          return (
                            <tr key={order.id} className="hover:bg-stone-50/80 transition-colors">
                              <td className="py-3 px-4 font-mono text-xs font-medium text-stone-900 whitespace-nowrap">
                                {order.id}
                                <div className="text-[11px] text-stone-500 font-sans">
                                  {order.items.length} prod.
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="font-medium text-stone-900">{order.customerName}</div>
                                <div className="text-xs text-stone-500">
                                  {order.customerPhone} ·{' '}
                                  {order.fulfillment === 'delivery' ? 'Domicilio' : 'Retiro'}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs">
                                <div className="font-medium text-stone-800">{order.paymentLabel}</div>
                                <div className="font-mono text-stone-500">Ref: {order.paymentReference}</div>
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-stone-900 whitespace-nowrap">
                                {formatPrice(order.total)}
                              </td>
                              <td className="py-3 px-4 text-xs">
                                <span
                                  className={`font-medium ${
                                    order.paymentStatus === 'verification_pending'
                                      ? 'text-amber-700'
                                    : order.paymentStatus === 'rejected'
                                      ? 'text-red-700'
                                      : order.status === 'Completado'
                                      ? 'text-emerald-700'
                                      : 'text-stone-800'
                                  }`}
                                >
                                  {order.paymentStatus === 'verification_pending'
                                    ? 'Pago por verificar'
                                    : order.paymentStatus === 'rejected'
                                    ? 'Pago rechazado'
                                    : order.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                {order.paymentStatus === 'verification_pending' ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyPayment(order, 'paid')}
                                      className="px-2.5 py-1 text-xs font-medium bg-emerald-700 text-white rounded hover:bg-emerald-800 transition-colors"
                                    >
                                      Confirmar pago
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyPayment(order, 'rejected')}
                                      className="px-2.5 py-1 text-xs font-medium bg-stone-200 text-stone-800 rounded hover:bg-stone-300 transition-colors"
                                    >
                                      Rechazar
                                    </button>
                                  </div>
                                ) : nextSt ? (
                                  <button
                                    type="button"
                                    onClick={() => handleAdvanceOrder(order)}
                                    className="px-3 py-1 text-xs font-medium bg-stone-900 text-white rounded hover:bg-stone-800 transition-colors inline-flex items-center gap-1"
                                  >
                                    Pasar a {nextSt}
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <span className="text-xs text-stone-400">Sin acciones</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: ORDERS & PAYMENTS */}
          {activeTab === 'orders' && (
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-200">
                <h2 className="text-base font-semibold text-stone-900">
                  Gestión de pedidos y verificación de transferencias
                </h2>
                <p className="text-xs text-stone-500">
                  Revisa la referencia bancaria en tu Billetera Móvil, LAFISE, Banpro o RapiBAC antes de aprobar.
                </p>
              </div>

              {orders.length === 0 ? (
                <div className="p-10 text-center text-sm text-stone-500">
                  No hay pedidos registrados todavía.
                </div>
              ) : (
                <div className="divide-y divide-stone-200">
                  {orders.map((order) => {
                    const nextSt = getNextStatus(order);
                    return (
                      <div key={order.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                            <span className="font-mono font-semibold text-stone-900 text-sm">
                              {order.id}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {new Date(order.createdAt).toLocaleString('es-NI', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-stone-800">
                              {order.fulfillment === 'delivery'
                                ? `Entrega a domicilio (${order.address})`
                                : 'Retiro en pulpería'}
                            </span>
                          </div>

                          <div className="text-sm text-stone-900 font-medium flex items-center gap-3 flex-wrap">
                            <span>
                              Cliente: {order.customerName} · Tel:{' '}
                              <span className="font-mono">{order.customerPhone}</span>
                            </span>
                            <a
                              href={buildWhatsAppOrderUrl(order, order.customerPhone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Escribir por WhatsApp
                            </a>
                          </div>

                          <div className="text-xs text-stone-600 flex flex-wrap gap-x-3 gap-y-1">
                            {order.items.map((it, idx) => (
                              <span key={idx} className="font-mono">
                                {it.quantity}× {it.name} ({formatPrice(it.price * it.quantity)})
                              </span>
                            ))}
                          </div>

                          <div className="text-xs text-stone-500 pt-1">
                            Método: <strong className="text-stone-800">{order.paymentLabel}</strong> · Ref:{' '}
                            <span className="font-mono text-stone-900 font-medium">{order.paymentReference}</span> ·
                            Subtotal: <span className="font-mono">{formatPrice(order.subtotal)}</span> · Envío:{' '}
                            <span className="font-mono">{formatPrice(order.deliveryFee)}</span> · Neto pulpería:{' '}
                            <span className="font-mono text-emerald-700 font-medium">
                              {formatPrice(order.sellerNet)}
                            </span>
                          </div>
                        </div>

                        <div className="flex sm:items-center gap-3 shrink-0">
                          <div className="text-right">
                            <div className="text-xs text-stone-500">Total pedido</div>
                            <div className="text-lg font-semibold font-mono tabular-nums text-stone-900">
                              {formatPrice(order.total)}
                            </div>
                            <div className="text-xs font-medium text-stone-600">
                              {order.paymentStatus === 'verification_pending'
                                ? 'Pago por verificar'
                                : order.paymentStatus === 'rejected'
                                ? 'Pago rechazado'
                                : order.status}
                            </div>
                          </div>

                          {order.paymentStatus === 'verification_pending' ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleVerifyPayment(order, 'paid')}
                                className="px-3.5 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors flex items-center gap-1 whitespace-nowrap"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleVerifyPayment(order, 'rejected')}
                                className="px-3.5 py-2 text-xs font-medium bg-stone-200 text-stone-800 rounded-lg hover:bg-stone-300 transition-colors flex items-center gap-1 whitespace-nowrap"
                              >
                                <X className="w-3.5 h-3.5" />
                                Rechazar
                              </button>
                            </div>
                          ) : nextSt ? (
                            <button
                              type="button"
                              onClick={() => handleAdvanceOrder(order)}
                              className="px-4 py-2 text-xs font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                            >
                              Avanzar a {nextSt}
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PRODUCTS CATALOG */}
          {activeTab === 'products' && (
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <div className="p-5 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-stone-900">
                    Catálogo de productos ({productCount} de {productLimit} usados)
                  </h2>
                  <p className="text-xs text-stone-500">
                    Administra precios en córdobas, reabastece inventario en 1 clic o exporta tu lista a Excel (CSV).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Buscar producto..."
                      className="pl-8 pr-3 py-1.5 text-xs bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                    />
                  </div>
                  <select
                    value={productCategoryFilter}
                    onChange={(e) => setProductCategoryFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  >
                    <option value="all">Todas las categorías</option>
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => exportProductsToCsv(products, store?.name || 'mi-pulperia')}
                    className="px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exportar CSV
                  </button>
                </div>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <p className="text-sm text-stone-500">No se encontraron productos con ese filtro.</p>
                  <button
                    type="button"
                    onClick={openModalForCreate}
                    className="px-4 py-2 text-xs font-medium bg-amber-800 text-white rounded-lg hover:bg-amber-900"
                  >
                    Agregar primer producto
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                        <th className="py-2.5 px-4 font-medium">Producto</th>
                        <th className="py-2.5 px-4 font-medium">Categoría</th>
                        <th className="py-2.5 px-4 font-medium text-right">Precio</th>
                        <th className="py-2.5 px-4 font-medium text-right">Existencia</th>
                        <th className="py-2.5 px-4 font-medium text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {filteredProducts.map((product) => (
                        <tr key={product.id} className="hover:bg-stone-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={getProductImageUrl(product)}
                                alt={product.name}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded object-cover bg-stone-100 shrink-0"
                              />
                              <div>
                                <div className="font-medium text-stone-900">{product.name}</div>
                                <div className="text-xs text-stone-500 line-clamp-1">
                                  {product.description || 'Sin descripción'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-stone-600">
                            {categoryLabel(product.category)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-stone-900 whitespace-nowrap">
                            {formatPrice(product.price)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {product.stock < 5 ? (
                              <div className="inline-flex items-center justify-end gap-2">
                                <span className="px-2 py-0.5 text-[11px] font-sans font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded-md">
                                  Poco stock
                                </span>
                                <span className="text-amber-800 font-semibold">
                                  {product.stock} uds
                                </span>
                              </div>
                            ) : (
                              <span className="text-stone-800">{product.stock} uds</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {confirmDeleteId === product.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteProduct(product)}
                                  className="px-2.5 py-1 text-xs font-medium bg-red-700 text-white rounded hover:bg-red-800"
                                >
                                  Confirmar baja
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-xs text-stone-600 hover:text-stone-900"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleQuickRestock(product, 15)}
                                  title="Reabastecer +15 unidades en 1 clic"
                                  className="px-2 py-1 text-[11px] font-mono font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                                >
                                  +15 uds
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openModalForEdit(product)}
                                  className="p-1.5 text-stone-600 hover:text-stone-900 rounded hover:bg-stone-100"
                                  aria-label={`Editar ${product.name}`}
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(product.id)}
                                  className="p-1.5 text-stone-500 hover:text-red-700 rounded hover:bg-stone-100"
                                  aria-label={`Eliminar ${product.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CUADERNO DE FIADO DIGITAL (EXTRA OPTION FOR PULPERÍAS) */}
          {activeTab === 'credits' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white border border-stone-200 rounded-lg p-6 space-y-4">
                <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold uppercase tracking-wider">
                  <BookOpen className="w-4 h-4" />
                  <span>Cuaderno de Fiado Digital</span>
                </div>
                <h2 className="text-lg font-semibold text-stone-900">
                  Anotar crédito a vecino de confianza
                </h2>
                <p className="text-xs text-stone-500">
                  Lleva las cuentas claras de los fiados de quincena y envía recordatorios respetuosos por WhatsApp.
                </p>

                <form onSubmit={handleCreateCredit} className="space-y-3.5 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      Nombre del vecino / cliente
                    </label>
                    <input
                      type="text"
                      required
                      value={creditCustomerName}
                      onChange={(e) => setCreditCustomerName(e.target.value)}
                      placeholder="Ej. Doña Rosa Pineda (Casa portón azul)"
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1">
                        Teléfono / WhatsApp
                      </label>
                      <input
                        type="tel"
                        value={creditCustomerPhone}
                        onChange={(e) => setCreditCustomerPhone(e.target.value)}
                        placeholder="8888-8888"
                        className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1">
                        Monto fiado (C$)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                        placeholder="150"
                        className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      Productos entregados / Nota
                    </label>
                    <textarea
                      rows={2}
                      value={creditNote}
                      onChange={(e) => setCreditNote(e.target.value)}
                      placeholder="Ej. 2 lb arroz, 1 lb queso seco, 1 aceite — cancela el 15"
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors"
                  >
                    Anotar en el Cuaderno de Fiado
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7 bg-white border border-stone-200 rounded-lg overflow-hidden">
                <div className="p-5 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-stone-900">
                      Cuentas por cobrar en el barrio
                    </h3>
                    <p className="text-xs text-stone-500">
                      Saldo pendiente total:{' '}
                      <strong className="font-mono text-amber-800">
                        {formatPrice(metrics.pendingCreditsTotal)}
                      </strong>
                    </p>
                  </div>
                </div>

                {credits.length === 0 ? (
                  <div className="p-10 text-center text-sm text-stone-500">
                    No tienes cuentas pendientes en el cuaderno de fiado.
                  </div>
                ) : (
                  <div className="divide-y divide-stone-200">
                    {credits.map((c) => {
                      const remaining = Math.max(0, Number(c.amount) - Number(c.paidAmount));
                      const cleanPhone = String(c.customerPhone || '50558898311').replace(/[^\d]/g, '');
                      const waPhone = cleanPhone.startsWith('505') ? cleanPhone : `505${cleanPhone}`;
                      const waReminder = `https://wa.me/${waPhone}?text=${encodeURIComponent(
                        `Hola ${c.customerName}, le saludamos de ${store?.name}. Le recordamos amablemente su saldo pendiente en el cuaderno por ${formatPrice(
                          remaining
                        )} (${c.note || 'compra en pulpería'}). ¡Muchas gracias!`
                      )}`;
                      return (
                        <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-stone-900 text-sm">
                                {c.customerName}
                              </span>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                                  c.status === 'pagado'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-900'
                                }`}
                              >
                                {c.status === 'pagado' ? 'Cancelado' : 'Pendiente'}
                              </span>
                            </div>
                            <p className="text-xs text-stone-600">{c.note || 'Compra anotada'}</p>
                            <div className="text-xs text-stone-500 font-mono">
                              Total: {formatPrice(c.amount)} · Abonado: {formatPrice(c.paidAmount)} ·{' '}
                              <strong className="text-stone-900">Resta: {formatPrice(remaining)}</strong>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {c.status === 'pendiente' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleCreditAction(c, 50, false)}
                                  className="px-2.5 py-1.5 text-xs font-mono font-medium bg-stone-100 border border-stone-300 rounded hover:bg-stone-200"
                                >
                                  +Abonar C$ 50
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCreditAction(c, 0, true)}
                                  className="px-2.5 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded hover:bg-emerald-800"
                                >
                                  Saldar cuenta
                                </button>
                                {c.customerPhone && (
                                  <a
                                    href={waReminder}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 inline-flex items-center gap-1"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    WhatsApp
                                  </a>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteCredit(c.id)}
                              className="p-1.5 text-stone-400 hover:text-red-700"
                              title="Eliminar registro"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: STORE SETTINGS, DEPARTMENT & BANK ACCOUNTS */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveStoreSettings} className="bg-white border border-stone-200 rounded-lg p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-stone-900">
                  Cobertura Nacional en Nicaragua, Dirección y Cuentas de la Pulpería
                </h2>
                <p className="text-xs text-stone-500">
                  Selecciona el departamento donde opera tu pulpería para que clientes de toda Nicaragua te encuentren.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Nombre de la pulpería
                  </label>
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Departamento de Nicaragua
                  </label>
                  <select
                    value={storeDepartment}
                    onChange={(e) => setStoreDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-stone-900"
                  >
                    {NICARAGUA_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Teléfono / WhatsApp de atención
                  </label>
                  <input
                    type="text"
                    required
                    value={storePhone}
                    onChange={(e) => setStorePhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg font-mono focus:outline-none focus:border-stone-900"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Dirección de referencia (estilo nica)
                  </label>
                  <input
                    type="text"
                    value={storeAddress}
                    onChange={(e) => setStoreAddress(e.target.value)}
                    placeholder="Ej. Barrio Monseñor Lezcano, de la Estatua 2c. al Sur"
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Descripción corta
                  </label>
                  <textarea
                    rows={2}
                    value={storeDesc}
                    onChange={(e) => setStoreDesc(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-stone-200">
                <label className="flex items-center gap-2.5 text-sm text-stone-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storeDelivery}
                    onChange={(e) => setStoreDelivery(e.target.checked)}
                    className="w-4 h-4 accent-amber-800"
                  />
                  Ofrecer entrega a domicilio
                </label>
                <label className="flex items-center gap-2.5 text-sm text-stone-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storePickup}
                    onChange={(e) => setStorePickup(e.target.checked)}
                    className="w-4 h-4 accent-amber-800"
                  />
                  Ofrecer retiro en pulpería
                </label>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Tarifa de envío a domicilio (C$)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={storeDeliveryFee}
                    onChange={(e) => setStoreDeliveryFee(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-stone-200 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900">
                    Cuentas bancarias y modalidades de cobro para tus clientes
                  </h3>
                  <p className="text-xs text-stone-500">
                    Activa los bancos o pago en efectivo donde tus clientes pueden pagarte directamente.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PAYMENT_PROVIDERS.map((provider) => {
                    const draft = methodDrafts[provider.id] || {
                      enabled: false,
                      recipient: '',
                      account: '',
                      instructions: '',
                    };
                    return (
                      <div
                        key={provider.id}
                        className={`p-4 rounded-lg border transition-colors ${
                          draft.enabled ? 'border-stone-800 bg-stone-50/60' : 'border-stone-200'
                        }`}
                      >
                        <label className="flex items-center gap-2 font-semibold text-sm text-stone-900 cursor-pointer mb-3">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(e) =>
                              setMethodDrafts((prev) => ({
                                ...prev,
                                [provider.id]: { ...draft, enabled: e.target.checked },
                              }))
                            }
                            className="w-4 h-4 accent-amber-800"
                          />
                          {provider.label}
                        </label>

                        {draft.enabled && (
                          <div className="space-y-2.5 text-xs">
                            <div>
                              <span className="block text-stone-600 mb-0.5">Nombre del titular</span>
                              <input
                                type="text"
                                required
                                value={draft.recipient}
                                onChange={(e) =>
                                  setMethodDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...draft, recipient: e.target.value },
                                  }))
                                }
                                placeholder="Nombre completo"
                                className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded"
                              />
                            </div>
                            <div>
                              <span className="block text-stone-600 mb-0.5">Número de cuenta o celular</span>
                              <input
                                type="text"
                                required
                                value={draft.account}
                                onChange={(e) =>
                                  setMethodDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...draft, account: e.target.value },
                                  }))
                                }
                                placeholder="Ej. 134082049 o +505 58898311"
                                className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded font-mono"
                              />
                            </div>
                            <div>
                              <span className="block text-stone-600 mb-0.5">Instrucciones opcionales</span>
                              <input
                                type="text"
                                value={draft.instructions}
                                onChange={(e) =>
                                  setMethodDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...draft, instructions: e.target.value },
                                  }))
                                }
                                placeholder="Ej. Enviar comprobante o referencia"
                                className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  className="px-5 py-2.5 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors"
                >
                  Guardar cambios de la pulpería
                </button>
              </div>
            </form>
          )}

          {/* TAB 6: AUTOMATIC RECHARGE C$ 100 / 200 PRODUCTS & 3-DAY FREE TRIAL */}
          {activeTab === 'subscription' && billing && (
            <div className="space-y-6">
              {/* Top Status Summary Card */}
              <div className="bg-white border border-stone-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-1">
                  <span className="text-xs text-stone-500">Prueba Gratis de la App</span>
                  <div className="text-xl font-semibold text-emerald-700">
                    {trialDaysRemaining} días de prueba gratis activos
                  </div>
                  <p className="text-xs text-stone-600">
                    Tus 3 días de prueba gratis <strong>nunca se quitan</strong> aunque recargues antes o subas productos hoy mismo.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span>Cupo de Productos Publicados</span>
                    <span className="font-mono font-semibold text-stone-900">
                      {productCount} / {productLimit}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-100 border border-stone-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isQuotaExhausted ? 'bg-red-600' : 'bg-amber-800'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(5, (productCount / Math.max(1, productLimit)) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-stone-600">
                      {isQuotaExhausted
                        ? '¡Cupo de 200 productos agotado!'
                        : `${remainingQuota} productos disponibles para subir`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleSimulateQuotaExhausted(isQuotaExhausted ? 'reset' : 'exhaust')
                      }
                      className="text-[11px] font-medium text-amber-800 hover:underline"
                    >
                      {isQuotaExhausted
                        ? 'Restaurar contador real'
                        : 'Probar alerta de 200 agotados'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-stone-500">Tarifa Oficial Reducida</span>
                  <div className="text-xl font-semibold font-mono text-stone-900">
                    C$ 100 = +200 productos
                  </div>
                  <p className="text-xs text-stone-600">
                    Activación automática inmediata al registrar tu transferencia a Billetera Móvil o Cuenta LAFISE.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Official Recharge Accounts & Instant Activation Form */}
                <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
                  <div>
                    <div className="text-xs text-amber-800 font-semibold uppercase tracking-wider">
                      Recarga Automática Oficial · Toda Nicaragua
                    </div>
                    <h2 className="text-lg font-semibold text-stone-900 mt-0.5">
                      Recargar C$ 100 para habilitar +200 productos al instante
                    </h2>
                    <p className="text-xs text-stone-500 mt-1">
                      Transfiere a cualquiera de las dos cuentas oficiales y tu cupo de 200 productos se habilitará automáticamente sin quitar tus 3 días de prueba gratis.
                    </p>
                  </div>

                  {/* Official Accounts Cards (+505 58898311 & LAFISE 134082049) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {OFFICIAL_PLATFORM_ACCOUNTS.map((acc) => {
                      const isSelected = selectedBillingMethod === acc.id;
                      return (
                        <div
                          key={acc.id}
                          onClick={() => setSelectedBillingMethod(acc.id)}
                          className={`p-4 rounded-xl border text-left cursor-pointer transition-all space-y-2 ${
                            isSelected
                              ? 'border-amber-800 bg-amber-50/70 shadow-xs'
                              : 'border-stone-200 hover:border-stone-300 bg-stone-50/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-stone-900">
                              {acc.label}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(acc.account, acc.id);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 hover:underline"
                            >
                              {copiedAccountKey === acc.id ? (
                                <>
                                  <Check className="w-3 h-3" /> Copiado
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" /> Copiar
                                </>
                              )}
                            </button>
                          </div>
                          <div className="text-base font-mono font-bold text-stone-900">
                            {acc.account}
                          </div>
                          <div className="text-[11px] text-stone-600">
                            Titular: <strong>{acc.recipient}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <form onSubmit={handleSubmitSubscriptionPayment} className="space-y-4 pt-2 border-t border-stone-200">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1.5">
                        Selecciona cuántos paquetes de 200 productos deseas activar
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { pkg: 1, label: 'C$ 100', sub: '+200 productos' },
                          { pkg: 2, label: 'C$ 200', sub: '+400 productos' },
                          { pkg: 3, label: 'C$ 300', sub: '+600 productos' },
                        ].map((opt) => (
                          <button
                            key={opt.pkg}
                            type="button"
                            onClick={() => setRechargePackages(opt.pkg)}
                            className={`p-2.5 rounded-lg border text-center transition-colors ${
                              rechargePackages === opt.pkg
                                ? 'border-stone-900 bg-stone-900 text-white'
                                : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                            }`}
                          >
                            <div className="text-xs font-mono font-semibold">{opt.label}</div>
                            <div className="text-[11px] opacity-85">{opt.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1">
                        Número de comprobante o referencia ({selectedBillingMethod === 'mobile_wallet' ? 'Billetera Móvil +505 58898311' : 'Cuenta LAFISE 134082049'})
                      </label>
                      <input
                        type="text"
                        required
                        value={billingReference}
                        onChange={(e) => setBillingReference(e.target.value)}
                        placeholder={
                          selectedBillingMethod === 'mobile_wallet'
                            ? 'Ej. BM-58898311-01'
                            : 'Ej. LAFISE-134082049-01'
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-lg"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <button
                        type="submit"
                        disabled={submittingRecharge}
                        className="flex-1 py-2.5 px-4 text-xs font-semibold text-white bg-amber-800 rounded-lg hover:bg-amber-900 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Zap className="w-4 h-4" />
                        <span>
                          {submittingRecharge
                            ? 'Activando cupo...'
                            : `Activar +${rechargePackages * 200} productos automáticamente (C$ ${
                                rechargePackages * 100
                              })`}
                        </span>
                      </button>

                      <a
                        href={`https://wa.me/50558898311?text=${encodeURIComponent(
                          `Hola, acabo de realizar una recarga de C$ ${
                            rechargePackages * 100
                          } para mi pulpería "${store?.name}" (${
                            store?.department
                          }) por ${
                            selectedBillingMethod === 'mobile_wallet'
                              ? 'Billetera Móvil (+505 58898311)'
                              : 'Cuenta LAFISE (134082049)'
                          }. Referencia: ${billingReference || 'Adjunto comprobante'}.`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-2.5 px-3.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                      >
                        <MessageCircle className="w-4 h-4" />
                        WhatsApp +505 58898311
                      </a>
                    </div>
                  </form>
                </div>

                {/* Recharge History */}
                <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-stone-900">
                    Historial de recargas y cupos habilitados
                  </h2>
                  {billing.payments.length === 0 ? (
                    <p className="text-sm text-stone-500">
                      Todavía no has registrado recargas adicionales. Estás usando tus 3 días de prueba gratis con 200 productos incluidos.
                    </p>
                  ) : (
                    <div className="divide-y divide-stone-200 text-sm">
                      {billing.payments.map((p) => (
                        <div key={p.id} className="py-3 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-stone-900">
                              {p.method === 'mobile_wallet'
                                ? 'Billetera Móvil (+505 58898311)'
                                : p.method === 'lafise'
                                ? 'Cuenta LAFISE (134082049)'
                                : PAYMENT_PROVIDERS.find((x) => x.id === p.method)?.label || p.method}{' '}
                              · <span className="font-mono text-xs">Ref. {p.reference}</span>
                            </div>
                            <div className="text-xs text-stone-500">
                              {new Date(p.createdAt).toLocaleDateString('es-NI', { dateStyle: 'medium' })} ·{' '}
                              <span className="font-mono text-stone-700">
                                +{p.productsAdded || 200} productos habilitados
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-medium text-stone-900">
                              {formatPrice(p.amount)}
                            </div>
                            <div
                              className={`text-xs font-medium ${
                                p.status === 'paid'
                                  ? 'text-emerald-700'
                                  : p.status === 'rejected'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {p.status === 'paid'
                                ? 'Activado automáticamente'
                                : p.status === 'rejected'
                                ? 'Rechazado'
                                : 'Pendiente'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Real Product Create/Edit Modal */}
      <RealProductModal
        isOpen={isProductModalOpen}
        onClose={() => {
          setIsProductModalOpen(false);
          setEditingProduct(null);
        }}
        editingProduct={editingProduct}
        stores={
          store
            ? [
                {
                  id: store.id,
                  name: store.name,
                  department: store.department || 'Managua',
                  description: store.description,
                  phone: store.phone,
                  address: store.address,
                  delivery: store.delivery,
                  pickup: store.pickup,
                  deliveryFee: store.deliveryFee,
                  productCount: store.productCount,
                  productLimit: store.productLimit,
                  paymentMethods: store.paymentMethods,
                },
              ]
            : []
        }
        defaultStoreId={store?.id}
        onSaved={async () => {
          await loadAll();
          onCatalogChanged();
        }}
        onNotify={onNotify}
      />
    </div>
  );
}
