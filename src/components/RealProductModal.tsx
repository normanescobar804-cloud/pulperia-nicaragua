import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Image as ImageIcon, Check, Sparkles, Trash2 } from 'lucide-react';
import { Product, PublicStoreSummary } from '../types';
import {
  api,
  compressImageFile,
  formatPrice,
  categoryLabel,
  getProductImageUrl,
  isCustomImageUrl,
  PRODUCT_CATEGORIES,
  NICARAGUA_DEPARTMENTS,
} from '../utils/format';

interface RealProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingProduct?: Product | null;
  stores: PublicStoreSummary[];
  defaultStoreId?: number;
  onSaved: (savedProduct?: Product) => void;
  onDeleted?: (deletedId: number) => void;
  onNotify: (message: string, isError?: boolean) => void;
}

const REAL_NICARAGUAN_TEMPLATES = [
  {
    name: 'Huevo Nacional Fresco (Cajilla 30 uds)',
    category: 'carnes',
    price: 175,
    stock: 15,
    description: 'Cajilla de 30 huevos blancos grandes de granja nacional, frescos del día.',
  },
  {
    name: 'Leche Entera Eskimo (Bolsa 1 Litro)',
    category: 'lacteos',
    price: 48,
    stock: 24,
    description: 'Leche entera pasteurizada fortificada con vitaminas A y D, bien fría.',
  },
  {
    name: 'Coca-Cola Retornable Bien Helada (2 Litros)',
    category: 'bebidas',
    price: 52,
    stock: 30,
    description: 'Gaseosa familiar de 2 litros recién sacada del mantenedor.',
  },
  {
    name: 'Azúcar Sulfitada Monte Rosa (Bolsa 2 lb)',
    category: 'abarrotes',
    price: 32,
    stock: 40,
    description: 'Azúcar de caña nicaragüense fortificada con vitamina A.',
  },
  {
    name: 'Tortillas de Maíz Palmeadas (Paquete 10 uds)',
    category: 'galletas',
    price: 25,
    stock: 25,
    description: 'Tortillas calientes de maíz nisquezado hechas a mano en comal.',
  },
  {
    name: 'Pechuga de Pollo Fresca Tip-Top (1 lb)',
    category: 'carnes',
    price: 68,
    stock: 18,
    description: 'Corte fresco de pollo nacional mantenido en refrigeración.',
  },
  {
    name: 'Plátanos Verdes / Maduros de Rivas (Unidad)',
    category: 'frutas',
    price: 12,
    stock: 50,
    description: 'Plátanos grandes cosechados en Rivas, ideales para tajadas o maduro frito.',
  },
  {
    name: 'Detergente en Polvo Xedex (Bolsa 900 g)',
    category: 'limpieza',
    price: 58,
    stock: 22,
    description: 'Detergente multiusos biodegradable para ropa blanca y de color.',
  },
];

const PRESENTATION_UNITS = [
  '',
  '1 lb',
  '2 lb',
  '1/2 lb',
  '1 unidad',
  '1 Litro',
  '2 Litros',
  'Bolsa',
  'Botella',
  'Paquete',
  'Cajilla 30 uds',
  '400 g',
];

