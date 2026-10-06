import { Order } from '../types';

export interface OrderStatusNotification {
  id: string;
  orderId: string;
  storeName: string;
  previousStatus: string;
  newStatus: string;
  paymentStatus: string;
  message: string;
  timestamp: string;
  read: boolean;
  kind?: 'order' | 'quota';
}

const STORAGE_KEY = 'pulperia_order_notifications_v1';
const seenEventKeys = new Set<string>();

export function buildStatusMessage(params: {
  orderId: string;
  storeName: string;
  previousStatus: string;
  newStatus: string;
}): string {
  const { orderId, storeName, previousStatus, newStatus } = params;
  if (newStatus === 'En camino') {
    return `¡Tu pedido ${orderId} de ${storeName} cambió de "${previousStatus}" a "En camino"! El repartidor va hacia tu dirección.`;
  }
  if (newStatus === 'Listo para retirar') {
    return `¡Tu pedido ${orderId} cambió de "${previousStatus}" a "Listo para retirar"! Ya puedes pasar por ${storeName}.`;
  }
  if (newStatus === 'Preparando') {
    return `Tu pedido ${orderId} en ${storeName} cambió de "${previousStatus}" a "Preparando". Están alistando tus productos.`;
  }
  if (newStatus === 'Pendiente') {
    return `Pago verificado para el pedido ${orderId} en ${storeName}. Estado actualizado de "${previousStatus}" a "Pendiente".`;
  }
  if (newStatus === 'Completado') {
    return `Pedido ${orderId} de ${storeName} finalizado: pasó de "${previousStatus}" a "Completado". ¡Gracias por tu compra!`;
  }
  if (newStatus === 'Pago rechazado') {
    return `Atención: La referencia bancaria del pedido ${orderId} en ${storeName} fue marcada como "${newStatus}".`;
  }
  return `Tu pedido ${orderId} en ${storeName} cambió de "${previousStatus}" a "${newStatus}".`;
}

export function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First note (E5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Second note (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.14);
    gain2.gain.setValueAtTime(0.09, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.42);
  } catch {
    // Ignore if browser blocks audio before interaction
  }
}

export function triggerBrowserNotification(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        tag: title,
      });
    }
  } catch {
    // Ignore in restricted iframe contexts
  }
}

export async function requestBrowserNotificationPermission(): Promise<boolean> {
  try {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function loadSavedNotifications(): OrderStatusNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveNotifications(list: OrderStatusNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 25)));
  } catch {
    // Ignore storage errors
  }
}

export function createOrderNotification(params: {
  orderId: string;
  storeName: string;
  previousStatus: string;
  newStatus: string;
  paymentStatus: string;
  timestamp?: string;
  customMessage?: string;
  kind?: 'order' | 'quota';
}): OrderStatusNotification | null {
  const dedupeKey = `${params.orderId}:${params.previousStatus}->${params.newStatus}:${params.paymentStatus}:${params.timestamp || ''}`;
  if (seenEventKeys.has(dedupeKey)) {
    return null;
  }
  seenEventKeys.add(dedupeKey);

  const timestamp = params.timestamp || new Date().toISOString();
  const message = params.customMessage || buildStatusMessage(params);

  return {
    id: `${params.orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    orderId: params.orderId,
    storeName: params.storeName,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    paymentStatus: params.paymentStatus,
    message,
    timestamp,
    read: false,
    kind: params.kind || 'order',
  };
}

export function subscribeToOrderStatusStream(
  onStatusChanged: (notification: OrderStatusNotification) => void
): () => void {
  let es: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    try {
      es = new EventSource('/api/orders/stream');
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'order:status_changed' && payload.orderId && payload.newStatus) {
            const notif = createOrderNotification({
              orderId: payload.orderId,
              storeName: payload.storeName || 'Pulpería Local',
              previousStatus: payload.previousStatus || 'Pendiente',
              newStatus: payload.newStatus,
              paymentStatus: payload.paymentStatus || 'paid',
              timestamp: payload.timestamp,
              kind: 'order',
            });
            if (notif) {
              playNotificationChime();
              triggerBrowserNotification(
                `Pedido ${notif.orderId}: ${notif.newStatus}`,
                notif.message
              );
              onStatusChanged(notif);
            }
          } else if (payload?.type === 'store:quota_exhausted') {
            const notif = createOrderNotification({
              orderId: `CUPO-${payload.productLimit || 200}`,
              storeName: payload.storeName || 'Mi Pulpería',
              previousStatus: `${payload.productCount || 200} productos`,
              newStatus: 'Cupo de 200 agotado',
              paymentStatus: 'verification_pending',
              timestamp: payload.timestamp,
              customMessage:
                payload.message ||
                `¡Se terminaron tus ${payload.productLimit || 200} productos disponibles en ${
                  payload.storeName || 'tu pulpería'
                }! Recarga C$ 100 por Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049) para subir 200 productos más automáticamente.`,
              kind: 'quota',
            });
            if (notif) {
              playNotificationChime();
              triggerBrowserNotification(
                `Aviso de Pulpería: 200 productos agotados`,
                notif.message
              );
              onStatusChanged(notif);
            }
          }
        } catch {
          // Ignore malformed event
        }
      };
      es.onerror = () => {
        es?.close();
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 5000);
        }
      };
    } catch {
      // Fallback to polling reconciliation
    }
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    es?.close();
  };
}

export function reconcileOrdersSnapshot(
  knownOrdersMap: Map<string, { status: string; paymentStatus: string }>,
  latestOrders: Order[],
  onStatusChanged: (notification: OrderStatusNotification) => void
) {
  const isInitialSeed = knownOrdersMap.size === 0;
  for (const order of latestOrders) {
    const prev = knownOrdersMap.get(order.id);
    if (!isInitialSeed && prev && (prev.status !== order.status || prev.paymentStatus !== order.paymentStatus)) {
      const notif = createOrderNotification({
        orderId: order.id,
        storeName: order.storeName,
        previousStatus: prev.status,
        newStatus: order.status,
        paymentStatus: order.paymentStatus,
      });
      if (notif) {
        playNotificationChime();
        triggerBrowserNotification(
          `Pedido ${notif.orderId}: ${notif.newStatus}`,
          notif.message
        );
        onStatusChanged(notif);
      }
    }
    knownOrdersMap.set(order.id, {
      status: order.status,
      paymentStatus: order.paymentStatus,
    });
  }
}
