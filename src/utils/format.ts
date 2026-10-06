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

const STATIC_FALLBACK_STORES = [
  {
    id: 1,
    storeName: 'Pulpería La Bendición',
    department: 'Managua',
    address: 'Barrio Monseñor Lezcano, de la Estatua 2c. al Sur, Managua',
    phone: '8845-2310',
    deliveryFee: 25,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 25 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 8,
    productLimit: 200,
    remainingQuota: 192,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'María Auxiliadora Cano',
        account: '134082049',
        instructions: 'Transferencia Bancanet o LAFISE Móvil en Córdobas',
      },
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'María Auxiliadora Cano',
        account: '+505 58898311',
        instructions: 'Billetera Móvil activa 24/7',
      },
      {
        id: 'efectivo',
        label: 'Efectivo al recibir',
        recipient: 'Pago en efectivo al entregar',
        account: 'Córdobas (C$)',
        instructions: 'Paga en efectivo al recibir tu pedido en casa o retirar en la pulpería',
      },
    ],
  },
  {
    id: 2,
    storeName: 'Pulpería El Chele',
    department: 'Managua',
    address: 'Colonia Centroamérica, entrada principal 1c. al Lago, Managua',
    phone: '8712-9044',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 20 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 4,
    productLimit: 200,
    remainingQuota: 196,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'Carlos Alberto Blandón',
        account: '+505 58898311',
        instructions: 'Transferencia inmediata a Billetera Móvil',
      },
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'Carlos Alberto Blandón',
        account: '134082049',
        instructions: 'Enviar número de referencia de transferencia',
      },
      {
        id: 'efectivo',
        label: 'Efectivo al recibir',
        recipient: 'Pago contra entrega',
        account: 'Efectivo C$',
        instructions: 'Paga al recibir en tu puerta',
      },
    ],
  },
  {
    id: 3,
    storeName: 'Pulpería San Sebastián',
    department: 'León',
    address: 'Barrio San Sebastián, de la Iglesia 1c. al Oeste, León',
    phone: '8654-1120',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 28 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 3,
    productLimit: 200,
    remainingQuota: 197,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'Rosa Argentina Pineda',
        account: '134082049',
        instructions: 'Cuenta LAFISE en Córdobas',
      },
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'Rosa Argentina Pineda',
        account: '+505 58898311',
        instructions: 'Billetera Móvil activa',
      },
      {
        id: 'efectivo',
        label: 'Efectivo al recibir',
        recipient: 'Pago contra entrega',
        account: 'Efectivo C$',
        instructions: 'Paga al recibir',
      },
    ],
  },
  {
    id: 4,
    storeName: 'Pulpería Monimbó',
    department: 'Masaya',
    address: 'Tiangue de Monimbó 1c. al Sur, Masaya',
    phone: '8932-4410',
    deliveryFee: 15,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 28 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 2,
    productLimit: 200,
    remainingQuota: 198,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'José Dolores Membreño',
        account: '+505 58898311',
        instructions: 'Billetera Móvil Masaya',
      },
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'José Dolores Membreño',
        account: '134082049',
        instructions: 'Transferencia LAFISE',
      },
    ],
  },
  {
    id: 5,
    storeName: 'Pulpería La Sultana',
    department: 'Granada',
    address: 'Calle La Calzada, del Parque Central 3c. al Lago, Granada',
    phone: '8521-7789',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 26 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 2,
    productLimit: 200,
    remainingQuota: 198,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'Lucía Chamorro Mora',
        account: '134082049',
        instructions: 'Transferencia Bancanet LAFISE',
      },
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'Lucía Chamorro Mora',
        account: '+505 58898311',
        instructions: 'Billetera Móvil inmediata',
      },
    ],
  },
  {
    id: 6,
    storeName: 'Pulpería Perla del Septentrión',
    department: 'Matagalpa',
    address: 'Barrio Guanuca, frente a la Cancha Municipal, Matagalpa',
    phone: '8410-3392',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 27 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 2,
    productLimit: 200,
    remainingQuota: 198,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'Denis Zeledón Rizo',
        account: '+505 58898311',
        instructions: 'Billetera Móvil activa',
      },
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'Denis Zeledón Rizo',
        account: '134082049',
        instructions: 'Cuenta LAFISE en Córdobas',
      },
    ],
  },
  {
    id: 7,
    storeName: 'Pulpería El Diamante',
    department: 'Estelí',
    address: 'Barrio El Rosario, 2c. al Este del Parque Central, Estelí',
    phone: '8390-6615',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    subscriptionUntil: new Date(Date.now() + 27 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    trialDaysLeft: 3,
    isTrialActive: true,
    subscriptionActive: true,
    productCount: 2,
    productLimit: 200,
    remainingQuota: 198,
    quotaExhausted: false,
    paymentMethods: [
      {
        id: 'lafise',
        label: 'LAFISE',
        recipient: 'Marlon Valdivia Rugama',
        account: '134082049',
        instructions: 'Cuenta LAFISE Estelí',
      },
      {
        id: 'mobile_wallet',
        label: 'Billetera Móvil',
        recipient: 'Marlon Valdivia Rugama',
        account: '+505 58898311',
        instructions: 'Billetera Móvil +505 58898311',
      },
    ],
  },
];

