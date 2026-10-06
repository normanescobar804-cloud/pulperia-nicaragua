import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);

const root = process.cwd();
const databasePath = process.env.PULPERIA_DB_PATH || path.join(root, 'data', 'pulperia.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    phone TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('cliente', 'negocio')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'Managua',
    description TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    delivery INTEGER NOT NULL DEFAULT 1,
    pickup INTEGER NOT NULL DEFAULT 1,
    delivery_fee REAL NOT NULL DEFAULT 0,
    payment_methods TEXT NOT NULL DEFAULT '[]',
    subscription_until TEXT NOT NULL DEFAULT '',
    trial_ends_at TEXT NOT NULL DEFAULT '',
    product_limit INTEGER NOT NULL DEFAULT 200,
    simulated_quota_used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '📦',
    price REAL NOT NULL CHECK(price >= 0),
    stock INTEGER NOT NULL CHECK(stock >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES users(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    fulfillment TEXT NOT NULL CHECK(fulfillment IN ('delivery', 'pickup')),
    address TEXT NOT NULL DEFAULT '',
    delivery_fee REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    platform_fee REAL NOT NULL DEFAULT 0,
    seller_net REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT '',
    payment_reference TEXT NOT NULL DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT 'paid',
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pendiente',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscription_payments (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    method TEXT NOT NULL,
    reference TEXT NOT NULL,
    amount REAL NOT NULL,
    products_added INTEGER NOT NULL DEFAULT 200,
    status TEXT NOT NULL DEFAULT 'paid',
    created_at TEXT NOT NULL,
    verified_at TEXT
  );

  CREATE TABLE IF NOT EXISTS store_credits (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL CHECK(amount >= 0),
    paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'pagado')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    payment_methods TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS products_store_idx ON products(store_id, active);
  CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id, created_at);
  CREATE INDEX IF NOT EXISTS orders_store_idx ON orders(store_id, created_at);
  CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS store_credits_store_idx ON store_credits(store_id, status);
`);

// Safe schema migration for existing SQLite databases
function runSafeMigrations() {
  const safeAlter = (sql: string) => {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  };
  safeAlter(`ALTER TABLE stores ADD COLUMN department TEXT NOT NULL DEFAULT 'Managua'`);
  safeAlter(`ALTER TABLE stores ADD COLUMN trial_ends_at TEXT NOT NULL DEFAULT ''`);
  safeAlter(`ALTER TABLE stores ADD COLUMN product_limit INTEGER NOT NULL DEFAULT 200`);
  safeAlter(`ALTER TABLE stores ADD COLUMN simulated_quota_used INTEGER NOT NULL DEFAULT 0`);
  safeAlter(`ALTER TABLE subscription_payments ADD COLUMN products_added INTEGER NOT NULL DEFAULT 200`);
  safeAlter(`ALTER TABLE orders ADD COLUMN payment_screenshot TEXT NOT NULL DEFAULT ''`);
}
runSafeMigrations();

const sessionDays = 7;
const sessionCookie = 'pulperia_session';
const monthlySubscriptionFee = 100; // C$ 100 Córdobas por cada recarga de 200 productos
const productsPerQuota = 200; // 200 productos por recarga de C$ 100
const freeTrialDays = 3; // 3 días de prueba gratis garantizados
const platformCommissionRate = 0.03;

const OFFICIAL_PLATFORM_METHODS = [
  {
    id: 'mobile_wallet',
    label: 'Billetera Móvil',
    recipient: 'Norman Escobar',
    account: '+505 58898311',
    instructions:
      'Recarga C$ 100 al +505 58898311 para habilitar 200 productos automáticamente sin quitar tus 3 días de prueba gratis.',
  },
  {
    id: 'lafise',
    label: 'LAFISE',
    recipient: 'Norman Escobar',
    account: '134082049',
    instructions:
      'Transferencia Bancanet o LAFISE Móvil a la cuenta 134082049 (C$ 100 por 200 productos con activación inmediata).',
  },
];

const paymentProviders = [
  { id: 'lafise', label: 'LAFISE' },
  { id: 'mobile_wallet', label: 'Billetera Móvil' },
  { id: 'banpro', label: 'Banpro Nicaragua' },
  { id: 'rapibac', label: 'RapiBAC' },
  { id: 'efectivo', label: 'Efectivo al recibir' },
];

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parsePaymentMethods(value: string | undefined | null) {
  try {
    const methods = JSON.parse(value || '[]');
    return Array.isArray(methods) ? methods : [];
  } catch {
    return [];
  }
}

function validatePaymentMethods(value: any[]) {
  if (!Array.isArray(value) || value.length > paymentProviders.length) {
    throw new HttpError(400, 'Configura al menos un método de pago válido.');
  }
  const seen = new Set();
  return value.map((method) => {
    const provider = paymentProviders.find((item) => item.id === method.id);
    const recipient = String(method.recipient || '').trim();
    const account = String(method.account || '').trim();
    const instructions = String(method.instructions || '').trim();
    if (!provider || seen.has(provider.id)) {
      throw new HttpError(400, 'Método de pago inválido o duplicado.');
    }
    if (
      recipient.length < 2 ||
      recipient.length > 80 ||
      account.length < 2 ||
      account.length > 60 ||
      instructions.length > 220
    ) {
      throw new HttpError(400, `Completa titular y número de cuenta para ${provider.label}.`);
    }
    seen.add(provider.id);
    return { id: provider.id, label: provider.label, recipient, account, instructions };
  });
}

function getTrialDaysRemaining(trialEndsAtStr?: string | null): number {
  const ms = Date.parse(trialEndsAtStr || '');
  if (!Number.isFinite(ms)) return freeTrialDays;
  const diffDays = Math.ceil((ms - Date.now()) / 86400000);
  return Math.max(0, diffDays);
}

function subscriptionActive(store: any) {
  const until = Date.parse(store?.subscription_until || '');
  const trialUntil = Date.parse(store?.trial_ends_at || '');
  return (
    (Number.isFinite(until) && until > Date.now()) ||
    (Number.isFinite(trialUntil) && trialUntil > Date.now())
  );
}

function requireActiveSubscription(store: any) {
  if (!subscriptionActive(store)) {
    throw new HttpError(
      402,
      'Tu periodo activo venció. Recarga C$ 100 por Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049) para activar 200 productos inmediatamente.'
    );
  }
}

function getStoreProductCount(storeId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM products WHERE store_id = ? AND active = 1')
    .get(storeId) as { count: number };
  const storeRow = db
    .prepare('SELECT simulated_quota_used FROM stores WHERE id = ?')
    .get(storeId) as { simulated_quota_used?: number } | undefined;
  const realCount = Number(row?.count || 0);
  const simulated = Number(storeRow?.simulated_quota_used || 0);
  return Math.max(realCount, simulated);
}

function getStoreForOwner(userId: number) {
  return db.prepare('SELECT * FROM stores WHERE owner_id = ?').get(userId) || null;
}

function getPlatformPaymentMethods() {
  const row = db.prepare('SELECT payment_methods FROM platform_settings WHERE id = 1').get();
  const parsed = parsePaymentMethods(row?.payment_methods);
  return parsed.length > 0 ? parsed : OFFICIAL_PLATFORM_METHODS;
}

function publicStore(store: any) {
  const productCount = getStoreProductCount(store.id);
  const productLimit = Math.max(productsPerQuota, Number(store.product_limit || productsPerQuota));
  const remainingQuota = Math.max(0, productLimit - productCount);
  const trialEndsAt =
    store.trial_ends_at || new Date(Date.now() + freeTrialDays * 86400000).toISOString();
  const trialDaysRemaining = getTrialDaysRemaining(trialEndsAt);

  return {
    id: store.id,
    name: store.name,
    department: store.department || 'Managua',
    description: store.description,
    phone: store.phone,
    address: store.address,
    delivery: Boolean(store.delivery),
    pickup: Boolean(store.pickup),
    deliveryFee: Number(store.delivery_fee),
    paymentMethods: parsePaymentMethods(store.payment_methods),
    subscriptionUntil: store.subscription_until,
    subscriptionActive: subscriptionActive(store),
    trialEndsAt,
    trialDaysRemaining,
    productCount,
    productLimit,
    remainingQuota,
    quotaExhausted: remainingQuota === 0,
  };
}

function publicProduct(product: any) {
  return {
    id: product.id,
    storeId: product.store_id,
    name: product.name,
    category: product.category,
    description: product.description,
    image: product.image,
    price: Number(product.price),
    stock: Number(product.stock),
    storeName: product.store_name,
    storeDepartment: product.store_department || 'Managua',
    storeAddress: product.store_address || '',
    storePhone: product.store_phone || '',
    deliveryFee: Number(product.delivery_fee),
    delivery: Boolean(product.delivery),
    pickup: Boolean(product.pickup),
    paymentMethods: parsePaymentMethods(product.payment_methods),
  };
}

function orderQuery(where: string, value: any) {
  const rows = db
    .prepare(
      `SELECT orders.*, stores.name AS store_name, stores.department AS store_department,
              stores.phone AS store_phone, stores.payment_methods
       FROM orders JOIN stores ON stores.id = orders.store_id
       WHERE ${where} ORDER BY orders.created_at DESC`
    )
    .all(value);

  if (rows.length === 0) return [];

  const orderIds = rows.map((r: any) => r.id);
  const placeholders = orderIds.map(() => '?').join(',');
  const allItems = db
    .prepare(
      `SELECT order_id, product_id AS productId, product_name AS name, price, quantity
       FROM order_items
       WHERE order_id IN (${placeholders})
       ORDER BY id`
    )
    .all(...orderIds);

  const itemsByOrder = new Map<string, any[]>();
  for (const item of allItems) {
    const list = itemsByOrder.get(item.order_id) || [];
    list.push({
      productId: item.productId,
      name: item.name,
      price: Number(item.price),
      quantity: Number(item.quantity),
    });
    itemsByOrder.set(item.order_id, list);
  }

  return rows.map((order: any) => {
    const methods = parsePaymentMethods(order.payment_methods);
    const method = methods.find((item: any) => item.id === order.payment_method);
    return {
      id: order.id,
      storeId: order.store_id,
      storeName: order.store_name,
      storeDepartment: order.store_department || 'Managua',
      storePhone: order.store_phone || '',
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      fulfillment: order.fulfillment,
      address: order.address,
      deliveryFee: Number(order.delivery_fee),
      subtotal: Number(order.subtotal),
      platformFee: Number(order.platform_fee),
      sellerNet: Number(order.seller_net),
      paymentMethod: order.payment_method,
      paymentLabel:
        method?.label ||
        paymentProviders.find((item) => item.id === order.payment_method)?.label ||
        order.payment_method,
      paymentInstructions: method || null,
      paymentReference: order.payment_reference,
      paymentStatus: order.payment_status,
      total: Number(order.total),
      status: order.status,
      createdAt: order.created_at,
      items: itemsByOrder.get(order.id) || [],
    };
  });
}

// Seed initial authentic Nicaraguan marketplace data if database is empty
async function seedInitialData() {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existingUsers.count === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hashBuffer = (await scrypt('pulperia1234', salt, 64)) as Buffer;
    const passwordHash = hashBuffer.toString('hex');
    const now = new Date().toISOString();
    const trialEndsAt = new Date(Date.now() + freeTrialDays * 86400000).toISOString();
    const subActiveUntil = new Date(Date.now() + (freeTrialDays + 30) * 86400000).toISOString();

    db.prepare('INSERT OR REPLACE INTO platform_settings (id, payment_methods) VALUES (1, ?)').run(
      JSON.stringify(OFFICIAL_PLATFORM_METHODS)
    );

    // 1. Store Owner 1: Pulpería La Bendición (Managua)
    const owner1 = db
      .prepare(
        'INSERT INTO users (name, email, phone, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('Doña María Auxiliadora', 'negocio@pulperia.ni', '8845-2310', 'negocio', salt, passwordHash, now);
    const owner1Id = Number(owner1.lastInsertRowid);

    const bendicionMethods = [
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
    ];

    const store1 = db
      .prepare(
        `INSERT INTO stores (owner_id, name, department, description, phone, address, delivery, pickup, delivery_fee, payment_methods, subscription_until, trial_ends_at, product_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        owner1Id,
        'Pulpería La Bendición',
        'Managua',
        'Tu pulpería de confianza desde 1998. Abarrotes frescos, lácteos chontaleños, gaseosas bien heladas y pan del día.',
        '8845-2310',
        'Barrio Monseñor Lezcano, de la Estatua 2c. al Sur, Managua',
        1,
        1,
        25,
        JSON.stringify(bendicionMethods),
        subActiveUntil,
        trialEndsAt,
        200
      );
    const store1Id = Number(store1.lastInsertRowid);

    // 2. Store Owner 2: Pulpería El Chele (Managua)
    const owner2 = db
      .prepare(
        'INSERT INTO users (name, email, phone, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('Don Carlos Blandón', 'elchele@pulperia.ni', '8712-9044', 'negocio', salt, passwordHash, now);
    const owner2Id = Number(owner2.lastInsertRowid);

    const cheleMethods = [
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
    ];

    const store2 = db
      .prepare(
        `INSERT INTO stores (owner_id, name, department, description, phone, address, delivery, pickup, delivery_fee, payment_methods, subscription_until, trial_ends_at, product_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        owner2Id,
        'Pulpería El Chele',
        'Managua',
        'Surtido completo para la quincena y el diario. Rosquillas somoteñas, café de palo y granos básicos de primera.',
        '8712-9044',
        'Colonia Centroamérica, entrada principal 1c. al Lago, Managua',
        1,
        1,
        20,
        JSON.stringify(cheleMethods),
        subActiveUntil,
        trialEndsAt,
        200
      );
    const store2Id = Number(store2.lastInsertRowid);

    // 3. Customer Demo & Owner Accounts
    const customer = db
      .prepare(
        'INSERT INTO users (name, email, phone, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('Norman Escobar', 'cliente@pulperia.ni', '+505 58898311', 'cliente', salt, passwordHash, now);
    const customerId = Number(customer.lastInsertRowid);

    db.prepare(
      'INSERT OR IGNORE INTO users (name, email, phone, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('Norman Escobar', 'normanescobar804@gmail.com', '+505 58898311', 'cliente', salt, passwordHash, now);

    db.prepare(
      'INSERT OR IGNORE INTO users (name, email, phone, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('Norman Escobar', 'zelofehathgonzalez@gmail.com', '+505 58898311', 'cliente', salt, passwordHash, now);

    // Seed Authentic Nicaraguan Products
    const initialProducts = [
      {
        storeId: store1Id,
        name: 'Arroz Faisán Oro 80/20 (1 lb)',
        category: 'abarrotes',
        description: 'Arroz blanco seleccionado de grano entero, suelto y rendidor para el gallo pinto de todos los días.',
        image: '🌾',
        price: 24,
        stock: 45,
      },
      {
        storeId: store1Id,
        name: 'Frijoles Rojos de Seda (1 lb)',
        category: 'abarrotes',
        description: 'Frijol rojo nuevo de cosecha nacional (Matagalpa), suave y de caldo espeso.',
        image: '🫘',
        price: 34,
        stock: 32,
      },
      {
        storeId: store1Id,
        name: 'Queso Seco Chontaleño (1 lb)',
        category: 'lacteos',
        description: 'Queso artesanal ahumado de Santo Tomás, Chontales. Ideal para freír o rallar.',
        image: '🧀',
        price: 95,
        stock: 4,
      },
      {
        storeId: store1Id,
        name: 'Rojita / Gaseosa Naranja Helada (12 oz)',
        category: 'bebidas',
        description: 'Clásica gaseosa bien fría recién sacada del mantenedor, perfecta para el almuerzo.',
        image: '🥤',
        price: 22,
        stock: 48,
      },
      {
        storeId: store1Id,
        name: 'Rosquillas Somoteñas Crujientes (Bolsa 12 uds)',
        category: 'galletas',
        description: 'Auténticas rosquillas de maíz y queso horneadas en leña, traídas directo de Somoto.',
        image: '🍪',
        price: 55,
        stock: 20,
      },
      {
        storeId: store1Id,
        name: 'Café Molido de Palo Matagalpa (400 g)',
        category: 'galletas',
        description: 'Café arábigo de altura con tueste medio tradicional, aroma intenso para la mañana y la tarde.',
        image: '☕',
        price: 110,
        stock: 3,
      },
      {
        storeId: store1Id,
        name: 'Cajetas de Coco y Leche (Paquete 6 uds)',
        category: 'dulces',
        description: 'Dulces típicos masayas elaborados a mano con coco rallado, leche y dulce de rapadura.',
        image: '🍬',
        price: 45,
        stock: 25,
      },
      {
        storeId: store1Id,
        name: 'Aceite Vegetal Corona (Botella 900 ml)',
        category: 'abarrotes',
        description: 'Aceite vegetal puro libre de colesterol, indispensable en la cocina nicaragüense.',
        image: '🫗',
        price: 68,
        stock: 22,
      },
      {
        storeId: store2Id,
        name: 'Cuajada Fresca Casera (Unidad Grande)',
        category: 'lacteos',
        description: 'Cuajada fresca del día envuelta en hoja de chagüite, bajita en sal.',
        image: '🧀',
        price: 65,
        stock: 2,
      },
      {
        storeId: store2Id,
        name: 'Cacao con Leche Fresco (Bolsa 16 oz)',
        category: 'bebidas',
        description: 'Fresco natural de cacao tostado con canela y leche entera, bien helado.',
        image: '🥤',
        price: 40,
        stock: 18,
      },
      {
        storeId: store2Id,
        name: 'Pinolillo Tradicional Nica (Bolsa 1 lb)',
        category: 'abarrotes',
        description: 'Mezcla tradicional de maíz blanco tostado, cacao y especias aromáticas.',
        image: '🌾',
        price: 50,
        stock: 30,
      },
      {
        storeId: store2Id,
        name: 'Jabón de Lavar Extra Limpio (Barra Triple)',
        category: 'limpieza',
        description: 'Barra rendidora para ropa y trastes con aroma fresco a limón.',
        image: '🧼',
        price: 38,
        stock: 40,
      },
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (store_id, name, category, description, image, price, stock, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    for (const p of initialProducts) {
      insertProd.run(p.storeId, p.name, p.category, p.description, p.image, p.price, p.stock, now);
    }

    // Seed sample orders
    const order1Id = 'PED-8A4F91C2';
    const subtotal1 = 24 * 2 + 34 * 2 + 95 * 1;
    const fee1 = Math.round(subtotal1 * platformCommissionRate * 100) / 100;
    const deliveryFee1 = 25;
    db.prepare(`
      INSERT INTO orders (
        id, customer_id, store_id, customer_name, customer_phone, fulfillment,
        address, delivery_fee, subtotal, platform_fee, seller_net, payment_method,
        payment_reference, payment_status, total, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order1Id,
      customerId,
      store1Id,
      'Norman Escobar',
      '+505 58898311',
      'delivery',
      'Barrio Monseñor Lezcano, del Cine León 1c. arriba, casa portón verde',
      deliveryFee1,
      subtotal1,
      fee1,
      subtotal1 - fee1 + deliveryFee1,
      'lafise',
      'TRF-948201',
      'paid',
      subtotal1 + deliveryFee1,
      'En camino',
      new Date(Date.now() - 45 * 60000).toISOString()
    );

    const insertOrderItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)'
    );
    insertOrderItem.run(order1Id, 1, 'Arroz Faisán Oro 80/20 (1 lb)', 24, 2);
    insertOrderItem.run(order1Id, 2, 'Frijoles Rojos de Seda (1 lb)', 34, 2);
    insertOrderItem.run(order1Id, 3, 'Queso Seco Chontaleño (1 lb)', 95, 1);

    const order2Id = 'PED-3C9E10B4';
    const subtotal2 = 55 * 1 + 110 * 1;
    const fee2 = Math.round(subtotal2 * platformCommissionRate * 100) / 100;
    db.prepare(`
      INSERT INTO orders (
        id, customer_id, store_id, customer_name, customer_phone, fulfillment,
        address, delivery_fee, subtotal, platform_fee, seller_net, payment_method,
        payment_reference, payment_status, total, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order2Id,
      customerId,
      store1Id,
      'Norman Escobar',
      '+505 58898311',
      'pickup',
      'Retiro en pulpería',
      0,
      subtotal2,
      fee2,
      subtotal2 - fee2,
      'mobile_wallet',
      'BM-772109',
      'verification_pending',
      subtotal2,
      'Pago por verificar',
      new Date(Date.now() - 12 * 60000).toISOString()
    );
    insertOrderItem.run(order2Id, 5, 'Rosquillas Somoteñas Crujientes (Bolsa 12 uds)', 55, 1);
    insertOrderItem.run(order2Id, 6, 'Café Molido de Palo Matagalpa (400 g)', 110, 1);

    const order3Id = 'PED-1D7B44A9';
    const subtotal3 = 320;
    const fee3 = Math.round(subtotal3 * platformCommissionRate * 100) / 100;
    db.prepare(`
      INSERT INTO orders (
        id, customer_id, store_id, customer_name, customer_phone, fulfillment,
        address, delivery_fee, subtotal, platform_fee, seller_net, payment_method,
        payment_reference, payment_status, total, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order3Id,
      customerId,
      store1Id,
      'Norman Escobar',
      '+505 58898311',
      'delivery',
      'Barrio Monseñor Lezcano, del Cine León 1c. arriba',
      25,
      subtotal3,
      fee3,
      subtotal3 - fee3 + 25,
      'lafise',
      'TRF-551092',
      'paid',
      subtotal3 + 25,
      'Completado',
      new Date(Date.now() - 2 * 86400000).toISOString()
    );
    insertOrderItem.run(order3Id, 3, 'Queso Seco Chontaleño (1 lb)', 95, 2);
    insertOrderItem.run(order3Id, 6, 'Café Molido de Palo Matagalpa (400 g)', 110, 1);
    insertOrderItem.run(order3Id, 4, 'Rojita / Gaseosa Naranja Helada (12 oz)', 20, 1);

    db.prepare(`
      INSERT INTO subscription_payments (store_id, method, reference, amount, products_added, status, created_at, verified_at)
      VALUES (?, 'lafise', 'LAFISE-134082049', 100, 200, 'paid', ?, ?)
    `).run(store1Id, new Date(Date.now() - 5 * 86400000).toISOString(), new Date(Date.now() - 5 * 86400000).toISOString());
  }

  // Always ensure official platform payment accounts (+505 58898311 & LAFISE 134082049),
  // 3-day free trial preservation, nationwide stores across Nicaragua, and sample Cuaderno de Fiado records
  await ensureNationwideAndPlatformConfig();
}

