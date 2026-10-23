const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function montar(hash = '') {
  const estados = [];
  const efectos = [];
  let evento;
  let consultas = 0;
  let dentroDelCallback = false;
  const sesion = { user: { id: 'prueba' } };
  const supabase = {
    auth: {
      onAuthStateChange(callback) {
        evento = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => ({ error: null }),
    },
    from() {
      assert.equal(dentroDelCallback, false, 'consulta dentro del callback de Auth');
      consultas++;
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'Sin perfil' } }) }) }) };
    },
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useContext() {},
    useEffect: (callback) => efectos.push(callback),
    useState(inicial) {
      const indice = estados.length;
      estados.push(inicial);
      return [inicial, (valor) => { estados[indice] = valor; }];
    },
  };
  const fuente = fs.readFileSync(path.join(__dirname, '../client/src/lib/AuthContext.tsx'), 'utf8');
  const compilado = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const contexto = {
    exports: {}, window: { location: { hash } }, URLSearchParams, setTimeout, clearTimeout,
    console: { error() {} },
    require(nombre) {
      if (nombre === 'react') return react;
      if (nombre === 'react/jsx-runtime') return { jsx: (tipo, props) => ({ tipo, props }) };
      if (nombre === './supabaseClient') return { supabase };
      throw new Error(nombre);
    },
  };
  vm.runInNewContext(compilado, contexto);
  contexto.exports.AuthProvider({ children: null });
  const limpiar = efectos[0]();
  return {
    estados, limpiar,
    consultas: () => consultas,
    emitir(tipo, session = sesion) {
      dentroDelCallback = true;
      try { assert.equal(evento(tipo, session), undefined); }
      finally { dentroDelCallback = false; }
    },
  };
}

test('recuperación muestra el formulario aunque no exista perfil', async () => {
  const app = montar();
  app.emitir('PASSWORD_RECOVERY');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.estados[4], true);
  assert.equal(app.estados[3], false);
  assert.equal(app.consultas(), 0);
  app.emitir('SIGNED_OUT', null);
  assert.equal(app.estados[4], false);
  app.limpiar();
});

test('detecta recuperación en la dirección incluso con INITIAL_SESSION', async () => {
  const app = montar('#access_token=token-de-prueba&type=recovery');
  app.emitir('INITIAL_SESSION');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.estados[4], true);
  assert.equal(app.consultas(), 0);
  app.limpiar();
});

test('el ingreso normal consulta el perfil fuera del callback de Auth', async () => {
  const app = montar();
  app.emitir('SIGNED_IN');
  assert.equal(app.consultas(), 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.consultas(), 1);
  assert.equal(app.estados[4], false);
  app.limpiar();
});