export function RealProductModal({
  isOpen,
  onClose,
  editingProduct,
  stores,
  defaultStoreId,
  onSaved,
  onDeleted,
  onNotify,
}: RealProductModalProps) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('abarrotes');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('20');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload');
  const [storeId, setStoreId] = useState<number | 'new'>(defaultStoreId || stores[0]?.id || 1);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreDepartment, setNewStoreDepartment] = useState('Managua');
  const [processingImage, setProcessingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(false);
    if (editingProduct) {
      setName(editingProduct.name);
      setUnit('');
      setCategory(editingProduct.category || 'abarrotes');
      setPrice(String(editingProduct.price));
      setStock(String(editingProduct.stock));
      setDescription(editingProduct.description || '');
      const hasCustom = isCustomImageUrl(editingProduct.image);
      setImage(hasCustom ? editingProduct.image : '');
      setImageMode(
        hasCustom && editingProduct.image.startsWith('http') ? 'url' : 'upload'
      );
      setStoreId(editingProduct.storeId || defaultStoreId || stores[0]?.id || 1);
    } else {
      setName('');
      setUnit('');
      setCategory('abarrotes');
      setPrice('');
      setStock('20');
      setDescription('');
      setImage('');
      setImageMode('upload');
      setStoreId(defaultStoreId || stores[0]?.id || 1);
      setNewStoreName('');
    }
  }, [isOpen, editingProduct, defaultStoreId, stores]);

  if (!isOpen) return null;

  const finalProductName = (() => {
    const cleanName = name.trim();
    if (!cleanName) return '';
    if (!unit || cleanName.toLowerCase().includes(unit.toLowerCase())) {
      return cleanName;
    }
    return `${cleanName} (${unit})`;
  })();

  const selectedStoreName =
    storeId === 'new'
      ? newStoreName.trim() || 'Mi Pulpería'
      : stores.find((s) => s.id === Number(storeId))?.name || 'Pulpería Local';

  const previewUrl = getProductImageUrl({
    name: finalProductName || 'Producto',
    category,
    image: image.trim() || '📦',
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingImage(true);
    try {
      const compressedDataUrl = await compressImageFile(file, 900, 0.82);
      setImage(compressedDataUrl);
      onNotify('Foto real cargada y optimizada correctamente.');
    } catch (err: any) {
      onNotify(err.message || 'No se pudo procesar la foto seleccionada.', true);
    } finally {
      setProcessingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const applyTemplate = (tpl: (typeof REAL_NICARAGUAN_TEMPLATES)[number]) => {
    setName(tpl.name);
    setUnit('');
    setCategory(tpl.category);
    setPrice(String(tpl.price));
    setStock(String(tpl.stock));
    setDescription(tpl.description);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (finalProductName.length < 2) {
      onNotify('Escribe el nombre real del producto (al menos 2 caracteres).', true);
      return;
    }
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      onNotify('Ingresa un precio válido en córdobas (C$).', true);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: finalProductName,
        category,
        price: numericPrice,
        stock: Math.max(0, Math.round(Number(stock) || 0)),
        description: description.trim(),
        image: image.trim() || '📦',
        storeId: storeId === 'new' ? undefined : Number(storeId),
        newStoreName: storeId === 'new' ? newStoreName.trim() : undefined,
        department: storeId === 'new' ? newStoreDepartment : undefined,
      };

      if (editingProduct) {
        const res = await api<{ product?: Product }>(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onNotify(`Producto "${finalProductName}" actualizado en el catálogo.`);
        onSaved(res.product);
      } else {
        const res = await api<{ product?: Product }>('/api/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onNotify(`¡Producto real "${finalProductName}" publicado en ${selectedStoreName}!`);
        onSaved(res.product);
      }
      onClose();
    } catch (err: any) {
      onNotify(err.message || 'No se pudo guardar el producto.', true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editingProduct) return;
    setSubmitting(true);
    try {
      await api(`/api/products/${editingProduct.id}`, { method: 'DELETE' });
      onNotify(`Producto "${editingProduct.name}" eliminado del catálogo.`);
      onDeleted?.(editingProduct.id);
      onSaved();
      onClose();
    } catch (err: any) {
      onNotify(err.message || 'No se pudo eliminar el producto.', true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="bg-white border border-stone-200 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl my-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="real-product-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-stone-900 text-white flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-amber-300 font-medium">
              Inventario real en córdobas (C$)
            </div>
            <h2 id="real-product-modal-title" className="text-lg font-semibold">
              {editingProduct ? `Editar: ${editingProduct.name}` : 'Publicar producto real en el catálogo'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-white rounded-lg"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 max-h-[85vh] overflow-y-auto space-y-6">
          {/* Quick Real Nicaraguan Product Templates (only when creating) */}
          {!editingProduct && (
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                <Sparkles className="w-3.5 h-3.5 text-amber-800" />
                <span>Llenado rápido con productos reales comunes (opcional, haz clic para rellenar):</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REAL_NICARAGUAN_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="px-2.5 py-1 text-xs bg-white hover:bg-amber-100/80 text-stone-800 border border-amber-300/80 rounded-md transition-colors"
                  >
                    {tpl.name.split(' (')[0]} · <span className="font-mono font-medium">C$ {tpl.price}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form Fields (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              {/* Store Selector */}
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Pulpería donde se vende este producto
                </label>
                <select
                  value={storeId}
                  onChange={(e) =>
                    setStoreId(e.target.value === 'new' ? 'new' : Number(e.target.value))
                  }
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-stone-900"
                >
                  {stores.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} — {st.department || 'Managua'} ({st.productCount}/{st.productLimit || 200} prod.)
                    </option>
                  ))}
                  <option value="new">+ Crear / usar mi propia pulpería (3 días gratis + 200 prod.)</option>
                </select>
              </div>

              {storeId === 'new' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      Nombre de tu pulpería
                    </label>
                    <input
                      type="text"
                      required
                      value={newStoreName}
                      onChange={(e) => setNewStoreName(e.target.value)}
                      placeholder="Ej. Pulpería San Judas..."
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      Departamento de Nicaragua
                    </label>
                    <select
                      value={newStoreDepartment}
                      onChange={(e) => setNewStoreDepartment(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-stone-900"
                    >
                      {NICARAGUA_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Product Name + Unit */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Nombre y marca del producto real
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Leche Eskimo, Arroz Faisán, Coca-Cola..."
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Unidad / Peso
                  </label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-stone-900"
                  >
                    <option value="">Ya incluido / Libre</option>
                    {PRESENTATION_UNITS.filter(Boolean).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Category, Price, Stock */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Categoría
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:outline-none focus:border-stone-900"
                  >
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Precio real (C$)
                  </label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Ej. 45"
                    className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Existencia (uds)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    placeholder="20"
                    className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                      Number(stock) > 0 && Number(stock) < 5
                        ? 'border-amber-500 bg-amber-50/50 text-amber-950 focus:border-amber-700'
                        : 'border-stone-300 focus:border-stone-900'
                    }`}
                  />
                  {Number(stock) > 0 && Number(stock) < 5 && (
                    <p className="text-[11px] text-amber-800 font-medium mt-1">
                      Se mostrará con etiqueta &ldquo;Poco stock&rdquo; (&lt; 5 uds).
                    </p>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Descripción del producto (marca, frescura, detalles)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. Producto fresco del día, marca nacional, listo para entrega o retiro."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                />
              </div>

              {/* Real Photo Upload / URL Section */}
              <div className="space-y-2.5 pt-2 border-t border-stone-200">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-stone-700">
                    Fotografía del producto
                  </label>
                  <div className="inline-flex rounded-lg bg-stone-100 p-0.5 border border-stone-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setImageMode('upload')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        imageMode === 'upload'
                          ? 'bg-white text-stone-900 shadow-xs'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      Subir foto / Cámara
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageMode('url')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        imageMode === 'url'
                          ? 'bg-white text-stone-900 shadow-xs'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      Pegar enlace URL
                    </button>
                  </div>
                </div>

                {imageMode === 'upload' ? (
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                      id="real-product-photo-input"
                    />
                    <label
                      htmlFor="real-product-photo-input"
                      className="flex-1 cursor-pointer border border-dashed border-stone-400 hover:border-amber-800 bg-stone-50 hover:bg-amber-50/40 rounded-xl p-3.5 flex items-center justify-center gap-2.5 text-xs font-medium text-stone-700 transition-colors"
                    >
                      <Upload className="w-4 h-4 text-amber-800 shrink-0" />
                      <span>
                        {processingImage
                          ? 'Optimizando foto...'
                          : isCustomImageUrl(image)
                          ? 'Cambiar foto tomada o subida'
                          : 'Tomar foto con cámara o elegir archivo (.jpg, .png, .webp)'}
                      </span>
                    </label>
                    {isCustomImageUrl(image) && (
                      <button
                        type="button"
                        onClick={() => setImage('')}
                        className="px-3 py-2 text-xs text-red-700 hover:bg-red-50 border border-red-200 rounded-lg"
                      >
                        Quitar foto
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <ImageIcon className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        value={image.startsWith('data:') ? '' : image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder="https://ejemplo.com/foto-producto.jpg"
                        className="w-full pl-9 pr-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 font-mono"
                      />
                    </div>
                    {isCustomImageUrl(image) && (
                      <button
                        type="button"
                        onClick={() => setImage('')}
                        className="px-3 py-2 text-xs text-stone-600 hover:text-stone-900 border border-stone-300 rounded-lg"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Live Storefront Card Preview (5 cols) */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-stone-500">
                  <span className="font-medium text-stone-700">Vista previa en el catálogo</span>
                  <span>{isCustomImageUrl(image) ? 'Foto personalizada' : 'Foto de categoría'}</span>
                </div>

                {/* Preview Card */}
                <div
                  className={`bg-white border rounded-xl overflow-hidden shadow-xs ${
                    Number(stock) > 0 && Number(stock) < 5 ? 'border-amber-400' : 'border-stone-200'
                  }`}
                >
                  <div className="aspect-[4/3] w-full bg-[#F9F9F8] overflow-hidden relative">
                    <img
                      src={previewUrl}
                      alt={finalProductName || 'Vista previa'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    {Number(stock) > 0 && Number(stock) < 5 && (
                      <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-md bg-amber-950/90 backdrop-blur-xs text-amber-100 border border-amber-500/40 shadow-sm flex items-center gap-1.5 text-[11px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="font-semibold">Poco stock</span>
                        <span className="text-amber-300">·</span>
                        <span className="font-mono text-amber-200">
                          {Number(stock) === 1 ? 'Queda 1 ud' : `Quedan ${Number(stock)} uds`}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-stone-500 flex-wrap">
                      <span className="uppercase tracking-wider">{categoryLabel(category)}</span>
                      <span>·</span>
                      <span className="truncate">{selectedStoreName}</span>
                      <span>·</span>
                      {Number(stock) > 0 && Number(stock) < 5 ? (
                        <span className="font-mono text-amber-800 font-semibold">
                          Poco stock ({stock || 0} disp.)
                        </span>
                      ) : (
                        <span className="font-mono">{stock || 0} disp.</span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-stone-900 leading-snug">
                      {finalProductName || 'Nombre de tu producto real'}
                    </h4>
                    <p className="text-xs text-stone-600 line-clamp-2">
                      {description.trim() || 'Disponible fresco en tu pulpería local.'}
                    </p>
                    <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                      <span className="text-sm font-semibold font-mono text-stone-900">
                        {formatPrice(Number(price) || 0)}
                      </span>
                      <span className="px-3 py-1 text-[11px] font-medium text-white bg-stone-900 rounded-md">
                        + Agregar
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2 border-t border-stone-200">
                <button
                  type="submit"
                  disabled={submitting || processingImage}
                  className="w-full py-2.5 px-4 text-xs font-medium text-white bg-amber-800 rounded-lg hover:bg-amber-900 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {submitting
                      ? 'Guardando en catálogo...'
                      : editingProduct
                      ? 'Guardar cambios del producto'
                      : 'Publicar producto real ahora'}
                  </span>
                </button>

                <div className="flex items-center justify-between gap-2">
                  {editingProduct && (
                    <>
                      {confirmDelete ? (
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={submitting}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-red-700 rounded-lg hover:bg-red-800"
                        >
                          Confirmar eliminación
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          className="px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-lg inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Eliminar producto
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="ml-auto px-3 py-1.5 text-xs font-medium text-stone-600 hover:text-stone-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
