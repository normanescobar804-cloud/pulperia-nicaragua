import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, ArrowLeft, Check, Bell, ArrowRight } from 'lucide-react';
import { Order } from '../types';
import { api, formatPrice } from '../utils/format';
import {
  OrderStatusNotification,
  reconcileOrdersSnapshot,
  requestBrowserNotificationPermission,
} from '../utils/orderNotifications';

interface CustomerOrdersProps {
  highlightOrderId?: string | null;
  onBackToCatalog: () => void;
  onNotify: (message: string, isError?: boolean) => void;
  notifications?: OrderStatusNotification[];
  onOrderStatusNotification?: (notif: OrderStatusNotification) => void;
  lastUpdateVersion?: number;
}

export function CustomerOrders({
  highlightOrderId,
  onBackToCatalog,
  onNotify,
  notifications = [],
  onOrderStatusNotification,
  lastUpdateVersion = 0,
}: CustomerOrdersProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancingOrderId, setAdvancingOrderId] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] = useState<string>(() => {
    return typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported';
  });

  const knownOrdersRef = useRef<Map<string, { status: string; paymentStatus: string }>>(new Map());

  const loadOrders = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<{ orders: Order[] }>('/api/orders');
      if (onOrderStatusNotification) {
        reconcileOrdersSnapshot(knownOrdersRef.current, res.orders, onOrderStatusNotification);
      }
      setOrders(res.orders);
    } catch (err: any) {
      if (!silent) {
        onNotify(err.message || 'No se pudieron cargar tus pedidos.', true);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const timer = window.setInterval(() => loadOrders(true), 12000);
    return () => window.clearInterval(timer);
  }, []);

  // Reload immediately whenever an SSE status notification arrives
  useEffect(() => {
    if (lastUpdateVersion > 0) {
      loadOrders(true);
    }
  }, [lastUpdateVersion]);

  const getNextStageForOrder = (order: Order): { type: 'payment' | 'status'; nextLabel: string } => {
    if (order.paymentStatus === 'verification_pending') {
      return { type: 'payment', nextLabel: 'Pendiente (Confirmar pago)' };
    }
    if (order.status === 'Pendiente') {
      return { type: 'status', nextLabel: 'Preparando' };
    }
    if (order.status === 'Preparando') {
      return {
        type: 'status',
        nextLabel: order.fulfillment === 'pickup' ? 'Listo para retirar' : 'En camino',
      };
    }
    if (order.status === 'En camino' || order.status === 'Listo para retirar') {
      return { type: 'status', nextLabel: 'Completado' };
    }
    return { type: 'status', nextLabel: 'Preparando' };
  };

  const handleAdvanceStage = async (order: Order) => {
    const nextAction = getNextStageForOrder(order);
    setAdvancingOrderId(order.id);
    try {
      if (nextAction.type === 'payment') {
        await api(`/api/orders/${encodeURIComponent(order.id)}/payment`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'paid' }),
        });
      } else {
        await api(`/api/orders/${encodeURIComponent(order.id)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextAction.nextLabel }),
        });
      }
      await loadOrders(true);
    } catch (err: any) {
      onNotify(err.message || 'No se pudo actualizar el estado del pedido.', true);
    } finally {
      setAdvancingOrderId(null);
    }
  };

  const handleEnableBrowserAlerts = async () => {
    const granted = await requestBrowserNotificationPermission();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
    if (granted) {
      onNotify('Notificaciones del navegador activadas para tus pedidos.');
    } else {
      onNotify('Las alertas se mostrarán en tiempo real dentro de la aplicación.');
    }
  };

  return (
    <div className="max-w-[1120px] mx-auto px-6 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <button
            type="button"
            onClick={onBackToCatalog}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-900 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver al catálogo del barrio
          </button>
          <h1 className="text-2xl md:text-3xl font-semibold text-stone-900">
            Mis Pedidos y Seguimiento en Vivo
          </h1>
          <p className="text-sm text-stone-600 mt-1">
            Recibe avisos automáticos cuando tu pulpería cambie el estado (ej. de &ldquo;Preparando&rdquo; a &ldquo;En camino&rdquo;).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          {browserPermission === 'default' && (
            <button
              type="button"
              onClick={handleEnableBrowserAlerts}
              className="px-3.5 py-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Bell className="w-3.5 h-3.5 text-amber-800" />
              Activar avisos del navegador
            </button>
          )}
          <button
            type="button"
            onClick={() => loadOrders()}
            disabled={loading}
            className="px-4 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar estado
          </button>
        </div>
      </div>

      {/* Live Notification Feed Strip (shows recent status transitions) */}
      {notifications.length > 0 && (
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-amber-950 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-800" />
              Últimos avisos de cambio de estado en tus pedidos
            </span>
            <span className="text-amber-800 font-mono">{notifications.length} aviso(s)</span>
          </div>
          <div className="divide-y divide-amber-200/70 text-xs">
            {notifications.slice(0, 3).map((n) => (
              <div key={n.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="text-stone-800">
                  <span className="font-mono font-semibold text-stone-900">{n.orderId}</span> ·{' '}
                  <span>{n.storeName}:</span>{' '}
                  <span className="line-through text-stone-500">{n.previousStatus}</span>{' '}
                  <span aria-hidden="true">→</span>{' '}
                  <strong className="text-amber-900">{n.newStatus}</strong>
                </div>
                <span className="text-[11px] font-mono text-stone-500 shrink-0">
                  {new Date(n.timestamp).toLocaleTimeString('es-NI', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {highlightOrderId && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-center justify-between">
          <div>
            <strong>Pedido {highlightOrderId} enviado con éxito.</strong> Te avisaremos con una notificación en cuanto la pulpería actualice su estado.
          </div>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-44 bg-stone-100 border border-stone-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center space-y-4">
          <h2 className="text-lg font-semibold text-stone-900">Todavía no has realizado pedidos</h2>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Arma tu canasta con productos frescos de tu pulpería más cercana y realiza tu pago por transferencia bancaria o billetera móvil.
          </p>
          <button
            type="button"
            onClick={onBackToCatalog}
            className="px-5 py-2.5 text-xs font-medium text-white bg-amber-800 rounded-lg hover:bg-amber-900 transition-colors"
          >
            Explorar productos
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const stages = [
              'Pendiente',
              'Preparando',
              order.fulfillment === 'pickup' ? 'Listo para retirar' : 'En camino',
              'Completado',
            ];
            const currentIdx = stages.indexOf(order.status);
            const isHighlighted = highlightOrderId === order.id;
            const nextAction = getNextStageForOrder(order);

            return (
              <article
                key={order.id}
                className={`bg-white border rounded-xl p-6 space-y-5 transition-colors ${
                  isHighlighted ? 'border-amber-700' : 'border-stone-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span className="font-mono font-semibold text-stone-900 text-sm">
                        {order.id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-stone-800">{order.storeName}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {order.fulfillment === 'pickup'
                          ? 'Retiro en pulpería'
                          : 'Entrega a domicilio'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(order.createdAt).toLocaleString('es-NI', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-sm font-semibold">
                      {order.paymentStatus === 'verification_pending' ? (
                        <span className="text-amber-700">Pago por verificar</span>
                      ) : order.paymentStatus === 'rejected' ? (
                        <span className="text-red-700">Pago rechazado</span>
                      ) : (
                        <span className="text-emerald-700">{order.status}</span>
                      )}
                    </div>

                    {/* Action to advance order stage and trigger real-time client notification */}
                    <button
                      type="button"
                      disabled={advancingOrderId === order.id}
                      onClick={() => handleAdvanceStage(order)}
                      className="px-3 py-1.5 text-xs font-medium text-stone-800 bg-stone-100 hover:bg-amber-800 hover:text-white border border-stone-300 hover:border-amber-800 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                      title="Avanza el estado del pedido en el servidor para recibir la notificación en tiempo real"
                    >
                      <span>
                        {advancingOrderId === order.id
                          ? 'Actualizando...'
                          : `Pasar a "${nextAction.nextLabel}"`}
                      </span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* 4-Stage Progress Stepper */}
                {order.paymentStatus === 'paid' && (
                  <ol className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                    {stages.map((label, idx) => {
                      const isDone = idx < currentIdx || order.status === 'Completado';
                      const isCurrent = idx === currentIdx && order.status !== 'Completado';
                      return (
                        <li
                          key={label}
                          className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                            isDone
                              ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900 font-medium'
                              : isCurrent
                              ? 'border-stone-900 bg-stone-900 text-white font-semibold'
                              : 'border-stone-200 bg-stone-50 text-stone-400'
                          }`}
                        >
                          <span className="font-mono text-[11px]">0{idx + 1}</span>
                          <span className="truncate">{label}</span>
                          {isDone && <Check className="w-3.5 h-3.5 ml-auto shrink-0" />}
                        </li>
                      );
                    })}
                  </ol>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-stone-500">Detalle de productos</h3>
                    <ul className="space-y-1.5 text-sm">
                      {order.items.map((item, i) => (
                        <li key={i} className="flex justify-between text-stone-800">
                          <span>
                            <span className="font-mono font-medium">{item.quantity}×</span> {item.name}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatPrice(item.price * item.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2 text-xs text-stone-600 bg-stone-50 p-4 rounded-lg border border-stone-200/80">
                    <div className="flex justify-between">
                      <span>Modalidad:</span>
                      <span className="font-medium text-stone-900">
                        {order.fulfillment === 'delivery'
                          ? `Domicilio (${order.address})`
                          : 'Retiro en tienda'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Transferencia:</span>
                      <span className="font-medium text-stone-900">
                        {order.paymentLabel} · Ref. <span className="font-mono">{order.paymentReference}</span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Estado del pago:</span>
                      <span className="font-medium text-stone-900">
                        {order.paymentStatus === 'verification_pending'
                          ? 'En revisión por la pulpería'
                          : order.paymentStatus === 'rejected'
                          ? 'No verificado — Contactar pulpería'
                          : 'Transferencia verificada'}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-stone-200 flex justify-between text-sm font-semibold text-stone-900">
                      <span>Total (incluye envío {formatPrice(order.deliveryFee)})</span>
                      <span className="font-mono tabular-nums">{formatPrice(order.total)}</span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
