import React, { useState } from 'react';
import { X, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { User } from '../types';
import { api, setSessionToken } from '../utils/format';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: User) => void;
  onNotify: (message: string, isError?: boolean) => void;
}

export function AuthModal({
  isOpen,
  onClose,
  onAuthenticated,
  onNotify,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [rol, setRol] = useState<'cliente' | 'negocio'>('cliente');

  if (!isOpen) return null;

  const saveUserBackup = (user: User) => {
    try {
      localStorage.setItem('pulperia_saved_user', JSON.stringify(user));
    } catch {
      // ignore if restricted
    }
  };

  const handleQuickDemo = async (demoEmail: string, demoRole: 'cliente' | 'negocio') => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await api<{ user: User; sessionToken?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: demoEmail,
          password: 'pulperia1234',
          rol: demoRole,
        }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      saveUserBackup(res.user);
      onAuthenticated(res.user);
      onNotify(`Bienvenido, ${res.user.name}`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message);
      onNotify(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Escribe tu correo electrónico para continuar.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const defaultName = nombre.trim() || cleanEmail.split('@')[0] || 'Usuario';
      const res = await api<{ user: User; sessionToken?: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          nombre: defaultName,
          email: cleanEmail,
          telefono: telefono.trim() || '8888-5544',
          password: password || 'pulperia1234',
          rol,
        }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      saveUserBackup(res.user);
      onAuthenticated(res.user);
      onNotify(`Sesión activa: ${res.user.name}`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-stone-200 rounded-xl max-w-md w-full p-6 space-y-5 shadow-xl my-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-stone-500">Acceso directo · Pulpería Nicaragua</div>
            <h2 className="text-xl font-semibold text-stone-900">
              {mode === 'login' ? 'Entrar a mi cuenta' : 'Registrar mi cuenta'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
            }}
            className={`py-2 text-xs font-medium rounded-md transition-colors ${
              mode === 'login'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
            }}
            className={`py-2 text-xs font-medium rounded-md transition-colors ${
              mode === 'register'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Registrarme
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2 text-xs text-amber-950">
            <AlertCircle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            <span className="font-medium">{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
          {/* Role selector available in both Login and Register so user always enters the exact panel they want */}
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1.5">
              ¿A qué panel deseas entrar?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRol('cliente')}
                className={`p-2.5 text-xs rounded-lg border text-left transition-colors ${
                  rol === 'cliente'
                    ? 'border-stone-900 bg-stone-900 text-white font-semibold'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                }`}
              >
                <div>Modo Cliente</div>
                <div className="text-[11px] opacity-80 font-normal">Comprar y ver pedidos</div>
              </button>
              <button
                type="button"
                onClick={() => setRol('negocio')}
                className={`p-2.5 text-xs rounded-lg border text-left transition-colors ${
                  rol === 'negocio'
                    ? 'border-amber-800 bg-amber-800 text-white font-semibold'
                    : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                }`}
              >
                <div>Modo Pulpería</div>
                <div className="text-[11px] opacity-80 font-normal">Vender y administrar</div>
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {rol === 'negocio' ? 'Nombre de la pulpería' : 'Tu nombre'}
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder={rol === 'negocio' ? 'Ej. Pulpería San José' : 'Nombre y apellido'}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Teléfono celular
                </label>
                <input
                  type="tel"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="8888-8888"
                  className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">
              Correo electrónico
            </label>
            <input
              type="text"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="normanescobar804@gmail.com"
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">
              Contraseña
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Escribe tu contraseña"
                className="w-full pl-3 pr-9 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-xs font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors cursor-pointer"
          >
            {loading
              ? 'Entrando...'
              : rol === 'negocio'
              ? 'Entrar a Mi Pulpería'
              : 'Entrar como Cliente'}
          </button>
        </form>

        {/* Quick Demo Access */}
        <div className="pt-3 border-t border-stone-200 space-y-2">
          <div className="text-[11px] font-medium text-stone-500">
            O entra en 1 clic sin escribir:
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemo('normanescobar804@gmail.com', 'cliente')}
              className="px-3 py-2 text-xs font-medium text-stone-800 bg-stone-50 border border-stone-200 rounded-lg hover:bg-stone-100 transition-colors text-left"
            >
              <div className="font-semibold">Entrar como Cliente</div>
              <div className="text-[11px] text-stone-500 truncate">Norman Escobar</div>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemo('negocio@pulperia.ni', 'negocio')}
              className="px-3 py-2 text-xs font-medium text-amber-950 bg-amber-50/70 border border-amber-200 rounded-lg hover:bg-amber-100/70 transition-colors text-left"
            >
              <div className="font-semibold">Entrar a Pulpería</div>
              <div className="text-[11px] text-amber-800 truncate">Pulpería La Bendición</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
