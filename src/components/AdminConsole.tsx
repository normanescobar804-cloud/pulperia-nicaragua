import React, { useState } from 'react';
import { Check, X, KeyRound, RefreshCw } from 'lucide-react';
import { AdminSummary } from '../types';
import { api, formatPrice, PAYMENT_PROVIDERS } from '../utils/format';

interface AdminConsoleProps {
  onNotify: (message: string, isError?: boolean) => void;
}

export function AdminConsole({ onNotify }: AdminConsoleProps) {
  const [adminKey, setAdminKey] = useState('admin-pulperia-2026');
  const [unlocked, setUnlocked] = useState(false);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [methodDrafts, setMethodDrafts] = useState<
    Record<string, { enabled: boolean; recipient: string; account: string; instructions: string }>
  >({});

  const fetchAdminSummary = async (keyToUse = adminKey) => {
    setLoading(true);
    try {
      const data = await api<AdminSummary>('/api/admin/summary', {
        headers: { 'x-admin-key': keyToUse },
      });
      setSummary(data);
      setUnlocked(true);

      const drafts: Record<
        string,
        { enabled: boolean; recipient: string; account: string; instructions: string }
      > = {};
      for (const provider of PAYMENT_PROVIDERS) {
        const saved = data.paymentMethods.find((m) => m.id === provider.id);
        drafts[provider.id] = {
          enabled: Boolean(saved),
          recipient: saved?.recipient || '',
          account: saved?.account || '',
          instructions: saved?.instructions || '',
        };
      }
      setMethodDrafts(drafts);
    } catch (err: any) {
      onNotify(err.message || 'Clave administrativa inválida', true);
      setUnlocked(false);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveSubscription = async (id: number, status: 'paid' | 'rejected') => {
    try {
      await api(`/api/admin/subscription-payments/${id}`, {
        method: 'PATCH',
        headers: { 'x-admin-key': adminKey },
        body: JSON.stringify({ status }),
      });
      onNotify(
        status === 'paid'
          ? 'Renovación verificada (+30 días activados para la pulpería).'
          : 'Solicitud de suscripción rechazada.'
      );
      await fetchAdminSummary(adminKey);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleSavePlatformMethods = async (e: React.FormEvent) => {
    e.preventDefault();
    const methods = PAYMENT_PROVIDERS.flatMap((provider) => {
      const d = methodDrafts[provider.id];
      if (!d?.enabled) return [];
      return [
        {
          id: provider.id,
          recipient: d.recipient.trim(),
          account: d.account.trim(),
          instructions: d.instructions.trim(),
        },
      ];
    });

    try {
      await api('/api/admin/payment-methods', {
        method: 'PUT',
        headers: { 'x-admin-key': adminKey },
        body: JSON.stringify({ methods }),
      });
      onNotify('Cuentas receptoras de la plataforma actualizadas.');
      await fetchAdminSummary(adminKey);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
          <div className="space-y-1">
            <div className="text-xs text-stone-500">Administración de Plataforma</div>
            <h1 className="text-2xl font-semibold text-stone-900">Control de Suscripciones y Comisiones</h1>
            <p className="text-xs text-stone-600">
              Ingresa la clave maestra definida en <span className="font-mono">PULPERIA_ADMIN_KEY</span> para verificar pagos de pulperías.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchAdminSummary(adminKey);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Clave administrativa
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                />
              </div>
              <p className="text-[11px] text-stone-500 mt-1">
                Clave demo preconfigurada: <span className="font-mono text-stone-800">admin-pulperia-2026</span>
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors"
            >
              {loading ? 'Verificando...' : 'Abrir consola administrativa'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <div className="text-xs text-stone-500">Administración Central · Pulpería Nicaragua</div>
          <h1 className="text-2xl md:text-3xl font-semibold text-stone-900">
            Recaudación y Renovaciones de Pulperías
          </h1>
        </div>
        <button
          type="button"
          onClick={() => fetchAdminSummary(adminKey)}
          className="px-3.5 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 flex items-center gap-1.5 self-start"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refrescar
        </button>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <p className="text-xs text-stone-500">Comisiones acumuladas (3%)</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-stone-900 mt-1">
                {formatPrice(summary.commissionTotal)}
              </p>
              <p className="text-xs text-stone-500 mt-1">En pedidos pagados y completados</p>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <p className="text-xs text-stone-500">Suscripciones verificadas</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-emerald-700 mt-1">
                {formatPrice(summary.subscriptionTotal)}
              </p>
              <p className="text-xs text-stone-500 mt-1">Tarifa mensual: {formatPrice(summary.monthlyFee)}</p>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <p className="text-xs text-stone-500">Transferencias por revisar</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-amber-800 mt-1">
                {summary.pendingPayments.length}
              </p>
              <p className="text-xs text-stone-500 mt-1">Renovaciones de 30 días</p>
            </div>
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <p className="text-xs text-stone-500">Pulperías registradas</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-stone-900 mt-1">
                {summary.allStoresCount ?? 2}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                {summary.totalOrdersCount ?? 0} pedidos procesados
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-200">
                <h2 className="text-base font-semibold text-stone-900">
                  Solicitudes de renovación pendientes
                </h2>
                <p className="text-xs text-stone-500">
                  Al confirmar, la suscripción de la pulpería se extiende automáticamente por 30 días.
                </p>
              </div>

              {summary.pendingPayments.length === 0 ? (
                <div className="p-8 text-center text-sm text-stone-500">
                  No hay transferencias de suscripción pendientes de revisión.
                </div>
              ) : (
                <div className="divide-y divide-stone-200">
                  {summary.pendingPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="font-semibold text-stone-900">{payment.storeName}</div>
                        <div className="text-xs text-stone-600">
                          {PAYMENT_PROVIDERS.find((p) => p.id === payment.method)?.label || payment.method} · Ref:{' '}
                          <span className="font-mono font-medium text-stone-900">{payment.reference}</span> ·{' '}
                          <span className="font-mono font-semibold text-emerald-700">
                            {formatPrice(payment.amount)}
                          </span>
                        </div>
                        <div className="text-xs text-stone-500">{payment.ownerEmail}</div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleResolveSubscription(payment.id, 'paid')}
                          className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveSubscription(payment.id, 'rejected')}
                          className="px-3 py-1.5 text-xs font-medium bg-stone-200 text-stone-800 rounded-lg hover:bg-stone-300 flex items-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={handleSavePlatformMethods}
              className="bg-white border border-stone-200 rounded-lg p-6 space-y-4"
            >
              <div>
                <h2 className="text-base font-semibold text-stone-900">
                  Cuentas receptoras oficiales de Pulpería Nicaragua
                </h2>
                <p className="text-xs text-stone-500">
                  Cuentas donde los dueños de pulperías recargan C$ 100 por cada 200 productos (Billetera Móvil +505 58898311 y LAFISE 134082049).
                </p>
              </div>

              <div className="space-y-3">
                {PAYMENT_PROVIDERS.map((provider) => {
                  const d = methodDrafts[provider.id] || {
                    enabled: false,
                    recipient: '',
                    account: '',
                    instructions: '',
                  };
                  return (
                    <div key={provider.id} className="p-3.5 border border-stone-200 rounded-lg space-y-2">
                      <label className="flex items-center gap-2 text-sm font-semibold text-stone-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) =>
                            setMethodDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...d, enabled: e.target.checked },
                            }))
                          }
                          className="w-4 h-4 accent-amber-800"
                        />
                        {provider.label}
                      </label>
                      {d.enabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                          <input
                            type="text"
                            required
                            value={d.recipient}
                            onChange={(e) =>
                              setMethodDrafts((prev) => ({
                                ...prev,
                                [provider.id]: { ...d, recipient: e.target.value },
                              }))
                            }
                            placeholder="Titular"
                            className="px-2.5 py-1.5 border border-stone-300 rounded"
                          />
                          <input
                            type="text"
                            required
                            value={d.account}
                            onChange={(e) =>
                              setMethodDrafts((prev) => ({
                                ...prev,
                                [provider.id]: { ...d, account: e.target.value },
                              }))
                            }
                            placeholder="Cuenta o teléfono"
                            className="px-2.5 py-1.5 border border-stone-300 rounded font-mono"
                          />
                          <input
                            type="text"
                            value={d.instructions}
                            onChange={(e) =>
                              setMethodDrafts((prev) => ({
                                ...prev,
                                [provider.id]: { ...d, instructions: e.target.value },
                              }))
                            }
                            placeholder="Instrucciones para transferencia"
                            className="sm:col-span-2 px-2.5 py-1.5 border border-stone-300 rounded"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors"
              >
                Guardar cuentas receptoras
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