const STATIC_FALLBACK_PRODUCTS: Product[] = [
  {
    id: 1,
    storeId: 1,
    name: 'Arroz Faisán 80/20 (Libra)',
    category: 'abarrotes',
    description: 'Arroz blanco seleccionado de grano entero, ideal para el gallo pinto de todos los días.',
    image: '🍚',
    price: 24,
    stock: 45,
    storeName: 'Pulpería La Bendición',
    storeDepartment: 'Managua',
    storeAddress: 'Barrio Monseñor Lezcano, de la Estatua 2c. al Sur, Managua',
    storePhone: '8845-2310',
    deliveryFee: 25,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[0].paymentMethods as any,
  },
  {
    id: 2,
    storeId: 1,
    name: 'Frijoles Rojos de Seda Recién Cosechados (Libra)',
    category: 'abarrotes',
    description: 'Frijol rojo suave de Jinotega, cocción rápida y caldo espeso.',
    image: '🫘',
    price: 34,
    stock: 4,
    storeName: 'Pulpería La Bendición',
    storeDepartment: 'Managua',
    storeAddress: 'Barrio Monseñor Lezcano, de la Estatua 2c. al Sur, Managua',
    storePhone: '8845-2310',
    deliveryFee: 25,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[0].paymentMethods as any,
  },
  {
    id: 3,
    storeId: 1,
    name: 'Queso Seco Chontaleño Ahumado (Media Libra)',
    category: 'lacteos',
    description: 'Queso artesanal firme de Santo Tomás, Chontales, perfecto para freír o rallar.',
    image: '🧀',
    price: 92,
    stock: 3,
    storeName: 'Pulpería La Bendición',
    storeDepartment: 'Managua',
    storeAddress: 'Barrio Monseñor Lezcano, de la Estatua 2c. al Sur, Managua',
    storePhone: '8845-2310',
    deliveryFee: 25,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[0].paymentMethods as any,
  },
  {
    id: 4,
    storeId: 1,
    name: 'Rojita Milca Bien Helada (Botella 1.5 L)',
    category: 'bebidas',
    description: 'La gaseosa roja tradicional nicaragüense para acompañar el almuerzo familiar.',
    image: '🥤',
    price: 48,
    stock: 28,
    storeName: 'Pulpería La Bendición',
    storeDepartment: 'Managua',
    storeAddress: 'Barrio Monseñor Lezcano, de la Estatua 2c. al Sur, Managua',
    storePhone: '8845-2310',
    deliveryFee: 25,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[0].paymentMethods as any,
  },
  {
    id: 5,
    storeId: 3,
    name: 'Rosquillas Somoteñas Crujientes (Bolsa 12 uds)',
    category: 'galletas',
    description: 'Auténticas rosquillas de maíz y queso horneadas en leña.',
    image: '🍪',
    price: 55,
    stock: 20,
    storeName: 'Pulpería San Sebastián',
    storeDepartment: 'León',
    storeAddress: 'Barrio San Sebastián, de la Iglesia 1c. al Oeste, León',
    storePhone: '8654-1120',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[2].paymentMethods as any,
  },
  {
    id: 6,
    storeId: 6,
    name: 'Café Molido de Palo Matagalpa (400 g)',
    category: 'galletas',
    description: 'Café arábigo de altura con tueste medio tradicional.',
    image: '☕',
    price: 110,
    stock: 3,
    storeName: 'Pulpería Perla del Septentrión',
    storeDepartment: 'Matagalpa',
    storeAddress: 'Barrio Guanuca, frente a la Cancha Municipal, Matagalpa',
    storePhone: '8410-3392',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[5].paymentMethods as any,
  },
  {
    id: 7,
    storeId: 4,
    name: 'Cajetas de Coco y Leche de Masaya (Paquete 6 uds)',
    category: 'dulces',
    description: 'Dulces típicos masayas elaborados a mano con coco rallado y leche.',
    image: '🍬',
    price: 45,
    stock: 25,
    storeName: 'Pulpería Monimbó',
    storeDepartment: 'Masaya',
    storeAddress: 'Tiangue de Monimbó 1c. al Sur, Masaya',
    storePhone: '8932-4410',
    deliveryFee: 15,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[3].paymentMethods as any,
  },
  {
    id: 8,
    storeId: 2,
    name: 'Cuajada Fresca Casera (Unidad Grande)',
    category: 'lacteos',
    description: 'Cuajada fresca del día envuelta en hoja de chagüite, bajita en sal.',
    image: '🧀',
    price: 65,
    stock: 2,
    storeName: 'Pulpería El Chele',
    storeDepartment: 'Managua',
    storeAddress: 'Colonia Centroamérica, entrada principal 1c. al Lago, Managua',
    storePhone: '8712-9044',
    deliveryFee: 20,
    delivery: true,
    pickup: true,
    paymentMethods: STATIC_FALLBACK_STORES[1].paymentMethods as any,
  },
];

