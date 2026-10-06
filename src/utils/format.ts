import heroImg from '../assets/images/hero_pulperia_nicaragua_1791054836704.jpg';
import bevImg from '../assets/images/prod_gaseosa_naranja_1791054847404.jpg';
import riceImg from '../assets/images/prod_arroz_frijoles_1791054858300.jpg';
import coffeeImg from '../assets/images/prod_cafe_rosquillas_1791054868528.jpg';
import dairyImg from '../assets/images/prod_lacteos_queso_1791054879583.jpg';
import { Order, Product } from '../types';

export const HERO_IMAGE_URL = heroImg;

let memorySessionToken = '';

export const NICARAGUA_DEPARTMENTS = [
  'Managua',
  'León',
  'Chinandega',
  'Masaya',
  'Granada',
  'Carazo',
  'Rivas',
  'Matagalpa',
  'Jinotega',
  'Estelí',
  'Madriz',
  'Nueva Segovia',
  'Boaco',
  'Chontales',
  'Río San Juan',
  'RACCN (Caribe Norte)',
  'RACCS (Caribe Sur)',
] as const;

export const OFFICIAL_PLATFORM_ACCOUNTS = [
  {
    id: 'mobile_wallet' as const,
    label: 'Billetera Móvil',
    recipient: 'Norman Escobar',
    account: '+505 58898311',
    instructions: 'Recarga de C$ 100 (habilita 200 productos sin perder tus 3 días de prueba gratis)',
  },
  {
    id: 'lafise' as const,
    label: 'LAFISE',
    recipient: 'Norman Escobar',
    account: '134082049',
    instructions: 'Transferencia Bancanet o LAFISE Móvil en Córdobas (C$ 100 por 200 productos)',
  },
];

export const PLATFORM_TARIFF_CORDOBAS = 100;
export const PRODUCTS_PER_QUOTA = 200;
export const FREE_TRIAL_DAYS = 3;

export function isCustomImageUrl(image?: string | null): boolean {
  if (!image) return false;
  const trimmed = image.trim();
  return (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  );
}

export function getProductImageUrl(
  product: Pick<Product, 'category' | 'name'> & { image?: string | null }
): string {
  if (isCustomImageUrl(product.image)) {
    return product.image!.trim();
  }
  const cat = (product.category || '').toLowerCase();
  if (cat === 'bebidas') return bevImg;
  if (cat === 'lacteos' || cat === 'carnes') return dairyImg;
  if (cat === 'galletas' || cat === 'dulces') return coffeeImg;
  return riceImg;
}

export async function compressImageFile(
  file: File,
  maxWidth = 900,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo seleccionado no es una imagen válida.'));
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / Math.max(img.width, img.height, 1));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function formatPrice(amount: number | undefined | null): string {
  const num = Number(amount || 0);
  return `C$ ${num.toLocaleString('es-NI', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    bebidas: 'Bebidas',
    dulces: 'Dulces Típicos',
    galletas: 'Panadería y Café',
    abarrotes: 'Abarrotes',
    limpieza: 'Limpieza',
    lacteos: 'Lácteos y Quesos',
    carnes: 'Carnes y Huevos',
    frutas: 'Frutas y Verduras',
  };
  return map[(category || '').toLowerCase()] || category;
}

export const PRODUCT_CATEGORIES = [
  { id: 'abarrotes', label: 'Abarrotes' },
  { id: 'lacteos', label: 'Lácteos y Quesos' },
  { id: 'bebidas', label: 'Bebidas' },
  { id: 'galletas', label: 'Panadería y Café' },
  { id: 'carnes', label: 'Carnes y Huevos' },
  { id: 'frutas', label: 'Frutas y Verduras' },
  { id: 'dulces', label: 'Dulces Típicos' },
  { id: 'limpieza', label: 'Limpieza' },
] as const;

export const PAYMENT_PROVIDERS = [
  { id: 'lafise', label: 'LAFISE' },
  { id: 'mobile_wallet', label: 'Billetera Móvil' },
  { id: 'banpro', label: 'Banpro Nicaragua' },
  { id: 'rapibac', label: 'RapiBAC' },
  { id: 'efectivo', label: 'Efectivo al recibir' },
] as const;

export function buildWhatsAppOrderUrl(order: Order, targetPhone?: string): string {
  const cleanPhone = String(targetPhone || order.customerPhone || '50558898311').replace(/[^\d]/g, '');
  const fullPhone = cleanPhone.startsWith('505') ? cleanPhone : `505${cleanPhone}`;
  const itemsText = order.items
    .map((i) => `• ${i.quantity}x ${i.name} (${formatPrice(i.price * i.quantity)})`)
    .join('\n');
  const message = [
    `*Pulpería Nicaragua — Pedido ${order.id}*`,
    `Pulpería: ${order.storeName}`,
    `Cliente: ${order.customerName} (${order.customerPhone})`,
    `Modalidad: ${order.fulfillment === 'delivery' ? `Domicilio (${order.address})` : 'Retiro en pulpería'}`,
    `Pago: ${order.paymentLabel} · Ref: ${order.paymentReference}`,
    `Estado: ${order.status}`,
    ``,
    `*Productos:*`,
    itemsText,
    ``,
    `*Total: ${formatPrice(order.total)}*`,
  ].join('\n');
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`;
}

export function exportProductsToCsv(products: Product[], storeName: string) {
  const headers = ['ID', 'Producto', 'Categoría', 'Precio (C$)', 'Existencia (uds)', 'Pulpería', 'Descripción'];
  const rows = products.map((p) => [
    p.id,
    `"${(p.name || '').replace(/"/g, '""')}"`,
    `"${categoryLabel(p.category)}"`,
    p.price,
    p.stock,
    `"${(p.storeName || storeName || '').replace(/"/g, '""')}"`,
    `"${(p.description || '').replace(/"/g, '""')}"`,
  ]);
  const csvContent =
    '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventario-${(storeName || 'pulperia').toLowerCase().replace(/\s+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function getSessionToken(): string {
  try {
    return localStorage.getItem('pulperia_session_token') || memorySessionToken;
  } catch {
    return memorySessionToken;
  }
}

export function setSessionToken(token: string | null) {
  memorySessionToken = token || '';
  try {
    if (token) {
      localStorage.setItem('pulperia_session_token', token);
    } else {
      localStorage.removeItem('pulperia_session_token');
    }
  } catch {
    // Fallback to in-memory token if localStorage is restricted in iframe
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['x-session-token'] = token;
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err: any = new Error(data.message || 'No se pudo completar la solicitud.');
    err.status = response.status;
    err.code = data.code;
    throw err;
  }
  return data as T;
}