async function ensureNationwideAndPlatformConfig() {
  // 1. Force platform_settings to include Norman Escobar's Billetera Móvil (+505 58898311) and Cuenta LAFISE (134082049)
  db.prepare('INSERT OR REPLACE INTO platform_settings (id, payment_methods) VALUES (1, ?)').run(
    JSON.stringify(OFFICIAL_PLATFORM_METHODS)
  );

  // 2. Ensure existing stores have a valid 3-day free trial & at least 200 product quota
  const threeDaysFromNow = new Date(Date.now() + freeTrialDays * 86400000).toISOString();
  const activeUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare(
    `UPDATE stores
     SET trial_ends_at = CASE WHEN trial_ends_at = '' OR trial_ends_at IS NULL THEN ? ELSE trial_ends_at END,
         product_limit = CASE WHEN product_limit IS NULL OR product_limit < 200 THEN 200 ELSE product_limit END,
         department = CASE WHEN department = '' OR department IS NULL THEN 'Managua' ELSE department END,
         subscription_until = CASE WHEN subscription_until < ? THEN ? ELSE subscription_until END`
  ).run(threeDaysFromNow, new Date().toISOString(), activeUntil);

  // 3. Update old C$ 300 subscription records to C$ 100 if any exist from earlier seeds
  db.prepare(`UPDATE subscription_payments SET amount = 100 WHERE amount = 300`).run();

  // 4. Seed nationwide pulperías across Nicaragua if we only have Managua stores
  const leonStore = db.prepare(`SELECT id FROM stores WHERE department = 'León' LIMIT 1`).get();
  if (!leonStore) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hashBuffer = (await scrypt('pulperia1234', salt, 64)) as Buffer;
    const passwordHash = hashBuffer.toString('hex');
    const now = new Date().toISOString();

    const regionalStores = [
      {
        ownerName: 'Doña Rosaura Reyes',
        email: 'leon@pulperia.ni',
        phone: '8821-4490',
        storeName: 'Pulpería El Sutiava',
        department: 'León',
        description: 'Quesillo leonés, tiste tradicional, abarrotes y refrescos helados para todo León.',
        address: 'Barrio Sutiava, de la Iglesia 1c. abajo, León',
        deliveryFee: 20,
        products: [
          {
            name: 'Quesillo Trenzado de Nagarote / León (1 lb)',
            category: 'lacteos',
            description: 'Quesillo fresco de leche pura, suave y elástico, listo para servir con cebolla y crema.',
            image: '🧀',
            price: 98,
            stock: 14,
          },
          {
            name: 'Tiste Tradicional Leonés (Bolsa 1 lb)',
            category: 'bebidas',
            description: 'Bebida típica de maíz tostado y cacao de León, ideal para batir con hielo.',
            image: '🥤',
            price: 55,
            stock: 19,
          },
        ],
      },
      {
        ownerName: 'Don Ernesto Zeledón',
        email: 'matagalpa@pulperia.ni',
        phone: '8650-1120',
        storeName: 'Pulpería La Perla del Norte',
        department: 'Matagalpa',
        description: 'Café de altura, cuajada montañera, frijol rojo nuevo y abarrotes en el corazón de Matagalpa.',
        address: 'Del Parque Morazán 2c. al Norte, Matagalpa',
        deliveryFee: 20,
        products: [
          {
            name: 'Güirila Matagalpina con Cuajada (Paquete 4 uds)',
            category: 'galletas',
            description: 'Tortillas dulces de maíz tierno recién hechas en hoja de chagüite.',
            image: '🌽',
            price: 70,
            stock: 4,
          },
        ],
      },
      {
        ownerName: 'Doña Carmen Valdivia',
        email: 'esteli@pulperia.ni',
        phone: '8910-3344',
        storeName: 'Pulpería El Diamante Segoviano',
        department: 'Estelí',
        description: 'Abarrotes, panadería norteña, lácteos de Condega y productos del hogar en Estelí.',
        address: 'Barrio El Rosario, de Catedral 3c. al Este, Estelí',
        deliveryFee: 20,
        products: [
          {
            name: 'Crema Pura Ácida Norteña (Media Libra)',
            category: 'lacteos',
            description: 'Crema espesa artesanal de Estelí para acompañar gallo pinto y plátanos maduros.',
            image: '🥛',
            price: 45,
            stock: 16,
          },
        ],
      },
      {
        ownerName: 'Don Julio Chamorro',
        email: 'granada@pulperia.ni',
        phone: '8544-7788',
        storeName: 'Pulpería La Gran Sultana',
        department: 'Granada',
        description: 'Abarrotes del diario, vigorón, chingue, gaseosas heladas y frutas frescas en Granada.',
        address: 'Calle La Calzada, del Parque Central 3c. al Lago, Granada',
        deliveryFee: 25,
        products: [
          {
            name: 'Chicharrón Crujiente para Vigorón (Bolsa 1/2 lb)',
            category: 'carnes',
            description: 'Chicharrón de cáscara recién frito al estilo tradicional granadino.',
            image: '🥩',
            price: 90,
            stock: 3,
          },
        ],
      },
      {
        ownerName: 'Doña Nubia Mercado',
        email: 'masaya@pulperia.ni',
        phone: '8432-9911',
        storeName: 'Pulpería Monimbó Tradicional',
        department: 'Masaya',
        description: 'Dulces típicos de Masaya, rosquillas, masa de cazuela y abarrotes completos.',
        address: 'Barrio Monimbó, de las 4 Esquinas 1c. al Sur, Masaya',
        deliveryFee: 15,
        products: [
          {
            name: 'Gofios y Cajetas de Leche Masaya (Bandeja 8 uds)',
            category: 'dulces',
            description: 'Surtido artesanal de dulces tradicionales elaborados en Monimbó, Masaya.',
            image: '🍬',
            price: 60,
            stock: 22,
          },
        ],
      },
    ];

    for (const reg of regionalStores) {
      const u = db
        .prepare(
          'INSERT OR IGNORE INTO users (name, email, phone, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(reg.ownerName, reg.email, reg.phone, 'negocio', salt, passwordHash, now);
      const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(reg.email) as { id: number };
      if (!userRow) continue;

      const existingSt = db.prepare('SELECT id FROM stores WHERE owner_id = ?').get(userRow.id);
      if (existingSt) continue;

      const methods = [
        {
          id: 'mobile_wallet',
          label: 'Billetera Móvil',
          recipient: reg.ownerName,
          account: '+505 58898311',
          instructions: `Billetera Móvil activa en ${reg.department}`,
        },
        {
          id: 'lafise',
          label: 'LAFISE',
          recipient: reg.ownerName,
          account: '134082049',
          instructions: `Cuenta Bancaria LAFISE (${reg.department})`,
        },
        {
          id: 'efectivo',
          label: 'Efectivo al recibir',
          recipient: reg.ownerName,
          account: 'Efectivo C$',
          instructions: 'Paga en efectivo al recibir tu pedido',
        },
      ];

      const st = db
        .prepare(
          `INSERT INTO stores (owner_id, name, department, description, phone, address, delivery, pickup, delivery_fee, payment_methods, subscription_until, trial_ends_at, product_limit)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 200)`
        )
        .run(
          userRow.id,
          reg.storeName,
          reg.department,
          reg.description,
          reg.phone,
          reg.address,
          reg.deliveryFee,
          JSON.stringify(methods),
          activeUntil,
          threeDaysFromNow
        );
      const stId = Number(st.lastInsertRowid);

      const insertP = db.prepare(
        `INSERT INTO products (store_id, name, category, description, image, price, stock, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      );
      for (const prod of reg.products) {
        insertP.run(stId, prod.name, prod.category, prod.description, prod.image, prod.price, prod.stock, now);
      }
    }
  }

  // 5. Seed initial Cuaderno de Fiado records for Store 1 if empty
  const existingCredits = db.prepare('SELECT COUNT(*) AS count FROM store_credits').get() as { count: number };
  if (existingCredits.count === 0) {
    const firstStore = db.prepare('SELECT id FROM stores ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    if (firstStore) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO store_credits (store_id, customer_name, customer_phone, note, amount, paid_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)`
      ).run(
        firstStore.id,
        'Doña Xiomara Jarquín (Vecina casa esquinera)',
        '8841-2090',
        '2 lb Arroz, 1 lb Queso Seco, 1 Coca-Cola 2L — paga en quincena',
        265,
        100,
        now
      );
      db.prepare(
        `INSERT INTO store_credits (store_id, customer_name, customer_phone, note, amount, paid_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)`
      ).run(
        firstStore.id,
        'Don Mauricio Pineda (Taller mecánico)',
        '8765-4321',
        '1 Cajilla de Huevo Nacional y 1 Café Molido',
        285,
        0,
        now
      );
    }
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => {
        const separator = part.indexOf('=');
        return separator < 0
          ? ['', '']
          : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
      })
      .filter(([name]) => name)
  );
}

function sessionTokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader(
    'Set-Cookie',
    `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${sessionDays * 86400}`
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader(
    'Set-Cookie',
    `${sessionCookie}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`
  );
}

function getSessionUser(req: Request) {
  const headerToken = req.headers['x-session-token'];
  const cookieToken = parseCookies(req.headers.cookie)[sessionCookie];
  const token = typeof headerToken === 'string' && headerToken ? headerToken : cookieToken;
  if (!token) return null;

  return (
    db
      .prepare(
        `SELECT users.id, users.name, users.email, users.phone, users.role
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
      )
      .get(sessionTokenHash(token), Date.now()) || null
  );
}

function requireUser(req: Request, role?: string) {
  const user = getSessionUser(req);
  if (!user) throw new HttpError(401, 'Inicia sesión para continuar.');
  if (role && user.role !== role) {
    throw new HttpError(403, 'Tu cuenta no tiene permiso para esta acción.');
  }
  return user;
}

function requireAdmin(req: Request) {
  const expectedKey = process.env.PULPERIA_ADMIN_KEY || 'admin-pulperia-2026';
  const providedKey = String(req.headers['x-admin-key'] || '');
  const expected = Buffer.from(expectedKey);
  const provided = Buffer.from(providedKey);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw new HttpError(401, 'Clave administrativa inválida. (Demo: admin-pulperia-2026)');
  }
}

function createSession(userId: number, res: Response, status = 200) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiry = Date.now() + sessionDays * 86400 * 1000;
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sessionTokenHash(token),
    userId,
    expiry
  );
  const user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(userId);
  setSessionCookie(res, token);
  res.status(status).json({
    success: true,
    sessionToken: token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
  });
}

async function startServer() {
  await seedInitialData();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Real-time Server-Sent Events (SSE) clients for order status & 200-product quota notifications
  const orderStreamClients = new Set<Response>();

  function broadcastStreamEvent(eventPayload: Record<string, any>) {
    const serialized = `data: ${JSON.stringify(eventPayload)}\n\n`;
    for (const clientRes of orderStreamClients) {
      try {
        clientRes.write(serialized);
      } catch {
        orderStreamClients.delete(clientRes);
      }
    }
  }

  function broadcastOrderStatusEvent(eventPayload: {
    orderId: string;
    storeName: string;
    previousStatus: string;
    newStatus: string;
    paymentStatus: string;
    fulfillment: string;
    timestamp: string;
  }) {
    broadcastStreamEvent({
      type: 'order:status_changed',
      ...eventPayload,
    });
  }

  function broadcastStoreQuotaExhaustedEvent(store: any, productCount: number, productLimit: number, customMsg?: string) {
    broadcastStreamEvent({
      type: 'store:quota_exhausted',
      storeId: store.id,
      storeName: store.name,
      productCount,
      productLimit,
      message:
        customMsg ||
        `¡Atención dueño de ${store.name}! Se terminaron tus ${productLimit} productos habilitados (${productCount}/${productLimit}). Recarga C$ 100 por Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049) para subir otros 200 productos automáticamente sin quitar tus 3 días de prueba gratis.`,
      timestamp: new Date().toISOString(),
    });
  }

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ success: true });
  });

  // Unified Auth Helper
  async function authenticateOrProvisionUser(req: Request, res: Response, isRegisterRoute: boolean) {
    const body = req.body || {};
    const rawEmail = String(body.email || '').trim().toLowerCase();
    const email = rawEmail.includes('@') ? rawEmail : `${rawEmail || 'usuario'}@pulperia.ni`;
    const password = String(body.password || 'pulperia1234');
    const rawName = String(body.nombre || '').trim();
    const rawPhone = String(body.telefono || '').trim();
    const department = String(body.department || 'Managua').trim() || 'Managua';

    if (!rawEmail) {
      throw new HttpError(400, 'Ingresa tu correo electrónico.');
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const requestedRole =
      body.rol === 'negocio'
        ? 'negocio'
        : body.rol === 'cliente'
        ? 'cliente'
        : existingUser?.role || 'cliente';

    const name =
      rawName.length >= 2
        ? rawName.slice(0, 80)
        : existingUser?.name || email.split('@')[0] || 'Usuario';
    const phone =
      rawPhone.length >= 4
        ? rawPhone.slice(0, 25)
        : existingUser?.phone || '+505 58898311';

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)) as Buffer;
    let userId: number;

    db.exec('BEGIN IMMEDIATE');
    try {
      if (existingUser) {
        userId = Number(existingUser.id);
        db.prepare(
          `UPDATE users SET name = ?, phone = ?, role = ?, password_salt = ?, password_hash = ? WHERE id = ?`
        ).run(name, phone, requestedRole, salt, passwordHash.toString('hex'), userId);
      } else {
        const created = db
          .prepare(
            `INSERT INTO users (name, email, phone, role, password_salt, password_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            name,
            email,
            phone,
            requestedRole,
            salt,
            passwordHash.toString('hex'),
            new Date().toISOString()
          );
        userId = Number(created.lastInsertRowid);
      }

      if (requestedRole === 'negocio') {
        const existingStore = getStoreForOwner(userId);
        if (!existingStore) {
          const trialEndsAt = new Date(Date.now() + freeTrialDays * 86400000).toISOString();
          const subscriptionUntil = new Date(Date.now() + (freeTrialDays + 30) * 86400000).toISOString();
          const defaultMethods = [
            {
              id: 'mobile_wallet',
              label: 'Billetera Móvil',
              recipient: name,
              account: phone,
              instructions: 'Transferencia móvil directa al teléfono de la pulpería',
            },
            {
              id: 'lafise',
              label: 'LAFISE',
              recipient: name,
              account: '134082049',
              instructions: 'Transferencia Bancanet o LAFISE Móvil en Córdobas',
            },
            {
              id: 'efectivo',
              label: 'Efectivo al recibir',
              recipient: name,
              account: 'Efectivo C$',
              instructions: 'Pago en efectivo al recibir o retirar en tienda',
            },
          ];
          db.prepare(
            `INSERT INTO stores (owner_id, name, department, description, phone, address, delivery, pickup, delivery_fee, payment_methods, subscription_until, trial_ends_at, product_limit)
             VALUES (?, ?, ?, ?, ?, ?, 1, 1, 25, ?, ?, ?, 200)`
          ).run(
            userId,
            name.toLowerCase().includes('pulper') ? name : `Pulpería ${name}`,
            department,
            `Pulpería afiliada en ${department}, Nicaragua. 3 días de prueba gratis activos y cupo de 200 productos.`,
            phone,
            `${department}, Nicaragua`,
            JSON.stringify(defaultMethods),
            subscriptionUntil,
            trialEndsAt
          );
        }
      }
      db.exec('COMMIT');
    } catch (error: any) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }

    createSession(userId, res, isRegisterRoute ? 201 : 200);
  }

  // Auth Endpoints
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      await authenticateOrProvisionUser(req, res, true);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      await authenticateOrProvisionUser(req, res, false);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/role', (req, res, next) => {
    try {
      const user = requireUser(req);
      const nextRole = req.body?.role === 'negocio' ? 'negocio' : 'cliente';
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nextRole, user.id);
        if (nextRole === 'negocio' && !getStoreForOwner(user.id)) {
          const trialEndsAt = new Date(Date.now() + freeTrialDays * 86400000).toISOString();
          const subscriptionUntil = new Date(Date.now() + (freeTrialDays + 30) * 86400000).toISOString();
          const defaultMethods = [
            {
              id: 'mobile_wallet',
              label: 'Billetera Móvil',
              recipient: user.name,
              account: user.phone || '+505 58898311',
              instructions: 'Transferencia móvil directa al teléfono de la pulpería',
            },
            {
              id: 'lafise',
              label: 'LAFISE',
              recipient: user.name,
              account: '134082049',
              instructions: 'Cuenta Bancaria LAFISE en Córdobas',
            },
            {
              id: 'efectivo',
              label: 'Efectivo al recibir',
              recipient: user.name,
              account: 'Efectivo C$',
              instructions: 'Pago en efectivo contra entrega',
            },
          ];
          db.prepare(
            `INSERT INTO stores (owner_id, name, department, description, phone, address, delivery, pickup, delivery_fee, payment_methods, subscription_until, trial_ends_at, product_limit)
             VALUES (?, ?, 'Managua', ?, ?, ?, 1, 1, 25, ?, ?, ?, 200)`
          ).run(
            user.id,
            `Pulpería ${user.name}`,
            'Pulpería local afiliada a Pulpería Nicaragua.',
            user.phone || '+505 58898311',
            'Managua, Nicaragua',
            JSON.stringify(defaultMethods),
            subscriptionUntil,
            trialEndsAt
          );
        }
        db.exec('COMMIT');
      } catch (err) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw err;
      }
      const updated = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(user.id);
      res.json({ success: true, user: updated });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const headerToken = req.headers['x-session-token'];
    const cookieToken = parseCookies(req.headers.cookie)[sessionCookie];
    const token = typeof headerToken === 'string' && headerToken ? headerToken : cookieToken;
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionTokenHash(token));
    }
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Inicia sesión para continuar.' });
    }
    res.json({ success: true, user });
  });

  // Public Marketplace Catalog & Stores (Nationwide across Nicaragua)
  app.get('/api/products', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT products.*, stores.name AS store_name, stores.department AS store_department,
                stores.address AS store_address, stores.phone AS store_phone,
                stores.delivery, stores.pickup, stores.delivery_fee, stores.payment_methods
         FROM products JOIN stores ON stores.id = products.store_id
         WHERE products.active = 1 AND products.stock > 0
         ORDER BY products.created_at DESC, products.id ASC`
      )
      .all();
    res.json({ success: true, products: rows.map(publicProduct) });
  });

  app.get('/api/stores', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT stores.*,
                (SELECT COUNT(*) FROM products WHERE products.store_id = stores.id AND products.active = 1 AND products.stock > 0) AS product_count
         FROM stores
         ORDER BY stores.id ASC`
      )
      .all();
    res.json({
      success: true,
      stores: rows.map((s: any) => ({
        id: s.id,
        name: s.name,
        department: s.department || 'Managua',
        description: s.description,
        phone: s.phone,
        address: s.address,
        delivery: Boolean(s.delivery),
        pickup: Boolean(s.pickup),
        deliveryFee: Number(s.delivery_fee),
        productCount: Math.max(Number(s.product_count), Number(s.simulated_quota_used || 0)),
        productLimit: Math.max(productsPerQuota, Number(s.product_limit || productsPerQuota)),
        paymentMethods: parsePaymentMethods(s.payment_methods),
      })),
    });
  });

  // Store Owner Catalog & Profile Management
  app.get('/api/store/products', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      if (!store) throw new HttpError(404, 'Pulpería no encontrada.');
      const rows = db
        .prepare(
          `SELECT products.*, stores.name AS store_name, stores.department AS store_department,
                  stores.address AS store_address, stores.phone AS store_phone,
                  stores.delivery, stores.pickup, stores.delivery_fee, stores.payment_methods
           FROM products JOIN stores ON stores.id = products.store_id
           WHERE products.store_id = ? AND products.active = 1
           ORDER BY products.created_at DESC, products.id DESC`
        )
        .all(store.id);
      res.json({ success: true, products: rows.map(publicProduct) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/products', (req, res, next) => {
    try {
      const user = getSessionUser(req);
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const category = String(body.category || 'abarrotes').trim();
      const price = Number(body.price);
      const stock = Number.isFinite(Number(body.stock)) ? Math.max(0, Math.round(Number(body.stock))) : 20;
      const requestedDepartment = String(body.department || 'Managua').trim() || 'Managua';

      if (
        name.length < 2 ||
        name.length > 140 ||
        !/^[a-záéíóúñ_-]{2,30}$/i.test(category) ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        throw new HttpError(400, 'Revisa el nombre, categoría, precio e inventario del producto.');
      }

      let targetStore: any = null;
      const requestedStoreId = Number(body.storeId);

      if (Number.isInteger(requestedStoreId) && requestedStoreId > 0) {
        targetStore = db.prepare('SELECT * FROM stores WHERE id = ?').get(requestedStoreId);
      }

      if (!targetStore && user) {
        targetStore = getStoreForOwner(user.id);
        if (!targetStore) {
          const trialEndsAt = new Date(Date.now() + freeTrialDays * 86400000).toISOString();
          const subscriptionUntil = new Date(Date.now() + (freeTrialDays + 30) * 86400000).toISOString();
          const customStoreName = String(body.newStoreName || '').trim();
          const storeTitle =
            customStoreName.length >= 2
              ? customStoreName.slice(0, 80)
              : user.name.toLowerCase().includes('pulper')
              ? user.name
              : `Pulpería ${user.name}`;
          const defaultMethods = [
            {
              id: 'mobile_wallet',
              label: 'Billetera Móvil',
              recipient: user.name,
              account: user.phone || '+505 58898311',
              instructions: 'Transferencia móvil directa al teléfono de la pulpería',
            },
            {
              id: 'lafise',
              label: 'LAFISE',
              recipient: user.name,
              account: '134082049',
              instructions: 'Transferencia Bancanet o LAFISE Móvil en Córdobas',
            },
          ];
          const insertedStore = db
            .prepare(
              `INSERT INTO stores (owner_id, name, department, description, phone, address, delivery, pickup, delivery_fee, payment_methods, subscription_until, trial_ends_at, product_limit)
               VALUES (?, ?, ?, ?, ?, ?, 1, 1, 25, ?, ?, ?, 200)`
            )
            .run(
              user.id,
              storeTitle,
              requestedDepartment,
              `Pulpería local en ${requestedDepartment}, afiliada a Pulpería Nicaragua.`,
              user.phone || '+505 58898311',
              `${requestedDepartment}, Nicaragua`,
              JSON.stringify(defaultMethods),
              subscriptionUntil,
              trialEndsAt
            );
          targetStore = db.prepare('SELECT * FROM stores WHERE id = ?').get(Number(insertedStore.lastInsertRowid));
        }
      }

      if (!targetStore) {
        targetStore = db.prepare('SELECT * FROM stores ORDER BY id ASC LIMIT 1').get();
      }

      if (!targetStore) {
        throw new HttpError(404, 'No se encontró una pulpería activa para publicar el producto.');
      }

      // Check 200-product quota before inserting; if quota is already full, notify the owner!
      const currentCount = getStoreProductCount(targetStore.id);
      const currentLimit = Math.max(productsPerQuota, Number(targetStore.product_limit || productsPerQuota));
      if (currentCount >= currentLimit) {
        broadcastStoreQuotaExhaustedEvent(targetStore, currentCount, currentLimit);
        throw new HttpError(
          402,
          `¡Se terminaron tus ${currentLimit} productos disponibles en ${targetStore.name}! Recarga C$ 100 por Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049) para habilitar otros 200 productos automáticamente sin perder tus 3 días de prueba gratis.`
        );
      }

      if (!subscriptionActive(targetStore)) {
        const renewedUntil = new Date(Date.now() + 30 * 86400000).toISOString();
        db.prepare('UPDATE stores SET subscription_until = ? WHERE id = ?').run(renewedUntil, targetStore.id);
      }

      const rawImage = String(body.image || '📦').trim().slice(0, 2_000_000);
      const created = db
        .prepare(
          `INSERT INTO products (store_id, name, category, description, image, price, stock, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          targetStore.id,
          name,
          category,
          String(body.description || '').trim().slice(0, 500),
          rawImage || '📦',
          price,
          stock,
          new Date().toISOString()
        );

      const newProductId = Number(created.lastInsertRowid);
      const updatedCount = getStoreProductCount(targetStore.id);
      if (updatedCount >= currentLimit) {
        broadcastStoreQuotaExhaustedEvent(targetStore, updatedCount, currentLimit);
      }

      const fullRow = db
        .prepare(
          `SELECT products.*, stores.name AS store_name, stores.department AS store_department,
                  stores.address AS store_address, stores.phone AS store_phone,
                  stores.delivery, stores.pickup, stores.delivery_fee, stores.payment_methods
           FROM products JOIN stores ON stores.id = products.store_id
           WHERE products.id = ?`
        )
        .get(newProductId);

      res.status(201).json({
        success: true,
        id: newProductId,
        product: fullRow ? publicProduct(fullRow) : undefined,
        productCount: updatedCount,
        productLimit: currentLimit,
        quotaExhausted: updatedCount >= currentLimit,
      });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/products/:id', (req, res, next) => {
    try {
      const productId = Number(req.params.id);
      const product = db
        .prepare(
          `SELECT products.*, stores.subscription_until FROM products JOIN stores ON stores.id = products.store_id
           WHERE products.id = ?`
        )
        .get(productId);
      if (!product) throw new HttpError(404, 'Producto no encontrado.');

      const body = req.body || {};
      const name = String(body.name || '').trim();
      const category = String(body.category || product.category || 'abarrotes').trim();
      const price = Number(body.price);
      const stock = Number.isFinite(Number(body.stock))
        ? Math.max(0, Math.round(Number(body.stock)))
        : Number(product.stock);
      if (
        name.length < 2 ||
        name.length > 140 ||
        !/^[a-záéíóúñ_-]{2,30}$/i.test(category) ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        throw new HttpError(400, 'Revisa el nombre, categoría, precio e inventario.');
      }

      const nextStoreId =
        Number.isInteger(Number(body.storeId)) && Number(body.storeId) > 0
          ? Number(body.storeId)
          : Number(product.store_id);

      const rawImage = String(body.image || product.image || '📦').trim().slice(0, 2_000_000);
      db.prepare(
        `UPDATE products SET store_id = ?, name = ?, category = ?, description = ?, image = ?, price = ?, stock = ?, active = 1 WHERE id = ?`
      ).run(
        nextStoreId,
        name,
        category,
        String(body.description ?? product.description ?? '').trim().slice(0, 500),
        rawImage || '📦',
        price,
        stock,
        product.id
      );

      const fullRow = db
        .prepare(
          `SELECT products.*, stores.name AS store_name, stores.department AS store_department,
                  stores.address AS store_address, stores.phone AS store_phone,
                  stores.delivery, stores.pickup, stores.delivery_fee, stores.payment_methods
           FROM products JOIN stores ON stores.id = products.store_id
           WHERE products.id = ?`
        )
        .get(product.id);

      res.json({
        success: true,
        product: fullRow ? publicProduct(fullRow) : undefined,
      });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/products/:id', (req, res, next) => {
    try {
      const productId = Number(req.params.id);
      const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
      if (!product) throw new HttpError(404, 'Producto no encontrado.');
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(product.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/store/me', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      if (!store) throw new HttpError(404, 'Pulpería no encontrada.');
      res.json({ success: true, store: publicStore(store) });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/store/me', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const department = String(body.department || 'Managua').trim() || 'Managua';
      const delivery = Boolean(body.delivery);
      const pickup = Boolean(body.pickup);
      const deliveryFee = Number(body.deliveryFee);
      const paymentMethods = validatePaymentMethods(body.paymentMethods || []);
      if (
        name.length < 2 ||
        name.length > 100 ||
        (!delivery && !pickup) ||
        !Number.isFinite(deliveryFee) ||
        deliveryFee < 0
      ) {
        throw new HttpError(400, 'Revisa el nombre, departamento, modalidades y costo de entrega.');
      }
      db.prepare(
        `UPDATE stores SET name = ?, department = ?, description = ?, phone = ?, address = ?, delivery = ?, pickup = ?, delivery_fee = ?, payment_methods = ? WHERE owner_id = ?`
      ).run(
        name,
        department.slice(0, 60),
        String(body.description || '').trim().slice(0, 500),
        String(body.phone || '').trim().slice(0, 25),
        String(body.address || '').trim().slice(0, 250),
        Number(delivery),
        Number(pickup),
        deliveryFee,
        JSON.stringify(paymentMethods),
        user.id
      );
      res.json({ success: true, store: publicStore(getStoreForOwner(user.id)) });
    } catch (err) {
      next(err);
    }
  });

  // Endpoint to simulate or reset the 200-product quota depletion so the owner can test the alert anytime
  app.post('/api/store/me/simulate-quota', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      if (!store) throw new HttpError(404, 'Pulpería no encontrada.');
      const limit = Math.max(productsPerQuota, Number(store.product_limit || productsPerQuota));
      const mode = req.body?.mode === 'reset' ? 'reset' : 'exhaust';

      if (mode === 'exhaust') {
        db.prepare('UPDATE stores SET simulated_quota_used = ? WHERE id = ?').run(limit, store.id);
        const updatedStore = getStoreForOwner(user.id);
        broadcastStoreQuotaExhaustedEvent(updatedStore, limit, limit);
      } else {
        db.prepare('UPDATE stores SET simulated_quota_used = 0 WHERE id = ?').run(store.id);
      }

      const freshStore = getStoreForOwner(user.id);
      res.json({
        success: true,
        store: publicStore(freshStore),
      });
    } catch (err) {
      next(err);
    }
  });

  // Cuaderno de Fiado Digital (Store Credits CRUD)
  app.get('/api/store/credits', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      if (!store) throw new HttpError(404, 'Pulpería no encontrada.');
      const rows = db
        .prepare(
          `SELECT id, store_id AS storeId, customer_name AS customerName, customer_phone AS customerPhone,
                  note, amount, paid_amount AS paidAmount, status, created_at AS createdAt
           FROM store_credits WHERE store_id = ? ORDER BY status ASC, created_at DESC`
        )
        .all(store.id);
      res.json({ success: true, credits: rows });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/store/credits', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      if (!store) throw new HttpError(404, 'Pulpería no encontrada.');
      const body = req.body || {};
      const customerName = String(body.customerName || '').trim();
      const customerPhone = String(body.customerPhone || '').trim();
      const note = String(body.note || '').trim();
      const amount = Number(body.amount);
      if (customerName.length < 2 || !Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, 'Ingresa el nombre del vecino y el monto fiado en córdobas.');
      }
      const inserted = db
        .prepare(
          `INSERT INTO store_credits (store_id, customer_name, customer_phone, note, amount, paid_amount, status, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 'pendiente', ?)`
        )
        .run(
          store.id,
          customerName.slice(0, 100),
          customerPhone.slice(0, 30),
          note.slice(0, 300),
          amount,
          new Date().toISOString()
        );
      res.status(201).json({ success: true, id: Number(inserted.lastInsertRowid) });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/store/credits/:id', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      const creditId = Number(req.params.id);
      const credit = db
        .prepare('SELECT * FROM store_credits WHERE id = ? AND store_id = ?')
        .get(creditId, store.id);
      if (!credit) throw new HttpError(404, 'Registro de fiado no encontrado.');

      const abono = Number(req.body?.abono || 0);
      const markPaid = Boolean(req.body?.markPaid);
      const nextPaid = markPaid
        ? Number(credit.amount)
        : Math.min(Number(credit.amount), Number(credit.paid_amount) + Math.max(0, abono));
      const nextStatus = nextPaid >= Number(credit.amount) ? 'pagado' : 'pendiente';

      db.prepare('UPDATE store_credits SET paid_amount = ?, status = ? WHERE id = ?').run(
        nextPaid,
        nextStatus,
        credit.id
      );
      res.json({ success: true, status: nextStatus, paidAmount: nextPaid });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/store/credits/:id', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      const creditId = Number(req.params.id);
      db.prepare('DELETE FROM store_credits WHERE id = ? AND store_id = ?').run(creditId, store.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // Billing, 3-Day Free Trial Preservation & Automatic 200-Product Recharge (C$ 100)
  app.get('/api/billing/me', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const store = getStoreForOwner(user.id);
      const payments = db
        .prepare(
          `SELECT id, method, reference, amount, products_added AS productsAdded, status,
                  created_at AS createdAt, verified_at AS verifiedAt
           FROM subscription_payments WHERE store_id = ? ORDER BY created_at DESC LIMIT 16`
        )
        .all(store.id);

      const storeSummary = publicStore(store);

      res.json({
        success: true,
        monthlyFee: monthlySubscriptionFee,
        productsPerPlan: productsPerQuota,
        productCount: storeSummary.productCount,
        productLimit: storeSummary.productLimit,
        remainingQuota: storeSummary.remainingQuota,
        quotaExhausted: storeSummary.quotaExhausted,
        trialEndsAt: storeSummary.trialEndsAt,
        trialDaysRemaining: storeSummary.trialDaysRemaining,
        subscriptionUntil: store.subscription_until,
        subscriptionActive: storeSummary.subscriptionActive,
        paymentMethods: getPlatformPaymentMethods(),
        payments,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/billing/me/payments', (req, res, next) => {
    try {
      const user = requireUser(req, 'negocio');
      const body = req.body || {};
      const methods = getPlatformPaymentMethods();
      const method =
        methods.find((item: any) => item.id === body.method) ||
        OFFICIAL_PLATFORM_METHODS.find((item) => item.id === body.method) ||
        OFFICIAL_PLATFORM_METHODS[0];
      const reference = String(body.reference || '').trim();
      const packages = Math.max(1, Math.min(10, Math.round(Number(body.packages || 1))));
      const totalAmount = packages * monthlySubscriptionFee; // C$ 100 por paquete
      const unlockedProducts = packages * productsPerQuota; // +200 productos por paquete

      if (reference.length < 3 || reference.length > 100) {
        throw new HttpError(
          400,
          'Ingresa el número de comprobante de tu Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049).'
        );
      }

      const store = getStoreForOwner(user.id);
      const nowIso = new Date().toISOString();

      // Preserve the 3 days of free trial! Never remove or shorten trial_ends_at:
      const preservedTrialEndsAt =
        store.trial_ends_at && Date.parse(store.trial_ends_at) > Date.now()
          ? store.trial_ends_at
          : new Date(Date.now() + freeTrialDays * 86400000).toISOString();

      const baseTimestamp = Math.max(
        Date.parse(store.subscription_until || '') || 0,
        Date.parse(preservedTrialEndsAt) || 0,
        Date.now()
      );
      const nextSubscriptionUntil = new Date(baseTimestamp + 30 * packages * 86400000).toISOString();

      // Calculate new product limit: unlock +200 products automatically on top of current limit
      const currentRealCount = Number(
        (
          db
            .prepare('SELECT COUNT(*) AS count FROM products WHERE store_id = ? AND active = 1')
            .get(store.id) as { count: number }
        )?.count || 0
      );
      const currentLimit = Math.max(productsPerQuota, Number(store.product_limit || productsPerQuota));
      const wasSimulatedFull = Number(store.simulated_quota_used || 0) >= currentLimit;
      const nextProductLimit = wasSimulatedFull
        ? Math.max(currentLimit, currentRealCount + unlockedProducts)
        : currentLimit + unlockedProducts;

      db.exec('BEGIN IMMEDIATE');
      let paymentId = 0;
      try {
        const payment = db
          .prepare(
            `INSERT INTO subscription_payments (store_id, method, reference, amount, products_added, status, created_at, verified_at)
             VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`
          )
          .run(store.id, method.id, reference, totalAmount, unlockedProducts, nowIso, nowIso);
        paymentId = Number(payment.lastInsertRowid);

        db.prepare(
          `UPDATE stores
           SET subscription_until = ?,
               trial_ends_at = ?,
               product_limit = ?,
               simulated_quota_used = 0
           WHERE id = ?`
        ).run(nextSubscriptionUntil, preservedTrialEndsAt, nextProductLimit, store.id);

        db.exec('COMMIT');
      } catch (e) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw e;
      }

      const updatedStore = publicStore(getStoreForOwner(user.id));
      res.status(201).json({
        success: true,
        paymentId,
        status: 'paid',
        unlockedProducts,
        amount: totalAmount,
        store: updatedStore,
        message: `¡Recarga de C$ ${totalAmount} activada automáticamente! Ya puedes subir +${unlockedProducts} productos y conservas tus ${updatedStore.trialDaysRemaining} días de prueba gratis.`,
      });
    } catch (err) {
      next(err);
    }
  });

  // Orders Endpoints
  app.get('/api/orders', (req, res, next) => {
    try {
      const user = requireUser(req);
      if (user.role === 'cliente') {
        return res.json({ success: true, orders: orderQuery('orders.customer_id = ?', user.id) });
      }
      const store = getStoreForOwner(user.id);
      return res.json({ success: true, orders: orderQuery('orders.store_id = ?', store.id) });
    } catch (err) {
      next(err);
    }
  });

  // Pre-validate receipt transaction code uniqueness before enabling 'Confirmar pedido'
  app.get('/api/orders/validate-receipt', (req, res) => {
    const rawRef = String(req.query.reference || '').trim().toUpperCase();
    const recurringSameDay = String(req.query.recurringSameDay || '') === '1';
    if (!rawRef || rawRef.length < 4 || !/\d/.test(rawRef)) {
      return res.json({
        success: true,
        valid: false,
        unique: false,
        message: 'El código de transacción debe tener al menos 4 caracteres e incluir dígitos numéricos.',
      });
    }
    const existingOrder = db
      .prepare('SELECT id, created_at FROM orders WHERE UPPER(TRIM(payment_reference)) = ? LIMIT 1')
      .get(rawRef) as { id: string; created_at?: string } | undefined;
    const existingSub = db
      .prepare('SELECT id FROM subscription_payments WHERE UPPER(TRIM(reference)) = ? LIMIT 1')
      .get(rawRef) as { id: number } | undefined;

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const isSameDayOrder =
      existingOrder && String(existingOrder.created_at || '').startsWith(todayPrefix);

    if ((existingOrder && !(recurringSameDay && isSameDayOrder)) || existingSub) {
      return res.json({
        success: true,
        valid: false,
        unique: false,
        message: `El código de transacción "${rawRef}" ya fue registrado anteriormente. Sube un comprobante con código único.`,
      });
    }

    return res.json({
      success: true,
      valid: true,
      unique: true,
      normalizedReference: rawRef,
      message:
        recurringSameDay && isSameDayOrder
          ? `Código recurrente del mismo día "${rawRef}" autocompletado y pre-validado.`
          : `Código de transacción único "${rawRef}" pre-validado correctamente.`,
    });
  });

  app.post('/api/orders', (req, res, next) => {
    try {
      const user = requireUser(req, 'cliente');
      const body = req.body || {};
      const customerName = String(body.customerName || user.name).trim();
      const customerPhone = String(body.customerPhone || user.phone).trim();
      const fulfillment = body.fulfillment;
      const address = String(body.address || '').trim();
      const paymentMethodId = String(body.paymentMethodId || '');
      const isCashPayment = paymentMethodId === 'efectivo';
      const recurringSameDay = Boolean(body.recurringSameDay);
      const paymentReference = isCashPayment
        ? String(body.paymentReference || 'Pago en efectivo al recibir').trim()
        : String(body.paymentReference || '').trim();

      if (
        !customerName ||
        !customerPhone ||
        !['delivery', 'pickup'].includes(fulfillment) ||
        (fulfillment === 'delivery' && !address)
      ) {
        throw new HttpError(400, 'Completa tus datos y la modalidad del pedido.');
      }
      if (!paymentMethodId || (!isCashPayment && (paymentReference.length < 4 || paymentReference.length > 100))) {
        throw new HttpError(400, 'Sube la captura del comprobante y verifica el código de transacción único.');
      }
      const paymentScreenshot = String(body.paymentScreenshot || '').trim().slice(0, 2_000_000);
      if (!isCashPayment) {
        if (!paymentScreenshot) {
          throw new HttpError(
            400,
            'Debes adjuntar la captura de pantalla del comprobante LAFISE / Billetera Móvil antes de confirmar el pedido.'
          );
        }
        const duplicateOrder = db
          .prepare('SELECT id, created_at FROM orders WHERE UPPER(TRIM(payment_reference)) = UPPER(TRIM(?)) LIMIT 1')
          .get(paymentReference) as { id: string; created_at?: string } | undefined;
        const todayPrefix = new Date().toISOString().slice(0, 10);
        const isSameDayRecurringAllowed =
          recurringSameDay &&
          duplicateOrder &&
          String(duplicateOrder.created_at || '').startsWith(todayPrefix);
        if (duplicateOrder && !isSameDayRecurringAllowed) {
          throw new HttpError(
            409,
            `El código de transacción "${paymentReference}" ya fue utilizado en otro pedido.`
          );
        }
      }
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
        throw new HttpError(400, 'El pedido no tiene productos válidos.');
      }

      const orderId = `PED-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const depletedProductNames: string[] = [];
      let orderStoreRow: any = null;

      try {
        db.exec('BEGIN IMMEDIATE');
        const requestedItems = new Map<number, number>();
        for (const item of body.items) {
          const productId = Number(item.productId);
          const quantity = Number(item.quantity);
          if (!Number.isSafeInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
            throw new HttpError(400, 'Cantidad de producto inválida.');
          }
          requestedItems.set(productId, (requestedItems.get(productId) || 0) + quantity);
        }

        const items: any[] = [];
        let storeId: number | null = null;
        for (const [productId, quantity] of requestedItems) {
          const product = db
            .prepare(
              `SELECT products.*, stores.name AS store_name, stores.delivery, stores.pickup, stores.delivery_fee,
                      stores.payment_methods, stores.subscription_until, stores.trial_ends_at, stores.product_limit
               FROM products JOIN stores ON stores.id = products.store_id
               WHERE products.id = ? AND products.active = 1`
            )
            .get(productId);
          if (!product || product.stock < quantity) {
            throw new HttpError(409, 'Un producto ya no tiene existencias suficientes. Actualiza el catálogo.');
          }
          requireActiveSubscription({
            subscription_until: product.subscription_until,
            trial_ends_at: product.trial_ends_at,
          });
          if (storeId !== null && storeId !== product.store_id) {
            throw new HttpError(400, 'Cada pedido debe corresponder a una sola pulpería.');
          }
          storeId = product.store_id;
          orderStoreRow = {
            id: product.store_id,
            name: product.store_name,
            product_limit: product.product_limit,
          };
          if (fulfillment === 'delivery' && !product.delivery) {
            throw new HttpError(409, 'Esta pulpería no ofrece entrega a domicilio.');
          }
          if (fulfillment === 'pickup' && !product.pickup) {
            throw new HttpError(409, 'Esta pulpería no ofrece retiro en tienda.');
          }
          items.push({ ...product, quantity });
        }

        const configuredMethods = parsePaymentMethods(items[0].payment_methods);
        const paymentMethod =
          configuredMethods.find((item: any) => item.id === paymentMethodId) ||
          (isCashPayment
            ? {
                id: 'efectivo',
                label: 'Efectivo al recibir',
                recipient: items[0].store_name,
                account: 'Efectivo C$',
                instructions: 'Pago contra entrega',
              }
            : null);

        if (!paymentMethod) {
          throw new HttpError(409, 'Este método de pago no está configurado por la pulpería.');
        }

        const deliveryFee = fulfillment === 'delivery' ? Number(items[0].delivery_fee) : 0;
        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const platformFee = Math.round(subtotal * platformCommissionRate * 100) / 100;
        const sellerNet = subtotal - platformFee + deliveryFee;

        const initialPaymentStatus = isCashPayment ? 'paid' : 'verification_pending';
        const initialOrderStatus = isCashPayment ? 'Pendiente' : 'Pago por verificar';

        db.prepare(
          `INSERT INTO orders (
            id, customer_id, store_id, customer_name, customer_phone, fulfillment,
            address, delivery_fee, subtotal, platform_fee, seller_net, payment_method,
            payment_reference, payment_screenshot, payment_status, total, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          orderId,
          user.id,
          storeId,
          customerName,
          customerPhone,
          fulfillment,
          fulfillment === 'delivery' ? address : 'Retiro en pulpería',
          deliveryFee,
          subtotal,
          platformFee,
          sellerNet,
          paymentMethodId,
          paymentReference.toUpperCase(),
          paymentScreenshot,
          initialPaymentStatus,
          subtotal + deliveryFee,
          initialOrderStatus,
          createdAt
        );

        const insertItem = db.prepare(
          'INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)'
        );
        const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
        for (const item of items) {
          insertItem.run(orderId, item.id, item.name, item.price, item.quantity);
          const result = updateStock.run(item.quantity, item.id, item.quantity);
          if (Number(result.changes) !== 1) {
            throw new HttpError(409, 'El inventario cambió. Intenta nuevamente.');
          }
          if (Number(item.stock) - item.quantity <= 0) {
            depletedProductNames.push(item.name);
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }

      if (depletedProductNames.length > 0 && orderStoreRow) {
        broadcastStoreQuotaExhaustedEvent(
          orderStoreRow,
          getStoreProductCount(orderStoreRow.id),
          Number(orderStoreRow.product_limit || 200),
          `¡Atención dueño de ${orderStoreRow.name}! Se agotaron todas las unidades de: ${depletedProductNames.join(
            ', '
          )}. Reabastece tu inventario o recarga C$ 100 por Billetera Móvil (+505 58898311) o Cuenta LAFISE (134082049) para habilitar 200 productos más.`
        );
      }

      const orders = orderQuery('orders.id = ?', orderId);
      res.status(201).json({ success: true, order: orders[0] });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/orders/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
    orderStreamClients.add(res);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        orderStreamClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      orderStreamClients.delete(res);
    });
  });

  app.patch('/api/orders/:id/payment', (req, res, next) => {
    try {
      requireUser(req);
      const orderId = req.params.id;
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order || order.payment_status !== 'verification_pending') {
        throw new HttpError(404, 'Pago pendiente de verificación no encontrado.');
      }
      const previousStatus = String(order.status || 'Pago por verificar');
      const body = req.body || {};
      if (!['paid', 'rejected'].includes(body.status)) {
        throw new HttpError(400, 'Estado de pago inválido.');
      }
      if (body.status === 'paid') {
        db.prepare("UPDATE orders SET payment_status = 'paid', status = 'Pendiente' WHERE id = ?").run(order.id);
      } else {
        db.exec('BEGIN IMMEDIATE');
        const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
        const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        items.forEach((item: any) => restoreStock.run(item.quantity, item.product_id));
        db.prepare("UPDATE orders SET payment_status = 'rejected', status = 'Pago rechazado' WHERE id = ?").run(
          order.id
        );
        db.exec('COMMIT');
      }
      const updated = orderQuery('orders.id = ?', order.id)[0];
      if (updated) {
        broadcastOrderStatusEvent({
          orderId: updated.id,
          storeName: updated.storeName,
          previousStatus,
          newStatus: updated.status,
          paymentStatus: updated.paymentStatus,
          fulfillment: updated.fulfillment,
          timestamp: new Date().toISOString(),
        });
      }
      res.json({ success: true, order: updated });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/orders/:id/status', (req, res, next) => {
    try {
      requireUser(req);
      const orderId = req.params.id;
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new HttpError(404, 'Pedido no encontrado.');
      if (order.payment_status !== 'paid') {
        throw new HttpError(409, 'Confirma el pago antes de preparar este pedido.');
      }
      const previousStatus = String(order.status);
      const body = req.body || {};
      const defaultNext =
        order.status === 'Pendiente'
          ? 'Preparando'
          : order.status === 'Preparando'
          ? order.fulfillment === 'pickup'
            ? 'Listo para retirar'
            : 'En camino'
          : order.status === 'En camino' || order.status === 'Listo para retirar'
          ? 'Completado'
          : 'Preparando';

      const requestedStatus = String(body.status || defaultNext).trim();
      const validStatuses = ['Pendiente', 'Preparando', 'En camino', 'Listo para retirar', 'Completado'];
      const nextStatus = validStatuses.includes(requestedStatus) ? requestedStatus : defaultNext;

      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(nextStatus, order.id);
      const updated = orderQuery('orders.id = ?', order.id)[0];
      if (updated && previousStatus !== updated.status) {
        broadcastOrderStatusEvent({
          orderId: updated.id,
          storeName: updated.storeName,
          previousStatus,
          newStatus: updated.status,
          paymentStatus: updated.paymentStatus,
          fulfillment: updated.fulfillment,
          timestamp: new Date().toISOString(),
        });
      }
      res.json({ success: true, order: updated });
    } catch (err) {
      next(err);
    }
  });

  // Platform Admin Endpoints
  app.get('/api/admin/summary', (req, res, next) => {
    try {
      requireAdmin(req);
      const pendingPayments = db
        .prepare(
          `SELECT subscription_payments.id, subscription_payments.method, subscription_payments.reference,
                  subscription_payments.amount, subscription_payments.products_added AS productsAdded,
                  subscription_payments.created_at AS createdAt,
                  stores.name AS storeName, users.email AS ownerEmail
           FROM subscription_payments
           JOIN stores ON stores.id = subscription_payments.store_id
           JOIN users ON users.id = stores.owner_id
           WHERE subscription_payments.status = 'pending'
           ORDER BY subscription_payments.created_at`
        )
        .all();

      const commissionTotal = db
        .prepare(
          `SELECT COALESCE(SUM(platform_fee), 0) AS total
           FROM orders WHERE status = 'Completado' AND payment_status = 'paid'`
        )
        .get().total;

      const subscriptionTotal = db
        .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM subscription_payments WHERE status = 'paid'")
        .get().total;

      const allStoresCount = db.prepare('SELECT COUNT(*) AS count FROM stores').get().count;
      const totalOrdersCount = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;

      res.json({
        success: true,
        monthlyFee: monthlySubscriptionFee,
        productsPerPlan: productsPerQuota,
        commissionTotal: Number(commissionTotal),
        subscriptionTotal: Number(subscriptionTotal),
        allStoresCount: Number(allStoresCount),
        totalOrdersCount: Number(totalOrdersCount),
        paymentMethods: getPlatformPaymentMethods(),
        pendingPayments,
      });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/admin/payment-methods', (req, res, next) => {
    try {
      requireAdmin(req);
      const body = req.body || {};
      const methods = validatePaymentMethods(body.methods || []);
      if (!methods.length) {
        throw new HttpError(400, 'Activa y configura al menos una cuenta receptora.');
      }
      db.prepare('UPDATE platform_settings SET payment_methods = ? WHERE id = 1').run(JSON.stringify(methods));
      res.json({ success: true, paymentMethods: methods });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/subscription-payments/:id', (req, res, next) => {
    try {
      requireAdmin(req);
      const body = req.body || {};
      if (!['paid', 'rejected'].includes(body.status)) {
        throw new HttpError(400, 'Estado de pago inválido.');
      }
      const payment = db.prepare('SELECT * FROM subscription_payments WHERE id = ?').get(Number(req.params.id));
      if (!payment || payment.status !== 'pending') {
        throw new HttpError(404, 'Solicitud pendiente no encontrada.');
      }
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE subscription_payments SET status = ?, verified_at = ? WHERE id = ?').run(
        body.status,
        new Date().toISOString(),
        payment.id
      );
      if (body.status === 'paid') {
        const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(payment.store_id);
        const start = Math.max(
          Date.parse(store.subscription_until) || 0,
          Date.parse(store.trial_ends_at) || 0,
          Date.now()
        );
        const nextDueDate = new Date(start + 30 * 86400000).toISOString();
        const nextLimit =
          Math.max(productsPerQuota, Number(store.product_limit || productsPerQuota)) +
          Number(payment.products_added || productsPerQuota);
        db.prepare(
          'UPDATE stores SET subscription_until = ?, product_limit = ?, simulated_quota_used = 0 WHERE id = ?'
        ).run(nextDueDate, nextLimit, payment.store_id);
      }
      db.exec('COMMIT');
      res.json({ success: true, status: body.status });
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      next(err);
    }
  });

  // API Error Handler
  app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('Error en servidor:', err);
    res.status(status).json({
      success: false,
      message: status === 500 ? 'Ocurrió un error interno en el servidor.' : err.message,
    });
  });

  // Vite Dev Server or Production Static Assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(root, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Pulpería Nicaragua lista en http://0.0.0.0:${port}`);
  });
}

startServer();