function handleStaticHostFallback(path: string, options: RequestInit = {}): any {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(String(options.body)) : {};

  const getStored = <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const setStored = (key: string, val: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // ignore
    }
  };

  const stores = getStored('pulperia_static_stores', STATIC_FALLBACK_STORES);
  const products = getStored('pulperia_static_products', STATIC_FALLBACK_PRODUCTS);
  const orders = getStored<any[]>('pulperia_static_orders', []);
  const credits = getStored<any[]>('pulperia_static_credits', [
    {
      id: 1,
      customerName: 'Doña Esperanza Ruiz',
      customerPhone: '8821-4509',
      notes: '2 lbs de arroz, 1 aceite Corona y 1 café Matagalpa',
      amount: 185,
      status: 'pending',
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
  ]);

  if (path.startsWith('/api/products') && method === 'GET') {
    return { success: true, products };
  }
  if (path.startsWith('/api/stores') && method === 'GET') {
    return { success: true, stores };
  }
  if (path.startsWith('/api/auth/me')) {
    const savedUser = getStored('pulperia_saved_user', null);
    return { success: true, user: savedUser };
  }
  if (path.startsWith('/api/auth/demo-owner') || path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register')) {
    const role = path.includes('demo-owner') ? 'negocio' : body.role || 'cliente';
    const user = {
      id: role === 'negocio' ? 1 : 2,
      name: body.name || (role === 'negocio' ? 'María Auxiliadora Cano' : 'Cliente Vecino'),
      email: body.email || (role === 'negocio' ? 'maria@pulperia.ni' : 'vecino@pulperia.ni'),
      phone: body.phone || '8845-2310',
      role,
    };
    setStored('pulperia_saved_user', user);
    return { success: true, token: 'static-demo-token', user };
  }
  if (path.startsWith('/api/auth/role')) {
    const current = getStored('pulperia_saved_user', {
      id: 1,
      name: 'María Auxiliadora Cano',
      email: 'maria@pulperia.ni',
      phone: '8845-2310',
      role: 'negocio',
    });
    const updated = { ...current, role: body.role || 'cliente' };
    setStored('pulperia_saved_user', updated);
    return { success: true, user: updated };
  }
  if (path.startsWith('/api/orders/validate-receipt')) {
    const urlObj = new URL(path, 'http://localhost');
    const ref = (urlObj.searchParams.get('reference') || '').trim().toUpperCase();
    return {
      success: true,
      valid: ref.length >= 4 && /\d/.test(ref),
      unique: true,
      normalizedReference: ref,
      message: `Código de transacción único "${ref}" pre-validado correctamente.`,
    };
  }
  if (path === '/api/orders' && method === 'POST') {
    const newOrder = {
      id: `PED-${Math.floor(100000 + Math.random() * 900000)}`,
      storeId: 1,
      storeName: stores[0].storeName,
      storeDepartment: stores[0].department,
      storePhone: stores[0].phone,
      customerName: body.customerName || 'Cliente',
      customerPhone: body.customerPhone || '8888-8888',
      fulfillment: body.fulfillment || 'delivery',
      address: body.address || 'Managua',
      subtotal: 120,
      deliveryFee: body.fulfillment === 'delivery' ? 25 : 0,
      total: 145,
      status: 'Nuevo',
      paymentMethodId: body.paymentMethodId || 'lafise',
      paymentLabel: body.paymentMethodId === 'mobile_wallet' ? 'Billetera Móvil' : 'LAFISE',
      paymentRecipient: 'Norman Escobar',
      paymentAccount: body.paymentMethodId === 'mobile_wallet' ? '+505 58898311' : '134082049',
      paymentReference: body.paymentReference || 'LAF-849201',
      paymentStatus: 'pending_verification',
      createdAt: new Date().toISOString(),
      items: (body.items || []).map((it: any) => {
        const prod = products.find((p: Product) => p.id === it.productId) || products[0];
        return {
          productId: prod.id,
          name: prod.name,
          image: prod.image,
          price: prod.price,
          quantity: it.quantity || 1,
        };
      }),
    };
    orders.unshift(newOrder);
    setStored('pulperia_static_orders', orders);
    return { success: true, order: newOrder };
  }
  if (path.startsWith('/api/orders/my')) {
    return { success: true, orders };
  }
  if (path.startsWith('/api/business/dashboard')) {
    return {
      success: true,
      store: stores[0],
      products: products.filter((p: Product) => p.storeId === 1),
      orders,
      subscriptionPayments: [],
      platformPaymentMethods: OFFICIAL_PLATFORM_ACCOUNTS,
      monthlySubscriptionFee: PLATFORM_TARIFF_CORDOBAS,
      productsPerPlan: PRODUCTS_PER_QUOTA,
    };
  }
  if (path.startsWith('/api/business/credits') && method === 'GET') {
    return { success: true, credits };
  }
  if (path.startsWith('/api/admin/summary')) {
    return {
      success: true,
      monthlyFee: PLATFORM_TARIFF_CORDOBAS,
      productsPerPlan: PRODUCTS_PER_QUOTA,
      commissionTotal: 450,
      subscriptionTotal: 700,
      allStoresCount: stores.length,
      totalOrdersCount: orders.length + 12,
      paymentMethods: OFFICIAL_PLATFORM_ACCOUNTS,
      pendingPayments: [],
    };
  }
  return { success: true };
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

  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers,
    });

    const contentType = response.headers.get('content-type') || '';
    if (
      (response.status === 404 || response.status === 405 || !contentType.includes('application/json')) &&
      typeof window !== 'undefined' &&
      (window.location.hostname.includes('github.io') || !contentType.includes('application/json'))
    ) {
      return handleStaticHostFallback(path, options) as T;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(data.message || 'No se pudo completar la solicitud.');
      err.status = response.status;
      err.code = data.code;
      throw err;
    }
    return data as T;
  } catch (err: any) {
    if (err && typeof err.status === 'number') {
      throw err;
    }
    return handleStaticHostFallback(path, options) as T;
  }
}

