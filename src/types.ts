export type UserRole = 'cliente' | 'negocio';

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
}

export interface PaymentMethodConfig {
  id: 'lafise' | 'mobile_wallet' | 'banpro' | 'rapibac' | 'efectivo';
  label: string;
  recipient: string;
  account: string;
  instructions: string;
}

export interface Product {
  id: number;
  storeId: number;
  name: string;
  category: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  storeName: string;
  storeDepartment?: string;
  storeAddress?: string;
  storePhone?: string;
  deliveryFee: number;
  delivery: boolean;
  pickup: boolean;
  paymentMethods: PaymentMethodConfig[];
}

export interface PublicStoreSummary {
  id: number;
  name: string;
  department: string;
  description: string;
  phone: string;
  address: string;
  delivery: boolean;
  pickup: boolean;
  deliveryFee: number;
  productCount: number;
  productLimit: number;
  paymentMethods: PaymentMethodConfig[];
}

export interface StoreProfile {
  id: number;
  name: string;
  department: string;
  description: string;
  phone: string;
  address: string;
  delivery: boolean;
  pickup: boolean;
  deliveryFee: number;
  paymentMethods: PaymentMethodConfig[];
  subscriptionUntil: string;
  subscriptionActive: boolean;
  trialEndsAt: string;
  trialDaysRemaining: number;
  productCount: number;
  productLimit: number;
  remainingQuota: number;
  quotaExhausted: boolean;
}

export interface OrderItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

export type OrderStatus =
  | 'Pago por verificar'
  | 'Pago rechazado'
  | 'Pendiente'
  | 'Preparando'
  | 'En camino'
  | 'Listo para retirar'
  | 'Completado';

export interface Order {
  id: string;
  storeId: number;
  storeName: string;
  storeDepartment?: string;
  storePhone?: string;
  customerName: string;
  customerPhone: string;
  fulfillment: 'delivery' | 'pickup';
  address: string;
  deliveryFee: number;
  subtotal: number;
  platformFee: number;
  sellerNet: number;
  paymentMethod: string;
  paymentLabel: string;
  paymentInstructions: PaymentMethodConfig | null;
  paymentReference: string;
  paymentStatus: 'verification_pending' | 'paid' | 'rejected';
  total: number;
  status: string;
  createdAt: string;
  items: OrderItem[];
}

export interface SubscriptionPaymentRecord {
  id: number;
  method: string;
  reference: string;
  amount: number;
  productsAdded?: number;
  status: 'pending' | 'paid' | 'rejected';
  createdAt: string;
  verifiedAt?: string | null;
  storeName?: string;
  ownerEmail?: string;
}

export interface BillingSummary {
  monthlyFee: number;
  productsPerPlan: number;
  productCount: number;
  productLimit: number;
  remainingQuota: number;
  quotaExhausted: boolean;
  trialEndsAt: string;
  trialDaysRemaining: number;
  subscriptionUntil: string;
  subscriptionActive: boolean;
  paymentMethods: PaymentMethodConfig[];
  payments: SubscriptionPaymentRecord[];
}

export interface CreditRecord {
  id: number;
  storeId: number;
  customerName: string;
  customerPhone: string;
  note: string;
  amount: number;
  paidAmount: number;
  status: 'pendiente' | 'pagado';
  createdAt: string;
}

export interface AdminSummary {
  monthlyFee: number;
  productsPerPlan?: number;
  commissionTotal: number;
  subscriptionTotal: number;
  paymentMethods: PaymentMethodConfig[];
  pendingPayments: SubscriptionPaymentRecord[];
  allStoresCount?: number;
  totalOrdersCount?: number;
}
