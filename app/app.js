/* =====================================================================
   AGUA INMACULADA · APP DE CONTROL · FASE 1
   Planta (ventanilla) + Panel de dueños
   ===================================================================== */
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
const S = {
  session: null, perfil: null, config: {}, productos: [], articulos: [], pi: [],
  clientes: [], perfiles: [], turno: null, cart: {}, pago: 'efectivo', clienteId: null,
  tab: null, modo: null, periodo: null
};
const $app = document.getElementById('app');

/* ---------------- utilidades ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const money = v => (num(v) < 0 ? '−$' : '$') + Math.abs(num(v)).toLocaleString('es-MX', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const money0 = v => (num(v) < 0 ? '−$' : '$') + Math.abs(Math.round(num(v))).toLocaleString('es-MX');
const fmtN = (v, d = 0) => num(v).toLocaleString('es-MX', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = v => (num(v) * 100).toFixed(1) + '%';
const fmtFecha = t => t ? new Date(t).toLocaleString('es-MX', {timeZone: CFG.ZONA, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : '—';
const fmtHora = t => t ? new Date(t).toLocaleTimeString('es-MX', {timeZone: CFG.ZONA, hour: '2-digit', minute: '2-digit'}) : '—';
const fechaMX = (d = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: CFG.ZONA}).format(d); // YYYY-MM-DD
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const inicioMX = s => new Date(s + 'T00:00:00-06:00').toISOString(); // México sin horario de verano
const cfg = k => num(S.config[k]?.valor);
const val = id => document.getElementById(id)?.value?.trim() ?? '';
const nval = id => { const v = val(id); return v === '' ? null : Number(v); };
const chk = id => !!document.getElementById(id)?.checked;

function toast(msg, tipo = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), tipo === 'bad' ? 5000 : 2600);
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'Usuario o contraseña incorrectos';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión a internet. Intenta de nuevo.';
  return m;
}
function modal(html, onMount) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="box">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  onMount && onMount(m.querySelector('.box'), close);
  return close;
}
function confirmar(texto, okTxt = 'Sí, continuar', cancelTxt = 'Cancelar') {
  return new Promise(res => {
    modal(`<h2>Confirmar</h2><p>${texto}</p><div class="row"><button class="btn ghost" data-close>${cancelTxt}</button><span class="sp"></span><button class="btn" id="cf-ok">${okTxt}</button></div>`,
      (box, close) => { box.querySelector('#cf-ok').onclick = () => { close(); res(true); }; box.querySelector('[data-close]').addEventListener('click', () => res(false)); });
  });
}
async function busy(btn, fn) {
  const t = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = 'Guardando…'; }
  try { return await fn(); }
  catch (e) { toast(errMsg(e), 'bad'); console.error(e); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = t; } }
}
async function domicilioPeriodo() {
  const data = await fetchAll(() => sb.from('pedidos').select('id,nombre,marcas,cantidad,entregado_cantidad,monto_cobrado,forma_pago_real,entregado_en,asignado_a')
    .eq('estado', 'entregado').gte('entregado_en', inicioMX(S.periodo.desde)).lt('entregado_en', inicioMX(addDays(S.periodo.hasta, 1))).order('entregado_en', { ascending: false }));
  const t = f => data.filter(p => !f || p.forma_pago_real === f).reduce((x, p) => x + num(p.monto_cobrado), 0);
  return { lista: data, n: data.length, garrafones: data.reduce((x, p) => x + num(p.entregado_cantidad), 0), total: t(), efectivo: t('efectivo'), transferencia: t('transferencia') };
}
async function fetchAll(build) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out = out.concat(data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}

/* fotos: se comprimen antes de subir */
async function comprimir(file, max = 1280) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.75));
}
async function subirFoto(inputId, carpeta) {
  const f = document.getElementById(inputId)?.files?.[0];
  if (!f) return null;
  const blob = f.type.startsWith('image/') ? await comprimir(f) : f;
  const path = `${carpeta}/${fechaMX()}/${S.session.user.id}-${Date.now()}.jpg`;
  const { error } = await sb.storage.from('evidencias').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}
async function verFoto(path, bucket = 'evidencias') {
  if (!path) return;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 600);
  if (error) return toast(errMsg(error), 'bad');
  window.open(data.signedUrl, '_blank');
}
const fotoInput = (id, txt) => `<div class="field"><label>${txt}</label><input type="file" id="${id}" accept="image/*" capture="environment"></div>`;

/* ---------------- arranque y sesión ---------------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) return renderLogin();
  try {
    const { data: perfil, error } = await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) throw error;
    S.perfil = perfil;
    if (!perfil || !perfil.activo) return renderInactivo();
    await cargarCatalogos();
    if (perfil.rol === 'dueno') { S.modo = 'dueno'; S.tab = S.tab || 'resumen'; }
    else if (perfil.rol === 'ventanilla') { S.modo = 'planta'; S.tab = S.tab || 'vender'; }
    else { S.modo = 'repartidor'; }
    await render();
  } catch (e) { $app.innerHTML = `<div class="login"><div class="alert bad">${esc(errMsg(e))}</div><button class="btn" onclick="location.reload()">Reintentar</button></div>`; }
}
async function cargarCatalogos() {
  const [c, p, a, pi, cl] = await Promise.all([
    sb.from('config').select('*'),
    sb.from('productos').select('*').order('orden'),
    sb.from('articulos').select('*').order('tipo').order('nombre'),
    sb.from('producto_insumos').select('*'),
    sb.from('clientes').select('*').eq('activo', true).order('nombre')
  ]);
  for (const r of [c, p, a, pi, cl]) if (r.error) throw r.error;
  S.config = Object.fromEntries(c.data.map(x => [x.clave, x]));
  S.productos = p.data; S.articulos = a.data; S.pi = pi.data; S.clientes = cl.data;
  if (S.perfil?.rol === 'dueno') {
    const { data } = await sb.from('perfiles').select('*').order('nombre');
    S.perfiles = data || [];
  }
}
function renderLogin() {
  $app.innerHTML = `
  <div class="login">
    <img class="logo" src="logo.jpg" alt="Agua Inmaculada">
    <div class="card">
      <h2>Iniciar sesión</h2>
      <form id="f-login">
        <div class="field"><label>Usuario</label><input type="text" id="lg-u" autocomplete="username" autocapitalize="none" placeholder="ej. yara" required></div>
        <div class="field"><label>Contraseña</label><input type="password" id="lg-p" autocomplete="current-password" required></div>
        <button class="btn big" id="lg-b">Entrar</button>
      </form>
    </div>
    <p class="mut small" style="text-align:center">Agua Inmaculada · Real del Valle</p>
  </div>`;
  document.getElementById('f-login').onsubmit = async e => {
    e.preventDefault();
    let u = val('lg-u').toLowerCase(); if (!u.includes('@')) u = `${u}@${CFG.DOMINIO_USUARIOS}`;
    await busy(document.getElementById('lg-b'), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: u, password: document.getElementById('lg-p').value });
      if (error) throw error;
      boot();
    });
  };
}
function renderInactivo() {
  $app.innerHTML = `<div class="login"><img class="logo" src="logo.jpg"><div class="card"><h2>Usuario sin activar</h2>
  <p>Tu usuario ya existe, pero un dueño tiene que activarlo y asignarte un puesto desde el panel.</p>
  <button class="btn ghost" onclick="salir()">Salir</button></div></div>`;
}
async function salir() { await sb.auth.signOut(); S.turno = null; S.tab = null; location.reload(); }

/* ---------------- estructura general ---------------- */
const TABS_PLANTA = [['vender','Vender'],['pedidos','Pedidos'],['prestamos','Préstamos'],['pipa','Pipa'],['compra','Compras y caja'],['bitacora','Bitácora'],['cerrar','Cerrar turno']];
const TABS_DUENO = [['resumen','Resumen'],['pedidosD','Pedidos'],['reparto','Reparto'],['prestamosD','Préstamos'],['turnos','Turnos'],['ventas','Ventas'],['cobrar','Por cobrar'],['inventario','Inventario'],['productos','Productos'],
  ['clientes','Clientes'],['contador','Contador'],['fijos','Gastos fijos'],['mant','Mantenimiento'],['bitacoraD','Bitácora'],
  ['usuarios','Usuarios'],['ajustes','Ajustes'],['planta','Operar planta']];

function shell(tabs, contenido) {
  const rolTxt = {dueno: 'Dueño', ventanilla: 'Ventanilla', repartidor: 'Repartidor'}[S.perfil.rol];
  $app.innerHTML = `
  <div class="top">
    <div class="brand"><img src="icon-192.png" alt=""><span>Agua Inmaculada</span></div>
    <div class="who"><b>${esc(S.perfil.nombre)}</b><br>${rolTxt}${S.turno ? ' · turno ' + fmtHora(S.turno.abierto_en) : ''}</div>
    <button onclick="salir()">Salir</button>
  </div>
  ${tabs ? `<div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-t="${k}">${t}</button>`).join('')}</div>` : ''}
  <main id="main">${contenido || '<div class="empty">Cargando…</div>'}</main>`;
  $app.querySelectorAll('.tab').forEach(b => b.onclick = () => { S.tab = b.dataset.t; render(); });
  return document.getElementById('main');
}

async function render() {
  try {
    if (S.modo === 'repartidor') return renderReparto();
    if (S.modo === 'planta' || (S.modo === 'dueno' && S.tab === 'planta') || S.tab?.startsWith('p_')) return renderPlanta();
    const main = shell(TABS_DUENO);
    const fn = VISTAS_DUENO[S.tab] || VISTAS_DUENO.resumen;
    await fn(main);
  } catch (e) { toast(errMsg(e), 'bad'); console.error(e); }
}

/* =====================================================================
   PLANTA (VENTANILLA)
   ===================================================================== */
async function cargarTurno() {
  const { data, error } = await sb.from('turnos').select('*').eq('usuario_id', S.session.user.id).eq('estado', 'abierto').maybeSingle();
  if (error) throw error;
  S.turno = data;
}

async function renderPlanta() {
  await cargarTurno();
  const esDueno = S.perfil.rol === 'dueno';
  if (!S.turno) {
    const tabs = esDueno ? TABS_DUENO : null;
    if (esDueno) S.tab = 'planta';
    return vistaAbrirTurno(shell(tabs));
  }
  // pestañas internas de planta
  let t = S.tab;
  if (esDueno) {
    if (!t || t === 'planta') t = 'p_vender';
    S.tab = t;
    const tabs = [['resumen','← Panel'], ...TABS_PLANTA.map(([k, n]) => ['p_' + k, n])];
    const main = shell(tabs);
    return VISTAS_PLANTA[t.replace('p_', '')](main);
  }
  if (!VISTAS_PLANTA[t]) t = S.tab = 'vender';
  const main = shell(TABS_PLANTA);
  return VISTAS_PLANTA[t](main);
}

function vistaAbrirTurno(main) {
  const caja = cfg('caja_chica_planta') || 350;
  const unidad = S.config.medidor_unidad?.texto || 'litros';
  const envase = S.articulos.find(a => a.nombre === 'Garrafón nuevo (envase)');
  main.innerHTML = `
  <div class="card" style="max-width:640px;margin:0 auto">
    <h1>Abrir turno</h1>
    <p class="mut">Hora de entrada: <b>${fmtHora(new Date())}</b>. Revisa la caja y el medidor antes de vender.</p>
    <div class="field"><label>Caja chica recibida</label><input type="number" id="at-caja" inputmode="decimal" value="${caja}"></div>
    <label class="chk"><input type="checkbox" id="at-ok" checked> La caja chica está completa (${money(caja)})</label>
    <div class="field"><label>Lectura inicial del medidor de agua (${esc(unidad)})</label><input type="number" id="at-med" inputmode="decimal" placeholder="Número que marca el medidor" required></div>
    ${fotoInput('at-foto', 'Foto del medidor (recomendado)')}
    <div class="field"><label>Garrafones nuevos (envases vacíos) en existencia</label><input type="number" id="at-garr" inputmode="numeric" placeholder="${envase ? 'Sistema: ' + fmtN(envase.existencia) : ''}"></div>
    <div class="field"><label>Notas (opcional)</label><textarea id="at-notas" placeholder="Algo que reportar al iniciar"></textarea></div>
    <button class="btn big" id="at-b">Abrir turno</button>
  </div>`;
  document.getElementById('at-b').onclick = e => busy(e.currentTarget, async () => {
    const med = nval('at-med');
    if (med === null) throw new Error('Escribe la lectura del medidor');
    const ok = chk('at-ok');
    const cajaIni = nval('at-caja') ?? 0;
    if (!ok && !val('at-notas')) throw new Error('Si la caja no está completa, explica en notas qué falta');
    const foto = await subirFoto('at-foto', 'medidor');
    const { error } = await sb.rpc('abrir_turno', { p_tipo: 'planta', p_caja_inicial: cajaIni, p_caja_ok: ok,
      p_medidor_ini: med, p_garrafones_ini: nval('at-garr'), p_foto: foto, p_notas: val('at-notas') || null });
    if (error) throw error;
    toast('Turno abierto', 'ok');
    S.tab = S.perfil.rol === 'dueno' ? 'p_vender' : 'vender';
    render();
  });
}

const VISTAS_PLANTA = {
  /* ---------- VENDER ---------- */
  async vender(main) {
    const prods = S.productos.filter(p => p.activo);
    const clientesEsp = S.clientes.filter(c => c.tipo !== 'domicilio' || c.precio_especial);
    const { data: ult } = await sb.from('ventas').select('id,fecha,total,forma_pago,cancelada,cliente_id').eq('turno_id', S.turno.id).order('fecha', { ascending: false }).limit(200);
    const vivas = (ult || []).filter(v => !v.cancelada);
    const totTurno = vivas.reduce((s, v) => s + num(v.total), 0);
    main.innerHTML = `
    <div class="pos">
      <div>
        <div class="prods" id="prods"></div>
        <div class="card" style="margin-top:16px">
          <div class="row"><h3 style="margin:0">Ventas de este turno</h3><span class="sp"></span><span class="tag inf">${vivas.length} ventas · ${money(totTurno)}</span></div>
          <div class="tw"><table><thead><tr><th>Hora</th><th>Pago</th><th class="n">Total</th></tr></thead><tbody>
          ${(ult || []).slice(0, 15).map(v => `<tr class="click" data-vid="${v.id}" title="Ver ticket"><td>${fmtHora(v.fecha)}</td><td>${v.cancelada ? '<span class="tag bad">Cancelada</span>' : esc(v.forma_pago)}</td><td class="n">${money(v.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Aún no hay ventas</td></tr>'}
          </tbody></table></div>
        </div>
      </div>
      <div class="card" style="position:sticky;top:120px;align-self:start">
        <div id="v-cambio-ult"></div>
        <h2>Venta actual</h2>
        <div class="field"><label>Cliente (solo si tiene precio especial o es a crédito)</label>
          <select id="v-cli"><option value="">Público en general</option>${clientesEsp.map(c => `<option value="${c.id}" ${S.clienteId == c.id ? 'selected' : ''}>${esc(c.nombre)}${c.precio_especial ? ' · ' + money(c.precio_especial) : ''}</option>`).join('')}</select></div>
        <div id="cart"></div>
        <div class="total"><span>Total</span><span id="v-tot">$0.00</span></div>
        <div class="pay" id="pay">
          <button data-p="efectivo">Efectivo</button><button data-p="transferencia">Transferencia</button>
        </div>
        <div id="v-efe" style="margin-top:10px"></div>
        <div id="v-cred" style="margin-top:10px"></div>
        <button class="btn big ok" id="v-cobrar" style="margin-top:14px">Cobrar</button>
        <button class="btn ghost" id="v-limpiar" style="width:100%;margin-top:8px">Limpiar</button>
        <label class="chk small" style="margin:14px 0 0"><input type="checkbox" id="v-tick"> Imprimir ticket en este dispositivo (impresora Bluetooth con RawBT)</label>
      </div>
    </div>`;
    const precioDe = p => {
      const c = S.clientes.find(x => x.id == S.clienteId);
      if (c && c.precio_especial && p.nombre === 'Relleno garrafón') return num(c.precio_especial);
      if (c && c.tipo === 'distribuidor') return num(p.precio_domicilio ?? p.precio);
      return num(p.precio);
    };
    const pintar = () => {
      document.getElementById('prods').innerHTML = prods.map(p => `
        <button class="prod" style="background:${esc(p.color || '#1BA6C9')}" data-id="${p.id}">
          ${S.cart[p.id] ? `<span class="q">${S.cart[p.id]}</span>` : ''}
          <span class="n">${esc(p.nombre)}</span><span class="p">${money0(precioDe(p))}</span>
        </button>`).join('');
      const lines = prods.filter(p => S.cart[p.id]);
      document.getElementById('cart').innerHTML = lines.length ? lines.map(p => `
        <div class="cart-line"><span class="n">${esc(p.nombre)}<br><span class="mut small">${money(precioDe(p))} c/u</span></span>
        <button class="qb" data-m="${p.id}">−</button><b style="min-width:28px;text-align:center">${S.cart[p.id]}</b><button class="qb" data-a="${p.id}">+</button></div>`).join('')
        : '<div class="empty">Toca un producto para agregarlo</div>';
      const total = lines.reduce((s, p) => s + precioDe(p) * S.cart[p.id], 0);
      document.getElementById('v-tot').textContent = money(total);
      const efe = document.getElementById('v-efe');
      if (S.pago === 'efectivo' && total > 0) {
        efe.innerHTML = `<label class="small" style="font-weight:700">Paga con</label>
          <div class="row" style="flex-wrap:wrap;gap:6px;margin:6px 0">${[['Exacto', total], ...[20, 50, 100, 200, 500].filter(b => b >= total).map(b => ['$' + b, b])].map(([t, v]) => `<button class="btn sm sec v-bill" data-v="${v}">${t}</button>`).join('')}</div>
          <input type="number" id="v-paga" inputmode="decimal" placeholder="Otro monto" value="${S.pagaCon ?? ''}" style="width:100%">
          <div id="v-camb" style="margin-top:8px;font-size:20px;font-weight:800"></div>`;
        const camb = () => {
          const pc = S.pagaCon, el = document.getElementById('v-camb');
          if (pc == null || pc === '') { el.innerHTML = ''; return; }
          const d = num(pc) - total;
          el.innerHTML = d >= 0 ? `<span style="color:var(--ok,#2E7D5B)">Cambio: ${money(d)}</span>` : `<span style="color:var(--bad,#C62828)">Faltan: ${money(-d)}</span>`;
        };
        efe.querySelectorAll('.v-bill').forEach(b => b.onclick = () => { S.pagaCon = Number(b.dataset.v); document.getElementById('v-paga').value = S.pagaCon; camb(); });
        document.getElementById('v-paga').oninput = e => { S.pagaCon = e.target.value === '' ? null : num(e.target.value); camb(); };
        camb();
      } else efe.innerHTML = '';
      const uc = document.getElementById('v-cambio-ult');
      uc.innerHTML = S.ultimoCambio != null && !lines.length ? `<div class="alert inf" style="margin-bottom:12px;font-size:18px">Última venta · Pagó con ${money(S.ultimoCambio.paga)} · <b>Cambio ${money(S.ultimoCambio.cambio)}</b></div>` : '';
      document.querySelectorAll('#pay button').forEach(b => b.classList.toggle('on', b.dataset.p === S.pago));
      const c = S.clientes.find(x => x.id == S.clienteId);
      document.getElementById('v-cred').innerHTML = c && (c.tipo === 'empresa' || c.tipo === 'restaurante')
        ? `<label class="chk"><input type="checkbox" id="v-credito" ${S.pago === 'credito' ? 'checked' : ''}> A crédito (se cobra después por transferencia)</label>` : '';
      const vc = document.getElementById('v-credito');
      if (vc) vc.onchange = () => { S.pago = vc.checked ? 'credito' : 'efectivo'; pintar(); };
      document.querySelectorAll('.prod').forEach(b => b.onclick = () => { S.ultimoCambio = null; S.cart[b.dataset.id] = (S.cart[b.dataset.id] || 0) + 1; pintar(); });
      document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { S.cart[b.dataset.a]++; pintar(); });
      document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { if (--S.cart[b.dataset.m] <= 0) delete S.cart[b.dataset.m]; pintar(); });
    };
    document.querySelectorAll('#pay button').forEach(b => b.onclick = () => { S.pago = b.dataset.p; pintar(); });
    document.getElementById('v-cli').onchange = e => { S.clienteId = e.target.value || null; if (!S.clienteId && S.pago === 'credito') S.pago = 'efectivo'; pintar(); };
    document.getElementById('v-limpiar').onclick = () => { S.cart = {}; S.clienteId = null; S.pago = 'efectivo'; S.pagaCon = null; S.ultimoCambio = null; VISTAS_PLANTA.vender(main); };
    const pedirFirma = c => new Promise(res => {
      const sug = c.quien_recibe && c.quien_recibe.toLowerCase() !== 'encargado' ? c.quien_recibe : '';
      modal(`<h2>Firma de recibido</h2><p class="mut">${esc(c.nombre)} · a crédito · <b>${document.getElementById('v-tot').textContent}</b></p>
        <div class="field"><label>Nombre de quien recoge</label><input type="text" id="fv-n" value="${esc(sug)}"></div>
        ${padFirma('fv-f')}
        <div class="row"><button class="btn ghost" id="fv-x">Cancelar</button><span class="sp"></span><button class="btn ok" id="fv-ok">Firmar y registrar</button></div>`, (box, close) => {
        const f = activarFirma('fv-f');
        box.parentElement.addEventListener('click', ev => { if (ev.target === box.parentElement) res(null); });
        box.querySelector('#fv-x').onclick = () => { close(); res(null); };
        box.querySelector('#fv-ok').onclick = ev => busy(ev.currentTarget, async () => {
          const n = box.querySelector('#fv-n').value.trim(); if (!n) throw new Error('Escribe el nombre de quien recoge');
          if (f.vacia()) throw new Error('Falta la firma');
          const path = await f.subir('ventas'); close(); res({ recibio: n, firma: path });
        });
      });
    });
    document.getElementById('v-cobrar').onclick = e => busy(e.currentTarget, async () => {
      const items = Object.entries(S.cart).filter(([, q]) => q > 0).map(([id, q]) => ({ producto_id: Number(id), cantidad: q }));
      if (!items.length) throw new Error('Agrega al menos un producto');
      let firmaV = null;
      if (S.pago === 'credito') {
        firmaV = await pedirFirma(S.clientes.find(c => c.id == S.clienteId) || {});
        if (!firmaV) return;
      }
      const totalV = prods.filter(p => S.cart[p.id]).reduce((s, p) => s + precioDe(p) * S.cart[p.id], 0);
      const pagaCon = S.pago === 'efectivo' && S.pagaCon != null ? num(S.pagaCon) : null;
      if (pagaCon != null && pagaCon < totalV) throw new Error('Con lo que paga no alcanza: faltan ' + money(totalV - pagaCon));
      const { data: ventaId, error } = await sb.rpc('registrar_venta', { p_turno_id: S.turno.id, p_forma_pago: S.pago, p_items: items,
        p_cliente_id: S.clienteId ? Number(S.clienteId) : null, p_canal: S.clienteId && S.clientes.find(c => c.id == S.clienteId)?.tipo === 'empresa' ? 'empresa' : 'planta' });
      if (error) throw error;
      if (firmaV) {
        const { error: ef } = await sb.rpc('firmar_venta', { p_venta_id: ventaId, p_recibio: firmaV.recibio, p_firma: firmaV.firma });
        if (ef) { toast('La venta quedó guardada, pero la firma no: ' + errMsg(ef), 'bad'); firmaV = null; }
      }
      toast('Venta registrada · ' + document.getElementById('v-tot').textContent, 'ok');
      S.cart = {}; S.clienteId = null; S.pago = 'efectivo'; S.pagaCon = null;
      S.ultimoCambio = pagaCon != null ? { paga: pagaCon, cambio: pagaCon - totalV } : null;
      await VISTAS_PLANTA.vender(main);
      await mostrarTicket(ventaId, true);
      if (firmaV) mostrarNotaVenta(ventaId).catch(err => toast('No se pudo armar la nota: ' + errMsg(err), 'bad'));
    });
    const ti = document.getElementById('v-tick');
    ti.checked = impresionActiva();
    ti.onchange = () => { try { localStorage.setItem('ai_imprimir', ti.checked ? '1' : '0'); } catch {} };
    main.querySelectorAll('tr[data-vid]').forEach(tr => tr.onclick = () => mostrarTicket(Number(tr.dataset.vid), false));
    pintar();
  },

  /* ---------- PIPA ---------- */
  async pipa(main) {
    const [{ data: pipas }, deuda] = await Promise.all([
      sb.from('pipas').select('*').order('fecha', { ascending: false }).limit(10),
      sb.rpc('pipas_por_pagar')]);
    const dueno = S.perfil.rol === 'dueno';
    const porPagar = deuda.error ? null : (deuda.data || []);
    main.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <h2>Registrar entrada de pipa</h2>
        <div class="field"><label>Litros</label><input type="number" id="pp-l" inputmode="numeric" value="${cfg('litros_pipa') || 10000}"></div>
        <div class="field"><label>Costo (pesos)</label><input type="number" id="pp-c" inputmode="decimal" value="${cfg('costo_pipa') || 1700}"></div>
        <div class="field"><label>¿Cómo se paga?</label><select id="pp-pg">
          <option value="">Elige una opción…</option>
          <option value="caja">Pagada ahora con dinero del cajón</option>
          <option value="sobre">Pagada ahora del sobre / por el dueño</option>
          <option value="credito">A crédito (se paga después)</option></select>
          <span class="mut small">Solo lo que sale del cajón se descuenta en el corte del turno.</span></div>
        <div class="field"><label>Proveedor</label><input type="text" id="pp-pr"></div>
        ${fotoInput('pp-f', 'Foto de la nota (opcional)')}
        <div class="field"><label>Notas</label><input type="text" id="pp-n"></div>
        <button class="btn big" id="pp-b">Guardar pipa</button>
      </div>
      <div>
        <div class="card"><h2>Pipas por pagar</h2>
          ${porPagar === null ? '<div class="alert warn">Falta activar el control de crédito en la base de datos.</div>'
          : porPagar.length ? `<table><thead><tr><th>Fecha</th><th class="n">Costo</th><th class="n">Debe</th><th></th></tr></thead><tbody>
            ${porPagar.map(p => `<tr><td>${fmtFecha(p.fecha)}${p.proveedor ? `<br><span class="mut small">${esc(p.proveedor)}</span>` : ''}</td><td class="n">${money(p.costo)}</td><td class="n"><b>${money(p.saldo)}</b></td>
              <td><button class="btn sm pp-ab" data-id="${p.id}">Abonar</button></td></tr>`).join('')}</tbody></table>
            <p class="mut small">Total por pagar: <b>${money(porPagar.reduce((x, p) => x + num(p.saldo), 0))}</b></p>`
          : '<div class="empty">No se debe ninguna pipa</div>'}
        </div>
        <div class="card" style="margin-top:16px"><h2>Últimas pipas</h2>
          <table><thead><tr><th>Fecha</th><th class="n">Litros</th><th class="n">Costo</th>${dueno ? '<th></th>' : ''}</tr></thead><tbody>
          ${(pipas || []).map(p => `<tr><td>${fmtFecha(p.fecha)}${p.credito ? ' <span class="tag inf">Crédito</span>' : ''}</td><td class="n">${fmtN(p.litros)}</td><td class="n">${money(p.costo)}</td>
            ${dueno ? `<td>${p.credito || porPagar === null ? '' : `<button class="btn sm ghost pp-cr" data-id="${p.id}">Pasar a crédito</button>`}</td>` : ''}</tr>`).join('') || '<tr><td colspan="4" class="empty">Sin registros</td></tr>'}
          </tbody></table></div>
      </div>
    </div>`;
    const reload = () => VISTAS_PLANTA.pipa(main);
    document.getElementById('pp-b').onclick = e => busy(e.currentTarget, async () => {
      const l = nval('pp-l'), c = nval('pp-c'), pg = val('pp-pg');
      if (!l || l <= 0) throw new Error('Escribe los litros');
      if (c === null) throw new Error('Escribe el costo');
      if (!pg) throw new Error('Elige cómo se paga la pipa');
      const foto = await subirFoto('pp-f', 'pipas');
      const { data: np, error } = await sb.from('pipas').insert({ litros: l, costo: c, proveedor: val('pp-pr') || null, turno_id: S.turno.id, foto, notas: val('pp-n') || null,
        usuario_id: S.session.user.id, credito: pg === 'credito' }).select('id').single();
      if (error) throw error;
      if (pg !== 'credito' && c > 0) {
        const { error: e2 } = await sb.rpc('abonar_pipa', { p_pipa_id: np.id, p_monto: c, p_origen: pg, p_turno_id: S.turno.id, p_notas: 'Pago completo al recibir' });
        if (e2) throw e2;
      }
      toast(pg === 'credito' ? 'Pipa registrada a crédito' : 'Pipa registrada y pagada', 'ok'); reload();
    });
    main.querySelectorAll('.pp-ab').forEach(b => b.onclick = () => {
      const p = porPagar.find(x => x.id == b.dataset.id);
      modal(`<h2>Abonar a la pipa del ${fmtFecha(p.fecha)}</h2>
        <p class="mut">Costo ${money(p.costo)} · ya pagado ${money(p.pagado)} · <b>debe ${money(p.saldo)}</b></p>
        <div class="field"><label>Monto del abono</label><input type="number" id="ab-m" inputmode="decimal" value="${num(p.saldo)}"></div>
        <div class="field"><label>¿De dónde sale el dinero?</label><select id="ab-o"><option value="">Elige…</option>
          <option value="caja">Del cajón de este turno (se descuenta en el corte)</option>
          <option value="sobre">Del sobre / lo pagó el dueño (no afecta el corte)</option></select></div>
        <div class="field"><label>Notas</label><input type="text" id="ab-n" placeholder="ej. pagado el 2 de noviembre"></div>
        <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="ab-b">Guardar abono</button></div>`,
        (box, close) => box.querySelector('#ab-b').onclick = e => busy(e.currentTarget, async () => {
          const m = nval('ab-m'), o = val('ab-o');
          if (!m || m <= 0) throw new Error('Escribe el monto');
          if (!o) throw new Error('Elige de dónde sale el dinero');
          const { error } = await sb.rpc('abonar_pipa', { p_pipa_id: p.id, p_monto: m, p_origen: o, p_turno_id: S.turno?.id || null, p_notas: val('ab-n') || null });
          if (error) throw error; close(); toast('Abono guardado', 'ok'); reload();
        }));
    });
    main.querySelectorAll('.pp-cr').forEach(b => b.onclick = () => busy(b, async () => {
      if (!(await confirmar('¿Marcar esta pipa como a crédito? Después podrás registrarle abonos.', 'Sí, a crédito'))) return;
      const { error } = await sb.from('pipas').update({ credito: true }).eq('id', Number(b.dataset.id));
      if (error) throw error; toast('Pipa pasada a crédito', 'ok'); reload();
    }));
  },

  /* ---------- COMPRAS Y SALIDAS DE CAJA ---------- */
  async compra(main) {
    const { data: gs } = await sb.from('gastos').select('*').eq('turno_id', S.turno.id).order('fecha', { ascending: false });
    const arts = S.articulos.filter(a => a.tipo !== 'equipo' && a.activo);
    main.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <h2>Registrar compra o salida de caja</h2>
        <div class="field"><label>Tipo</label><select id="g-cat">
          <option value="insumo">Insumos (tapas, liners, sellos)</option><option value="limpieza">Limpieza</option>
          <option value="sanitizacion">Sanitización (Henko u otros)</option><option value="garrafon">Garrafones nuevos</option>
          <option value="hielo">Hielo</option><option value="mantenimiento">Mantenimiento</option><option value="otro">Otro gasto</option></select></div>
        <div class="field" id="g-art-w"><label>Artículo de inventario</label><select id="g-art"><option value="">— Ninguno —</option>${arts.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></div>
        <div class="field"><label>Descripción</label><input type="text" id="g-d" placeholder="ej. Bolsa de 1,000 tapas"></div>
        <div class="grid g2">
          <div class="field"><label>Cantidad (piezas)</label><input type="number" id="g-q" inputmode="decimal"></div>
          <div class="field"><label>Monto total (pesos)</label><input type="number" id="g-m" inputmode="decimal"></div>
        </div>
        <div class="field"><label>Proveedor</label><input type="text" id="g-p"></div>
        <label class="chk"><input type="checkbox" id="g-caja"> Se pagó con dinero de la caja</label>
        <label class="chk"><input type="checkbox" id="g-fac"> Tiene factura</label>
        ${fotoInput('g-f', 'Foto del ticket o factura')}
        <button class="btn big" id="g-b">Guardar</button>
      </div>
      <div class="card"><h2>Registrado en este turno</h2>
        <table><thead><tr><th>Concepto</th><th>Caja</th><th class="n">Monto</th></tr></thead><tbody>
        ${(gs || []).map(g => `<tr><td>${esc(g.descripcion)}<br><span class="mut small">${esc(g.categoria)}${g.cantidad ? ' · ' + fmtN(g.cantidad) + ' pzas' : ''}</span></td><td>${g.pagado_de_caja ? '<span class="tag warn">Sí</span>' : '—'}</td><td class="n">${money(g.monto)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sin registros</td></tr>'}
        </tbody></table>
        <p class="mut small">Lo pagado con la caja se descuenta en el arqueo al cerrar el turno.</p></div>
    </div>`;
    document.getElementById('g-b').onclick = e => busy(e.currentTarget, async () => {
      const d = val('g-d'), m = nval('g-m');
      if (!d) throw new Error('Escribe la descripción');
      if (m === null || m < 0) throw new Error('Escribe el monto');
      const art = val('g-art') ? Number(val('g-art')) : null;
      const q = nval('g-q');
      if (art && !q) throw new Error('Si eliges un artículo, escribe la cantidad de piezas');
      const foto = await subirFoto('g-f', 'tickets');
      const { error } = await sb.from('gastos').insert({ categoria: val('g-cat'), articulo_id: art, descripcion: d, cantidad: q, monto: m,
        proveedor: val('g-p') || null, con_factura: chk('g-fac'), pagado_de_caja: chk('g-caja'), turno_id: S.turno.id, foto, usuario_id: S.session.user.id });
      if (error) throw error;
      toast('Guardado', 'ok'); await cargarCatalogos(); VISTAS_PLANTA.compra(main);
    });
  },

  /* ---------- BITÁCORA ---------- */
  async bitacora(main) {
    const { data: bs } = await sb.from('bitacora').select('*').order('fecha', { ascending: false }).limit(15);
    main.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <h2>Registrar en bitácora</h2>
        <div class="field"><label>Tipo</label><select id="b-t">
          <option value="sanitaria">Limpieza / sanitización</option><option value="merma_garrafon">Garrafón dañado o rechazado</option>
          <option value="mantenimiento">Mantenimiento del equipo</option><option value="incidencia">Incidencia (fuga, falla, queja)</option></select></div>
        <div class="field"><label>¿Qué se hizo o qué pasó?</label><input type="text" id="b-a" placeholder="ej. Lavado de tinaco, garrafón roto"></div>
        <div class="field"><label>Cantidad (si aplica)</label><input type="number" id="b-q" inputmode="numeric"></div>
        ${fotoInput('b-f', 'Foto (opcional)')}
        <div class="field"><label>Notas</label><textarea id="b-n"></textarea></div>
        <button class="btn big" id="b-b">Guardar</button>
      </div>
      <div class="card"><h2>Últimos registros</h2>
        <table><thead><tr><th>Fecha</th><th>Registro</th></tr></thead><tbody>
        ${(bs || []).map(b => `<tr><td>${fmtFecha(b.fecha)}</td><td><b>${esc(b.actividad)}</b>${b.cantidad ? ' · ' + fmtN(b.cantidad) : ''}<br><span class="mut small">${esc(b.tipo)}</span></td></tr>`).join('') || '<tr><td colspan="2" class="empty">Sin registros</td></tr>'}
        </tbody></table></div>
    </div>`;
    document.getElementById('b-b').onclick = e => busy(e.currentTarget, async () => {
      if (!val('b-a')) throw new Error('Describe la actividad');
      const foto = await subirFoto('b-f', 'bitacora');
      const { error } = await sb.from('bitacora').insert({ tipo: val('b-t'), actividad: val('b-a'), cantidad: nval('b-q'), foto, notas: val('b-n') || null, usuario_id: S.session.user.id });
      if (error) throw error;
      toast('Guardado', 'ok'); VISTAS_PLANTA.bitacora(main);
    });
  },

  /* ---------- CERRAR TURNO ---------- */
  async cerrar(main) {
    const unidad = S.config.medidor_unidad?.texto || 'litros';
    main.innerHTML = `
    <div class="card" style="max-width:640px;margin:0 auto">
      <h1>Cerrar turno</h1>
      <p class="mut">Abriste a las <b>${fmtHora(S.turno.abierto_en)}</b> con ${money(S.turno.caja_inicial)} de caja chica y el medidor en <b>${fmtN(S.turno.medidor_inicial, 1)}</b>.</p>
      <div class="field"><label>Lectura final del medidor (${esc(unidad)})</label><input type="number" id="ct-med" inputmode="decimal"></div>
      ${fotoInput('ct-fm', 'Foto del medidor')}
      <div class="field"><label>Garrafones nuevos (envases) que quedan</label><input type="number" id="ct-garr" inputmode="numeric"></div>
      <div class="field"><label>Efectivo total en caja, contando la caja chica</label><input type="number" id="ct-ef" inputmode="decimal" placeholder="Cuenta todo el dinero de la caja"></div>
      ${fotoInput('ct-fc', S.perfil.rol === 'dueno' ? 'Foto del dinero contado (opcional)' : 'Foto del dinero contado (obligatoria)')}
      <div class="field"><label>Notas de cierre</label><textarea id="ct-n"></textarea></div>
      <button class="btn big bad" id="ct-b">Cerrar turno y hacer arqueo</button>
    </div>`;
    document.getElementById('ct-b').onclick = e => busy(e.currentTarget, async () => {
      const med = nval('ct-med'), ef = nval('ct-ef');
      if (med === null) throw new Error('Escribe la lectura final del medidor');
      if (ef === null) throw new Error('Escribe el efectivo contado');
      if (S.perfil.rol !== 'dueno' && !document.getElementById('ct-fc')?.files?.length) throw new Error('Toma la foto del dinero contado');
      if (med < num(S.turno.medidor_inicial)) throw new Error('La lectura final no puede ser menor a la inicial');
      // Revisión de caja: primero cuentan a ciegas; antes de cerrar se les dice si falta o sobra.
      const [vr, gr] = await Promise.all([
        sb.from('ventas').select('total').eq('turno_id', S.turno.id).eq('forma_pago', 'efectivo').eq('cancelada', false),
        sb.from('gastos').select('monto').eq('turno_id', S.turno.id).eq('pagado_de_caja', true)]);
      if (vr.error) throw vr.error; if (gr.error) throw gr.error;
      const esperado = num(S.turno.caja_inicial) + vr.data.reduce((x, v) => x + num(v.total), 0) - gr.data.reduce((x, g) => x + num(g.monto), 0);
      const dif = Math.round((ef - esperado) * 100) / 100;
      if (S.primerConteo?.turno !== S.turno.id) S.primerConteo = { turno: S.turno.id, ef };
      const primero = S.primerConteo.ef;
      // Solo se avisa si falta dinero; si cuadra o sobra, se les dice que el corte está bien (el sobrante lo ve el dueño).
      if (dif < 0) {
        const seguir = await confirmar(`Te <b>faltan ${money(-dif)}</b> en caja.<br><br>Vuelve a contar o repón la diferencia y corrige el efectivo. Si ya revisaste, puedes cerrar así.`, 'Cerrar así', 'Volver a contar');
        if (!seguir) { const i = document.getElementById('ct-ef'); i.focus(); i.select(); return; }
      } else if (!(await confirmar('✓ <b>Tu corte está bien.</b> ¿Cerrar el turno? Después ya no podrás registrar ventas en él.', 'Sí, cerrar'))) return;
      let notas = val('ct-n') || '';
      if (primero !== ef) notas = (notas ? notas + ' · ' : '') + `Primer conteo: ${money(primero)} (diferencia ${money(primero - esperado)})`;
      const fm = await subirFoto('ct-fm', 'medidor'), fc = await subirFoto('ct-fc', 'caja');
      const { data: r, error } = await sb.rpc('cerrar_turno', { p_turno_id: S.turno.id, p_medidor_fin: med, p_garrafones_fin: nval('ct-garr'),
        p_efectivo_contado: ef, p_foto_medidor: fm, p_foto_caja: fc, p_notas: notas || null });
      if (error) throw error;
      const abierto = S.turno.abierto_en; S.turno = null; S.primerConteo = null;
      mostrarArqueo(main, { ...r, _abierto: abierto });
    });
  }
};

/* ---------- FACTURAS DEL SAT (XML CFDI) ---------- */
function leerCFDI(texto) {
  const x = new DOMParser().parseFromString(texto, 'application/xml');
  if (x.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido');
  const uno = n => x.getElementsByTagNameNS('*', n)[0];
  const c = uno('Comprobante'), r = uno('Receptor'), t = uno('TimbreFiscalDigital');
  if (!c || !r) throw new Error('No parece una factura del SAT (CFDI)');
  return {
    tipo: c.getAttribute('TipoDeComprobante'), serie: c.getAttribute('Serie') || '', folio: c.getAttribute('Folio') || '',
    fecha: c.getAttribute('Fecha'), total: num(c.getAttribute('Total')), rfc: (r.getAttribute('Rfc') || '').toUpperCase(),
    nombre: r.getAttribute('Nombre') || '', uuid: t?.getAttribute('UUID') || ''
  };
}
// Elige las notas que suman el total: primero las más viejas en orden; si no, busca una combinación exacta.
function notasQueSuman(ventas, total) {
  const T = Math.round(total * 100);
  let acc = 0; for (let i = 0; i < ventas.length; i++) { acc += Math.round(num(ventas[i].total) * 100); if (Math.abs(acc - T) <= 50) return ventas.slice(0, i + 1).map(v => v.id); if (acc > T + 50) break; }
  const vals = ventas.map(v => Math.round(num(v.total))), W = Math.round(total);
  if (ventas.length > 120 || W > 200000 || ventas.some(v => Math.abs(num(v.total) - Math.round(num(v.total))) > 0.001) || Math.abs(total - W) > 0.001) return null;
  const prev = new Int32Array(W + 1).fill(-2); prev[0] = -1; const de = new Int32Array(W + 1);
  for (let i = 0; i < vals.length; i++) for (let w = W; w >= vals[i]; w--) if (prev[w] === -2 && prev[w - vals[i]] !== -2 && de[w - vals[i]] !== i + 1) { prev[w] = i; de[w] = i + 1; }
  if (prev[W] === -2) return null;
  const ids = []; let w = W; while (w > 0) { const i = prev[w]; ids.push(ventas[i].id); w -= vals[i]; }
  return ids;
}
async function facturaXML(texto, nombreArchivo) {
  const f = leerCFDI(texto);
  if (f.tipo && f.tipo !== 'I') throw new Error('Es un comprobante de tipo ' + f.tipo + ', no una factura de ingreso');
  const folioTxt = [`${f.serie}${f.folio}`.trim(), f.uuid].filter(Boolean).join(' · ');
  const clis = S.clientes.filter(c => (c.rfc || '').toUpperCase() === f.rfc);
  if (!clis.length) throw new Error(`Ninguna empresa tiene el RFC ${f.rfc} (${f.nombre}). Captúralo en Clientes y vuelve a subir la factura.`);
  if (f.uuid) {
    const { data: ya } = await sb.from('ventas').select('id').ilike('folio_factura', '%' + f.uuid + '%').limit(1);
    if (ya && ya.length) throw new Error(`La factura ${folioTxt} ya estaba registrada`);
  }
  const { data: vs, error } = await sb.from('ventas').select('id,fecha,total,forma_pago,cliente_id').in('cliente_id', clis.map(c => c.id))
    .eq('facturada', false).eq('cancelada', false).lte('fecha', f.fecha ? new Date(new Date(f.fecha).getTime() + 864e5).toISOString() : new Date().toISOString()).order('fecha');
  if (error) throw error;
  const sel = new Set(notasQueSuman(vs || [], f.total) || []);
  const exacto = sel.size > 0;
  await new Promise(res => modal(`<h2>Factura ${esc(folioTxt || nombreArchivo)}</h2>
    <p><b>${esc(clis.map(c => c.nombre).join(', '))}</b> · ${esc(f.rfc)}<br><span class="mut small">${esc(f.nombre)} · ${f.fecha ? fmtFecha(f.fecha) : ''}</span></p>
    <div class="total"><span>Total facturado</span><span>${money(f.total)}</span></div>
    ${exacto ? '<div class="alert ok">Encontré las notas que suman exacto el total. Revisa y confirma.</div>'
             : `<div class="alert warn">${(vs || []).length ? 'Ninguna combinación de notas da el total exacto. Palomea a mano las que cubre esta factura.' : 'Esta empresa no tiene notas pendientes de facturar.'}</div>`}
    <div class="tw" style="max-height:300px;overflow:auto"><table><tbody>
      ${(vs || []).map(v => `<tr><td><label class="chk" style="margin:0"><input type="checkbox" data-fv="${v.id}" ${sel.has(v.id) ? 'checked' : ''}> ${fmtFecha(v.fecha)}</label></td><td class="mut small">Nota #${v.id} · ${esc(v.forma_pago)}</td><td class="n">${money(v.total)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="total"><span>Notas seleccionadas</span><span id="fx-s"></span></div>
    <div class="row"><button class="btn ghost" id="fx-x">Cancelar</button><span class="sp"></span><button class="btn ok" id="fx-ok">Marcar como facturadas</button></div>`, (box, close) => {
    const marcadas = () => [...box.querySelectorAll('[data-fv]:checked')].map(i => Number(i.dataset.fv));
    const suma = () => marcadas().reduce((x, id) => x + num(vs.find(v => v.id === id).total), 0);
    const pinta = () => { const sm = suma(), d = sm - f.total; box.querySelector('#fx-s').innerHTML = `${money(sm)}${Math.abs(d) < 0.5 ? ' ✓' : ` <span style="color:var(--bad)">(${d > 0 ? '+' : ''}${money(d)})</span>`}`; };
    box.querySelectorAll('[data-fv]').forEach(i => i.onchange = pinta); pinta();
    box.parentElement.addEventListener('click', ev => { if (ev.target === box.parentElement) res(); });
    box.querySelector('#fx-x').onclick = () => { close(); res(); };
    box.querySelector('#fx-ok').onclick = ev => busy(ev.currentTarget, async () => {
      const ids = marcadas(); if (!ids.length) throw new Error('Palomea al menos una nota');
      const d = suma() - f.total;
      if (Math.abs(d) >= 0.5 && !(await confirmar(`Las notas suman ${money(suma())} y la factura es de ${money(f.total)} (diferencia ${money(d)}). ¿Marcarlas de todos modos?`, 'Sí, marcar'))) return;
      const { error: e2 } = await sb.from('ventas').update({ facturada: true, folio_factura: folioTxt || nombreArchivo }).in('id', ids);
      if (e2) throw e2;
      toast(`${ids.length} notas marcadas con la factura ${f.serie}${f.folio}`, 'ok'); close(); res();
    });
  }));
}

// Imagen del corte para mandar por WhatsApp (solo dinero; sin "esperado" ni litros)
async function canvasCorte(r) {
  const W = 720, P = 44, tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 1600;
  const g = tmp.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, tmp.height); g.fillStyle = '#10323D';
  const F = (px, b) => g.font = `${b ? 'bold ' : ''}${px}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  let y = P; const txt = (t, x, al = 'left') => { g.textAlign = al; g.fillText(t, x, y); };
  const linea = () => { y += 16; g.fillStyle = '#C9D6DA'; g.fillRect(P, y, W - 2 * P, 2); g.fillStyle = '#10323D'; y += 26; };
  const par = (a, b, bold) => { F(27, bold); txt(a, P); txt(b, W - P, 'right'); y += 44; };
  const logo = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'logo.jpg'; });
  if (logo) { const lw = 300, lh = logo.height * lw / logo.width; g.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + 10; }
  y += 30; F(36, true); txt('CORTE DE CAJA', W / 2, 'center'); y += 40;
  const fz = { timeZone: CFG.ZONA };
  F(24); txt(`${new Date().toLocaleDateString('es-MX', { ...fz, weekday: 'long', day: 'numeric', month: 'long' })}`, W / 2, 'center'); y += 34;
  txt(`${S.perfil.nombre || ''} · ${r._abierto ? fmtHora(r._abierto) + ' a ' : ''}${fmtHora(new Date())}`, W / 2, 'center'); y += 6;
  linea();
  par('Ventas en efectivo', money(r.ventas_efectivo));
  par('Ventas por transferencia', money(r.ventas_transferencia));
  par('Pagos hechos con la caja', '-' + money(r.gastos_caja));
  linea();
  par('Efectivo contado', money(r.efectivo_contado), true);
  y += 10;
  const dc = num(r.diferencia_caja);
  g.fillStyle = dc < 0 ? '#FDECEC' : '#E6F4EC'; g.fillRect(P, y - 34, W - 2 * P, 64); g.fillStyle = dc < 0 ? '#B42318' : '#1F7A4D';
  F(30, true); txt(dc < 0 ? `Faltan ${money(-dc)}` : '✓ Corte correcto', W / 2, 'center'); y += 70; g.fillStyle = '#10323D';
  F(20); g.fillStyle = '#5B7680'; txt('Agua Inmaculada Real del Valle', W / 2, 'center'); y += P;
  const out = document.createElement('canvas'); out.width = W; out.height = y; out.getContext('2d').drawImage(tmp, 0, 0);
  return out;
}

function mostrarArqueo(main, r) {
  const tc = cfg('tolerancia_caja') || 10, tl = cfg('tolerancia_litros') || 40;
  const dc = num(r.diferencia_caja), dl = r.diferencia_litros === null ? null : num(r.diferencia_litros), dg = r.diferencia_garrafones_nuevos;
  const est = (ok, warn) => ok ? 'ok' : (warn ? 'warn' : 'bad');
  const dueno = S.perfil.rol === 'dueno';
  main.innerHTML = `
  <div class="card" style="max-width:640px;margin:0 auto">
    <h1>Turno cerrado</h1>
    <p class="mut">Hora de salida: <b>${fmtHora(new Date())}</b></p>
    <div class="alert inf"><b>Último paso:</b> manda tu corte al grupo con el botón verde de abajo.</div>
    <h3>Arqueo de caja</h3>
    <table><tbody>
      <tr><td>Ventas en efectivo</td><td class="n">${money(r.ventas_efectivo)}</td></tr>
      <tr><td>Ventas por transferencia</td><td class="n">${money(r.ventas_transferencia)}</td></tr>
      <tr><td>Pagos hechos con la caja</td><td class="n">-${money(r.gastos_caja)}</td></tr>
      ${S.perfil.rol === 'dueno' ? `<tr><td><b>Efectivo esperado</b> (incluye caja chica)</td><td class="n"><b>${money(r.efectivo_esperado)}</b></td></tr>` : ''}
      <tr><td><b>Efectivo contado</b></td><td class="n"><b>${money(r.efectivo_contado)}</b></td></tr>
    </tbody></table>
    ${S.perfil.rol === 'dueno'
      ? `<div class="alert ${est(Math.abs(dc) <= tc)}" style="margin-top:10px">Diferencia de caja: ${dc >= 0 ? '+' : ''}${money(dc)} ${dc === 0 ? '· Cuadra exacto' : Math.abs(dc) <= tc ? '· Dentro de la tolerancia' : dc < 0 ? '· Falta dinero' : '· Sobra dinero'}</div>`
      : dc < 0 ? `<div class="alert bad" style="margin-top:10px">Faltan ${money(-dc)} en caja.</div>` : `<div class="alert ok" style="margin-top:10px">✓ Tu corte está bien.</div>`}
    ${dueno ? `<h3>Agua</h3>
    <table><tbody>
      <tr><td>Litros según medidor</td><td class="n">${r.litros_medidor === null ? '—' : fmtN(r.litros_medidor, 1)}</td></tr>
      <tr><td>Litros vendidos (${fmtN(r.garrafones_vendidos)} garrafones)</td><td class="n">${fmtN(r.litros_vendidos, 1)}</td></tr>
    </tbody></table>
    ${dl === null ? '' : `<div class="alert ${est(Math.abs(dl) <= tl, dl < 0)}" style="margin-top:10px">Diferencia: ${fmtN(dl, 1)} litros (${fmtN(dl / 20, 1)} garrafones) ${Math.abs(dl) <= tl ? '· Cuadra' : dl > 0 ? '· Salió más agua de la vendida' : '· Se vendió más de lo que marca el medidor'}</div>`}
    ${dg === null || dg === undefined ? '' : `<h3>Garrafones nuevos</h3><div class="alert ${est(dg === 0)}">Vendidos: ${fmtN(r.garrafones_nuevos_vendidos)} · Diferencia en conteo: ${dg > 0 ? '+' : ''}${dg} ${dg === 0 ? '· Cuadra' : ''}</div>`}` : ''}
    <button class="btn big ok" style="margin-top:12px" id="aq-wa">Enviar corte por WhatsApp</button>
    <button class="btn big ghost" style="margin-top:8px" onclick="S.tab=null;boot()">Listo</button>
  </div>`;
  document.getElementById('aq-wa').onclick = e => busy(e.currentTarget, async () => {
    const cv = await canvasCorte(r);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const nombre = `Corte_${fechaMX()}_${(S.perfil.nombre || 'turno').normalize('NFD').replace(/[^\w]+/g, '_')}.png`;
    const file = new File([blob], nombre, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Corte de caja' }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    toast('Imagen del corte descargada. Mándala al grupo por WhatsApp.', 'ok');
  });
}

/* =====================================================================
   PANEL DE DUEÑOS
   ===================================================================== */
function selectorPeriodo(onChange) {
  const hoy = fechaMX();
  S.periodo = S.periodo || { desde: hoy, hasta: hoy, k: 'hoy' };
  const p = S.periodo;
  const html = `<div class="card row" style="padding:12px 16px">
    ${[['hoy','Hoy'],['ayer','Ayer'],['sem','7 días'],['mes','Este mes'],['mesant','Mes pasado']].map(([k, t]) => `<button class="btn sm ${p.k === k ? '' : 'sec'}" data-pk="${k}">${t}</button>`).join('')}
    <span class="sp"></span>
    <input type="date" id="pd-d" value="${p.desde}" style="width:auto;padding:7px 10px;font-size:15px"> a
    <input type="date" id="pd-h" value="${p.hasta}" style="width:auto;padding:7px 10px;font-size:15px">
  </div>`;
  const bind = () => {
    document.querySelectorAll('[data-pk]').forEach(b => b.onclick = () => {
      const k = b.dataset.pk, h = fechaMX(); let d = h, hh = h;
      if (k === 'ayer') d = hh = addDays(h, -1);
      if (k === 'sem') d = addDays(h, -6);
      if (k === 'mes') d = h.slice(0, 8) + '01';
      if (k === 'mesant') { const pm = addDays(h.slice(0, 8) + '01', -1); d = pm.slice(0, 8) + '01'; hh = pm; }
      S.periodo = { desde: d, hasta: hh, k }; onChange();
    });
    ['pd-d', 'pd-h'].forEach(id => document.getElementById(id).onchange = () => { S.periodo = { desde: val('pd-d'), hasta: val('pd-h'), k: 'x' }; onChange(); });
  };
  return { html, bind };
}
const diasPeriodo = () => Math.round((new Date(S.periodo.hasta) - new Date(S.periodo.desde)) / 864e5) + 1;
const costoLitro = () => (cfg('costo_pipa') || 1700) / (cfg('litros_pipa') || 10000);
function costoProducto(p) {
  const ins = S.pi.filter(x => x.producto_id === p.id).reduce((s, x) => s + num(x.cantidad) * num(S.articulos.find(a => a.id === x.articulo_id)?.costo_unitario), 0);
  return ins + num(p.litros_consumo) * costoLitro() + num(p.costo_extra);
}
const hbars = (rows, lab, v, fmt = money0) => { const mx = Math.max(1, ...rows.map(r => num(r[v]))); return rows.map(r => `<div class="hbar"><span class="lb">${esc(r[lab])}</span><span class="tr"><i style="width:${num(r[v]) / mx * 100}%"></i></span><span class="vl">${fmt(r[v])}</span></div>`).join(''); };

const VISTAS_DUENO = {
  /* ---------- RESUMEN ---------- */
  async resumen(main) {
    const per = selectorPeriodo(() => VISTAS_DUENO.resumen(main));
    main.innerHTML = per.html + '<div id="rs" class="empty">Calculando…</div>';
    per.bind();
    const [{ data: r, error }, { data: fijos }, { data: mants }, { data: abiertos }, dom] = await Promise.all([
      sb.rpc('resumen_periodo', { p_desde: S.periodo.desde, p_hasta: S.periodo.hasta }),
      sb.from('gastos_fijos').select('*').eq('activo', true),
      sb.from('mantenimientos').select('*').eq('activo', true),
      sb.from('turnos').select('id,abierto_en,usuario_id').eq('estado', 'abierto'),
      domicilioPeriodo()
    ]);
    if (error) throw error;
    const dias = diasPeriodo();
    const relleno = S.productos.find(p => p.nombre === 'Relleno garrafón');
    const ventasTot = num(r.total) + dom.total, garrTot = num(r.garrafones) + dom.garrafones;
    const meta = (cfg('meta_diaria_garrafones') || 83) * dias;
    // costo de lo vendido
    const costoVend = r.por_producto.reduce((s, x) => { const p = S.productos.find(pp => pp.nombre === x.producto); return s + (p ? costoProducto(p) * num(x.cantidad) : 0); }, 0)
      + (relleno ? costoProducto(relleno) * dom.garrafones : 0);
    const gastosOp = r.gastos.filter(g => !['insumo', 'garrafon', 'hielo'].includes(g.categoria)).reduce((s, g) => s + num(g.monto), 0);
    const fijosMes = (fijos || []).reduce((s, f) => s + num(f.monto_mensual), 0);
    const fijosPer = fijosMes * dias / 30.4;
    const utilidad = ventasTot - costoVend - gastosOp - fijosPer;
    const margen = ventasTot ? utilidad / ventasTot : 0;
    // alertas
    const alertas = [];
    S.articulos.filter(a => a.tipo !== 'equipo' && a.activo && num(a.existencia) <= num(a.minimo)).forEach(a => alertas.push(['warn', `Por acabarse: <b>${esc(a.nombre)}</b> · quedan ${fmtN(a.existencia)} (mínimo ${fmtN(a.minimo)})`]));
    const tc = cfg('tolerancia_caja') || 10, tl = cfg('tolerancia_litros') || 40;
    r.turnos.filter(t => t.estado === 'cerrado' && (Math.abs(num(t.diferencia_caja)) > tc || Math.abs(num(t.diferencia_litros)) > tl || num(t.diferencia_garrafones_nuevos) !== 0))
      .forEach(t => alertas.push(['bad', `Turno de <b>${esc(t.usuario)}</b> (${fmtFecha(t.abierto_en)}): caja ${money(t.diferencia_caja)}, agua ${fmtN(t.diferencia_litros, 0)} L, garrafones ${t.diferencia_garrafones_nuevos ?? 0}`]));
    (abiertos || []).filter(t => (Date.now() - new Date(t.abierto_en)) > 14 * 36e5).forEach(t => alertas.push(['warn', `Hay un turno abierto desde ${fmtFecha(t.abierto_en)} (${esc(S.perfiles.find(p => p.id === t.usuario_id)?.nombre || '')})`]));
    (mants || []).forEach(m => { if (!m.ultima_fecha) return; const prox = addDays(m.ultima_fecha, m.cada_dias); if (prox <= fechaMX()) alertas.push(['warn', `Mantenimiento vencido: <b>${esc(m.actividad)}</b> (tocaba ${prox})`]); });
    const litrosPipa = num(r.pipas.litros), litrosCons = num(r.litros_consumo) + num(relleno?.litros_consumo) * dom.garrafones;
    document.getElementById('rs').outerHTML = `
    ${alertas.length ? `<div class="card"><h2>Alertas</h2>${alertas.map(([t, m]) => `<div class="alert ${t}">${m}</div>`).join('')}</div>` : '<div class="alert ok">Sin alertas en este periodo.</div>'}
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><div class="l">Ventas (todo)</div><div class="v">${money0(ventasTot)}</div><div class="s">Planta y empresas ${money0(r.total)} · Domicilio ${money0(dom.total)}</div></div>
      <div class="kpi"><div class="l">Garrafones</div><div class="v">${fmtN(garrTot)}</div><div class="s">Meta ${fmtN(meta)} · ${pct(garrTot / meta)} · ${fmtN(dom.garrafones)} a domicilio</div><div class="bar"><i style="width:${Math.min(100, garrTot / meta * 100)}%"></i></div></div>
      <div class="kpi"><div class="l">Efectivo / Transferencia</div><div class="v" style="font-size:20px">${money0(num(r.efectivo) + dom.efectivo)} / ${money0(num(r.transferencia) + dom.transferencia)}</div><div class="s">A crédito: ${money0(r.credito)}</div></div>
      <div class="kpi"><div class="l">Utilidad estimada</div><div class="v" style="color:${utilidad >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money0(utilidad)}</div><div class="s">Margen ${pct(margen)}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Cómo sale la utilidad</h2><table><tbody>
        <tr><td>Ventas planta y empresas</td><td class="n">${money(r.total)}</td></tr>
        <tr><td>Ventas a domicilio (${fmtN(dom.n)} pedidos)</td><td class="n">${money(dom.total)}</td></tr>
        <tr><td>Costo de lo vendido (agua + insumos)</td><td class="n">-${money(costoVend)}</td></tr>
        <tr><td>Gastos de operación (limpieza, mantenimiento, otros)</td><td class="n">-${money(gastosOp)}</td></tr>
        <tr><td>Gastos fijos proporcionales (${dias} días de ${money0(fijosMes)}/mes)</td><td class="n">-${money(fijosPer)}</td></tr>
        <tr><td><b>Utilidad estimada</b></td><td class="n"><b>${money(utilidad)}</b></td></tr></tbody></table>
        <p class="mut small">Las compras de insumos no se restan aquí porque entran al inventario; se restan cuando se venden.</p></div>
      <div class="card"><h2>Agua: pipas contra ventas</h2><table><tbody>
        <tr><td>Litros comprados en pipas (${fmtN(r.pipas.num)})</td><td class="n">${fmtN(litrosPipa)}</td></tr>
        <tr><td>Litros usados según ventas y domicilio (incluye rechazo)</td><td class="n">${fmtN(litrosCons)}</td></tr>
        <tr><td><b>Diferencia</b></td><td class="n"><b>${fmtN(litrosPipa - litrosCons)}</b></td></tr>
        <tr><td>Equivale a garrafones sin vender</td><td class="n">${fmtN((litrosPipa - litrosCons) / 22)}</td></tr></tbody></table>
        <p class="mut small">Una diferencia grande y constante indica fugas, desperdicio o ventas sin registrar. Compara periodos de varias semanas: el agua de una pipa se usa a lo largo de varios días.</p></div>
      <div class="card"><h2>Ventas por producto</h2>${hbars(r.por_producto, 'producto', 'importe') || '<div class="empty">Sin ventas</div>'}
        <div class="tw"><table><thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Importe</th></tr></thead><tbody>${r.por_producto.map(x => `<tr><td>${esc(x.producto)}</td><td class="n">${fmtN(x.cantidad)}</td><td class="n">${money(x.importe)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>Por día</h2>${hbars(r.por_dia.map(d => ({ ...d, dia: new Date(d.dia + 'T12:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) })), 'dia', 'importe') || '<div class="empty">Sin ventas</div>'}</div>
    </div>`;
  },

  /* ---------- TURNOS ---------- */
  async turnos(main) {
    const per = selectorPeriodo(() => VISTAS_DUENO.turnos(main));
    const { data, error } = await sb.from('turnos').select('*').gte('abierto_en', inicioMX(S.periodo.desde)).lt('abierto_en', inicioMX(addDays(S.periodo.hasta, 1))).order('abierto_en', { ascending: false });
    if (error) throw error;
    const nom = id => esc(S.perfiles.find(p => p.id === id)?.nombre || '—');
    const tc = cfg('tolerancia_caja') || 10, tl = cfg('tolerancia_litros') || 40;
    main.innerHTML = per.html + `<div class="card"><h2>Turnos</h2><div class="tw"><table><thead><tr><th>Persona</th><th>Entrada</th><th>Salida</th><th class="n">Garrafones</th><th class="n">Efectivo</th><th class="n">Transf.</th><th class="n">Dif. caja</th><th class="n">Dif. agua (L)</th><th>Estado</th></tr></thead><tbody>
      ${data.map(t => `<tr class="click" data-id="${t.id}"><td>${nom(t.usuario_id)}</td><td>${fmtFecha(t.abierto_en)}</td><td>${t.cerrado_en ? fmtHora(t.cerrado_en) : '—'}</td>
        <td class="n">${t.garrafones_vendidos ?? '—'}</td><td class="n">${t.ventas_efectivo === null ? '—' : money0(t.ventas_efectivo)}</td><td class="n">${t.ventas_transferencia === null ? '—' : money0(t.ventas_transferencia)}</td>
        <td class="n">${t.diferencia_caja === null ? '—' : `<span class="tag ${Math.abs(num(t.diferencia_caja)) <= tc ? 'ok' : 'bad'}">${money(t.diferencia_caja)}</span>`}</td>
        <td class="n">${t.diferencia_litros === null ? '—' : `<span class="tag ${Math.abs(num(t.diferencia_litros)) <= tl ? 'ok' : 'bad'}">${fmtN(t.diferencia_litros, 0)}</span>`}</td>
        <td>${t.estado === 'abierto' ? '<span class="tag warn">Abierto</span>' : '<span class="tag inf">Cerrado</span>'}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Sin turnos en este periodo</td></tr>'}
      </tbody></table></div></div>`;
    per.bind();
    main.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => {
      const t = data.find(x => x.id == tr.dataset.id);
      const f = (p, txt) => p ? `<button class="btn sm sec" data-foto="${esc(p)}">${txt}</button>` : '';
      modal(`<h2>Turno de ${nom(t.usuario_id)}</h2><p class="mut">${fmtFecha(t.abierto_en)} → ${t.cerrado_en ? fmtFecha(t.cerrado_en) : 'abierto'}</p>
        <table><tbody>
        <tr><td>Caja chica inicial</td><td class="n">${money(t.caja_inicial)} ${t.caja_inicial_ok ? '' : '<span class="tag bad">Incompleta</span>'}</td></tr>
        <tr><td>Medidor inicial / final</td><td class="n">${fmtN(t.medidor_inicial, 1)} / ${t.medidor_final === null ? '—' : fmtN(t.medidor_final, 1)}</td></tr>
        <tr><td>Litros medidor / vendidos</td><td class="n">${t.litros_medidor ?? '—'} / ${t.litros_vendidos ?? '—'}</td></tr>
        <tr><td>Garrafones nuevos inicio / vendidos / final</td><td class="n">${t.garrafones_nuevos_ini ?? '—'} / ${t.garrafones_nuevos_vendidos ?? '—'} / ${t.garrafones_nuevos_fin ?? '—'}</td></tr>
        <tr><td>Ventas efectivo</td><td class="n">${money(t.ventas_efectivo)}</td></tr>
        <tr><td>Ventas transferencia</td><td class="n">${money(t.ventas_transferencia)}</td></tr>
        <tr><td>Pagos con caja</td><td class="n">${money(t.gastos_caja)}</td></tr>
        <tr><td>Efectivo esperado / contado</td><td class="n">${money(t.efectivo_esperado)} / ${money(t.efectivo_contado)}</td></tr>
        <tr><td><b>Diferencia de caja</b></td><td class="n"><b>${money(t.diferencia_caja)}</b></td></tr>
        </tbody></table>
        ${t.notas_apertura ? `<p><b>Notas de apertura:</b> ${esc(t.notas_apertura)}</p>` : ''}${t.notas_cierre ? `<p><b>Notas de cierre:</b> ${esc(t.notas_cierre)}</p>` : ''}
        <div class="row">${f(t.foto_medidor_ini, 'Medidor inicial')}${f(t.foto_medidor_fin, 'Medidor final')}${f(t.foto_caja_fin, 'Caja')}</div>
        <div class="row" style="margin-top:14px">${t.estado === 'abierto' ? '<button class="btn bad" id="t-forzar">Cerrar este turno</button>' : ''}<span class="sp"></span><button class="btn ghost" data-close>Cerrar</button></div>`,
        (box, close) => {
          box.querySelectorAll('[data-foto]').forEach(b => b.onclick = () => verFoto(b.dataset.foto));
          const fz = box.querySelector('#t-forzar');
          if (fz) fz.onclick = () => { close(); cerrarTurnoAjeno(t, main); };
        });
    });
  },

  /* ---------- POR COBRAR (empresas a crédito) ---------- */
  async cobrar(main) {
    main.innerHTML = '<div class="empty">Calculando…</div>';
    const { data, error } = await sb.rpc('cuentas_por_cobrar');
    if (error) throw error;
    const tot = data.reduce((x, c) => x + num(c.saldo), 0), ven = data.reduce((x, c) => x + num(c.vencido), 0);
    main.innerHTML = `<div class="grid g3" style="margin-bottom:16px">
      <div class="kpi"><div class="l">Te deben</div><div class="v">${money0(tot)}</div><div class="s">${data.length} clientes</div></div>
      <div class="kpi"><div class="l">Vencido</div><div class="v" style="color:${ven > 0 ? 'var(--bad)' : 'var(--ok)'}">${money0(ven)}</div><div class="s">${data.filter(c => num(c.vencido) > 0).length} clientes</div></div>
      <div class="kpi"><div class="l">Por vencer</div><div class="v">${money0(tot - ven)}</div></div></div>
    <div class="card" style="margin-bottom:16px"><h2>Estado de cuenta mensual</h2>
      <div class="grid g4" style="align-items:end">
        <div class="field"><label>Buscar empresa</label><input type="search" id="ec-bus" placeholder="Escribe parte del nombre" autocomplete="off"></div>
        <div class="field"><label>Empresa</label><select id="ec-c"><option value="">— Elige —</option>${S.clientes.filter(c => c.tipo === 'empresa' || c.tipo === 'restaurante').map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
        <div class="field"><label>Mes</label><input type="month" id="ec-m" value="${fechaMX().slice(0, 7)}"></div>
        <div class="field"><button class="btn" id="ec-b">Ver estado de cuenta</button></div></div>
      <p class="mut small">Todas las entregas del mes con firma de quien recibió, pagos y saldo. Se guarda en PDF para mandarlo.</p></div>
    <div class="card"><h2>Cuentas por cobrar</h2><div class="tw"><table><thead><tr><th>Cliente</th><th>Crédito</th><th class="n">Debe</th><th class="n">Vencido</th><th></th></tr></thead><tbody>
      ${data.map(c => `<tr><td><b>${esc(c.nombre)}</b><br><span class="mut small">${esc(c.contacto || '')}${c.telefono ? ` · <a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a> · <a href="https://wa.me/52${esc(String(c.telefono).replace(/\D/g, '').slice(-10))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</span></td>
        <td>${esc(txtCredito(c))}<br><span class="mut small">desde ${fmtFecha(c.pendiente_desde)}</span></td>
        <td class="n"><b>${money(c.saldo)}</b></td>
        <td class="n">${num(c.vencido) > 0 ? `<span class="tag bad">${money(c.vencido)}</span><br><span class="mut small">${c.dias_vencido} días</span>` : '<span class="tag ok">Al corriente</span>'}</td>
        <td><button class="btn sm cb-pago" data-id="${c.cliente_id}">Registrar pago</button> <button class="btn sm ghost cb-ver" data-id="${c.cliente_id}">Ver</button> <button class="btn sm ghost cb-ec" data-id="${c.cliente_id}">Estado</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nadie te debe. Todo al corriente.</td></tr>'}
    </tbody></table></div><p class="mut small">Los pagos se aplican a las entregas más viejas primero.</p></div>`;
    const reload = () => VISTAS_DUENO.cobrar(main);
    const ecSel = document.getElementById('ec-c'), ecOpts = [...ecSel.options].slice(1).map(o => ({ v: o.value, t: o.textContent }));
    const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    document.getElementById('ec-bus').oninput = ev => {
      const t = norm(ev.target.value.trim());
      const res = ecOpts.filter(o => !t || norm(o.t).includes(t));
      ecSel.innerHTML = `<option value="">— ${res.length ? 'Elige' : 'Sin resultados'} —</option>` + res.map(o => `<option value="${o.v}">${esc(o.t)}</option>`).join('');
      if (t && res.length) ecSel.value = res[0].v;
    };
    document.getElementById('ec-b').onclick = e => busy(e.currentTarget, async () => {
      const id = val('ec-c'), m = val('ec-m'); if (!id) throw new Error('Elige la empresa'); if (!m) throw new Error('Elige el mes');
      await estadoCuenta(Number(id), m);
    });
    main.querySelectorAll('.cb-pago').forEach(b => b.onclick = () => {
      const c = data.find(x => x.cliente_id == b.dataset.id);
      modal(`<h2>Pago de ${esc(c.nombre)}</h2><p class="mut">Debe <b>${money(c.saldo)}</b>${num(c.vencido) > 0 ? ` · vencido ${money(c.vencido)}` : ''}</p>
        <div class="field"><label>Monto que pagó</label><input type="number" id="cb-m" inputmode="decimal" value="${num(c.saldo)}"></div>
        <div class="field"><label>Forma de pago</label><div class="pay" id="cb-fp"><button data-v="transferencia" class="on">Transferencia</button><button data-v="efectivo">Efectivo</button></div></div>
        <div class="field"><label>Notas</label><input type="text" id="cb-n" placeholder="ej. folio de la transferencia"></div>
        <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="cb-b">Guardar pago</button></div>`,
        (box, close) => {
          let fp = 'transferencia';
          box.querySelectorAll('#cb-fp button').forEach(x => x.onclick = () => { fp = x.dataset.v; box.querySelectorAll('#cb-fp button').forEach(y => y.classList.toggle('on', y === x)); });
          box.querySelector('#cb-b').onclick = e => busy(e.currentTarget, async () => {
            const m = nval('cb-m'); if (!m || m <= 0) throw new Error('Escribe el monto');
            if (m > num(c.saldo) + 0.01 && !(await confirmar(`El pago (${money(m)}) es mayor a lo que debe (${money(c.saldo)}). ¿Guardar de todos modos?`, 'Guardar'))) return;
            const { error } = await sb.from('cobros').insert({ cliente_id: c.cliente_id, monto: m, forma_pago: fp, notas: val('cb-n') || null });
            if (error) throw error; close(); toast('Pago registrado', 'ok'); reload();
          });
        });
    });
    main.querySelectorAll('.cb-ec').forEach(b => b.onclick = () => busy(b, () => estadoCuenta(Number(b.dataset.id), fechaMX().slice(0, 7))));
    main.querySelectorAll('.cb-ver').forEach(b => b.onclick = async () => {
      const c = data.find(x => x.cliente_id == b.dataset.id);
      const [{ data: vs }, { data: cs }] = await Promise.all([
        sb.from('ventas').select('id,fecha,total').eq('cliente_id', c.cliente_id).eq('forma_pago', 'credito').eq('cancelada', false).order('fecha', { ascending: false }).limit(40),
        sb.from('cobros').select('*').eq('cliente_id', c.cliente_id).order('fecha', { ascending: false }).limit(40)]);
      modal(`<h2>${esc(c.nombre)}</h2><p class="mut">${esc(txtCredito(c))} · debe <b>${money(c.saldo)}</b></p>
        <h3>Entregas a crédito</h3><table><tbody>${(vs || []).map(v => `<tr><td>${fmtFecha(v.fecha)}</td><td class="n">${money(v.total)}</td></tr>`).join('') || '<tr><td class="empty">Sin entregas</td></tr>'}</tbody></table>
        <h3>Pagos</h3><table><tbody>${(cs || []).map(p => `<tr><td>${fmtFecha(p.fecha)}<br><span class="mut small">${esc(p.forma_pago)}${p.notas ? ' · ' + esc(p.notas) : ''}</span></td><td class="n">${money(p.monto)}</td></tr>`).join('') || '<tr><td class="empty">Sin pagos</td></tr>'}</tbody></table>
        <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn ghost" data-close>Cerrar</button></div>`);
    });
  },

  /* ---------- VENTAS ---------- */
  async ventas(main) {
    const per = selectorPeriodo(() => VISTAS_DUENO.ventas(main));
    const domP = domicilioPeriodo();
    const data = await fetchAll(() => sb.from('ventas').select('*, venta_detalle(cantidad, producto_id, precio_unitario)').gte('fecha', inicioMX(S.periodo.desde)).lt('fecha', inicioMX(addDays(S.periodo.hasta, 1))).order('fecha', { ascending: false }));
    const nom = id => esc(S.perfiles.find(p => p.id === id)?.nombre || '—');
    const prod = id => S.productos.find(p => p.id === id)?.nombre || '';
    const cli = id => esc(S.clientes.find(c => c.id === id)?.nombre || '');
    const dom = await domP;
    const vivas = data.filter(v => !v.cancelada), tf = f => vivas.filter(v => v.forma_pago === f).reduce((x, v) => x + num(v.total), 0);
    const totPE = vivas.reduce((x, v) => x + num(v.total), 0);
    main.innerHTML = per.html + `<div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><div class="l">Total del periodo</div><div class="v">${money0(totPE + dom.total)}</div><div class="s">Planta, empresas y domicilio</div></div>
      <div class="kpi"><div class="l">Planta y empresas</div><div class="v">${money0(totPE)}</div><div class="s">${fmtN(vivas.length)} ventas · crédito ${money0(tf('credito'))}</div></div>
      <div class="kpi"><div class="l">Domicilio</div><div class="v">${money0(dom.total)}</div><div class="s">${fmtN(dom.n)} pedidos · ${fmtN(dom.garrafones)} garrafones</div></div>
      <div class="kpi"><div class="l">Efectivo / Transferencia</div><div class="v" style="font-size:20px">${money0(tf('efectivo') + dom.efectivo)} / ${money0(tf('transferencia') + dom.transferencia)}</div><div class="s">Incluye domicilio</div></div></div>
    <div class="card"><div class="row"><h2 style="margin:0">Ventas</h2><span class="sp"></span><span class="tag inf">${data.filter(v => !v.cancelada).length} ventas · ${money(data.filter(v => !v.cancelada).reduce((s, v) => s + num(v.total), 0))}</span></div>
      <div class="tw"><table><thead><tr><th>Fecha</th><th>Vendió</th><th>Productos</th><th>Cliente</th><th>Pago</th><th class="n">Total</th><th></th></tr></thead><tbody>
      ${data.map(v => `<tr><td>${fmtFecha(v.fecha)}</td><td>${nom(v.usuario_id)}</td><td>${v.venta_detalle.map(d => `${fmtN(d.cantidad)} ${esc(prod(d.producto_id))}`).join(', ')}</td><td>${cli(v.cliente_id)}</td>
        <td>${esc(v.forma_pago)}</td><td class="n">${money(v.total)}</td>
        <td>${v.cancelada ? `<span class="tag bad" title="${esc(v.motivo_cancelacion)}">Cancelada</span>` : `<button class="btn sm ghost" data-cancel="${v.id}">Cancelar</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin ventas</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><div class="row"><h2 style="margin:0">Domicilio</h2><span class="sp"></span><span class="tag inf">${fmtN(dom.n)} entregas · ${money(dom.total)}</span></div>
      <div class="tw"><table><thead><tr><th>Entregado</th><th>Cliente</th><th>Garrafones</th><th>Pago</th><th class="n">Total</th></tr></thead><tbody>
      ${dom.lista.map(p => `<tr><td>${fmtFecha(p.entregado_en)}</td><td>${esc(p.nombre)}</td><td>${esc(txtMarcas({ ...p, cantidad: p.entregado_cantidad }))}</td><td>${esc(p.forma_pago_real || '')}</td><td class="n">${money(p.monto_cobrado)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin entregas a domicilio en este periodo</td></tr>'}
      </tbody></table></div></div>`;
    per.bind();
    main.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => modal(`<h2>Cancelar venta #${b.dataset.cancel}</h2>
      <div class="field"><label>Motivo</label><input type="text" id="cv-m" placeholder="ej. Se capturó dos veces"></div>
      <div class="row"><button class="btn ghost" data-close>Regresar</button><span class="sp"></span><button class="btn bad" id="cv-b">Cancelar venta</button></div>`,
      (box, close) => box.querySelector('#cv-b').onclick = e => busy(e.currentTarget, async () => {
        const { error } = await sb.rpc('cancelar_venta', { p_venta_id: Number(b.dataset.cancel), p_motivo: val('cv-m') });
        if (error) throw error; close(); toast('Venta cancelada', 'ok'); VISTAS_DUENO.ventas(main);
      })));
  },

  /* ---------- INVENTARIO ---------- */
  async inventario(main) {
    await cargarCatalogos();
    const mov = S.articulos.filter(a => a.tipo !== 'equipo');
    const eq = S.articulos.filter(a => a.tipo === 'equipo');
    main.innerHTML = `
    <div class="card"><div class="row"><h2 style="margin:0">Insumos, garrafones e hielo</h2><span class="sp"></span><button class="btn sm" id="i-nuevo">Nuevo artículo</button></div>
      <div class="tw"><table><thead><tr><th>Artículo</th><th>Tipo</th><th class="n">Existencia</th><th class="n">Mínimo</th><th class="n">Costo unit.</th><th class="n">Valor</th><th></th></tr></thead><tbody>
      ${mov.map(a => `<tr><td><b>${esc(a.nombre)}</b>${a.activo ? '' : ' <span class="tag">Inactivo</span>'}</td><td>${esc(a.tipo)}</td>
        <td class="n">${num(a.existencia) <= num(a.minimo) ? `<span class="tag bad">${fmtN(a.existencia)}</span>` : fmtN(a.existencia)}</td><td class="n">${fmtN(a.minimo)}</td>
        <td class="n">${money(a.costo_unitario)}</td><td class="n">${money(num(a.existencia) * num(a.costo_unitario))}</td>
        <td class="row" style="flex-wrap:nowrap"><button class="btn sm sec" data-ent="${a.id}">Entrada</button><button class="btn sm ghost" data-aj="${a.id}">Ajustar</button><button class="btn sm ghost" data-ed="${a.id}">Editar</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="mut small">Las ventas descuentan tapas, liners, sellos, envases e hielo automáticamente. Las compras capturadas en planta suman al inventario. Usa “Ajustar” para poner el conteo físico real.</p></div>
    <div class="card"><div class="row"><h2 style="margin:0">Equipo de la purificadora</h2><span class="sp"></span><button class="btn sm" id="i-nuevo-eq">Agregar equipo</button></div>
      <div class="tw"><table><thead><tr><th>Equipo</th><th>Marca / modelo</th><th>No. de serie</th><th>Compra</th><th class="n">Valor</th><th></th></tr></thead><tbody>
      ${eq.map(a => `<tr><td><b>${esc(a.nombre)}</b><br><span class="mut small">${esc(a.notas || '')}</span></td><td>${esc([a.marca, a.modelo].filter(Boolean).join(' / '))}</td><td>${esc(a.numero_serie || '')}</td><td>${a.fecha_compra || ''}</td><td class="n">${a.valor_compra ? money(a.valor_compra) : ''}</td><td><button class="btn sm ghost" data-ed="${a.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Agrega aquí bombas, tanques, membranas, lámpara UV, llenadora, etc.</td></tr>'}
      </tbody></table></div></div>`;
    const reload = () => VISTAS_DUENO.inventario(main);
    document.getElementById('i-nuevo').onclick = () => editarArticulo(null, reload, 'insumo');
    document.getElementById('i-nuevo-eq').onclick = () => editarArticulo(null, reload, 'equipo');
    main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editarArticulo(S.articulos.find(a => a.id == b.dataset.ed), reload));
    const movForm = (id, tipo) => {
      const a = S.articulos.find(x => x.id == id);
      modal(`<h2>${tipo === 'entrada' ? 'Entrada de' : 'Ajustar conteo de'} ${esc(a.nombre)}</h2>
        <p class="mut">Existencia en sistema: <b>${fmtN(a.existencia)}</b></p>
        <div class="field"><label>${tipo === 'entrada' ? 'Cantidad que entra' : 'Existencia real contada'}</label><input type="number" id="mv-q" inputmode="decimal"></div>
        <div class="field"><label>Motivo</label><input type="text" id="mv-m" value="${tipo === 'entrada' ? 'Entrada manual' : 'Conteo físico'}"></div>
        <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="mv-b">Guardar</button></div>`,
        (box, close) => box.querySelector('#mv-b').onclick = e => busy(e.currentTarget, async () => {
          const q = nval('mv-q'); if (q === null || q < 0) throw new Error('Escribe la cantidad');
          const { error } = await sb.from('movimientos').insert({ articulo_id: a.id, tipo, cantidad: q, motivo: val('mv-m'), usuario_id: S.session.user.id });
          if (error) throw error; close(); toast('Inventario actualizado', 'ok'); reload();
        }));
    };
    main.querySelectorAll('[data-ent]').forEach(b => b.onclick = () => movForm(b.dataset.ent, 'entrada'));
    main.querySelectorAll('[data-aj]').forEach(b => b.onclick = () => movForm(b.dataset.aj, 'ajuste'));
  },

  /* ---------- PRODUCTOS Y PRECIOS ---------- */
  async productos(main) {
    await cargarCatalogos();
    main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Productos y precios</h2><span class="sp"></span><button class="btn sm" id="pr-nuevo">Nuevo producto</button></div>
      <p class="mut small">El costo estimado suma insumos + agua de pipa (incluye rechazo) + costo extra. Si el margen queda abajo de 20%, se marca en rojo.</p>
      <div class="tw"><table><thead><tr><th>Producto</th><th class="n">Precio planta</th><th class="n">Precio domicilio</th><th class="n">Litros (medidor / pipa)</th><th class="n">Costo extra</th><th class="n">Costo est.</th><th class="n">Margen planta</th><th>Activo</th><th></th></tr></thead><tbody>
      ${S.productos.map(p => { const c = costoProducto(p), m = num(p.precio) ? (num(p.precio) - c) / num(p.precio) : 0; return `<tr data-p="${p.id}">
        <td><b>${esc(p.nombre)}</b><br><span class="mut small">IVA ${pct(p.iva_tasa)}</span></td>
        <td class="n"><input type="number" class="pp" value="${p.precio}" style="width:90px;padding:7px"></td>
        <td class="n"><input type="number" class="pd" value="${p.precio_domicilio ?? ''}" style="width:90px;padding:7px"></td>
        <td class="n"><input type="number" class="lp" value="${p.litros_producto}" style="width:64px;padding:7px"> / <input type="number" class="lc" value="${p.litros_consumo}" style="width:64px;padding:7px"></td>
        <td class="n"><input type="number" class="ce" value="${p.costo_extra}" style="width:80px;padding:7px"></td>
        <td class="n">${money(c)}</td><td class="n"><span class="tag ${m >= 0.2 ? 'ok' : 'bad'}">${pct(m)}</span></td>
        <td><input type="checkbox" class="ac" ${p.activo ? 'checked' : ''} style="width:22px;height:22px"></td>
        <td><button class="btn sm ghost pr-del" data-id="${p.id}" title="Eliminar producto">Eliminar</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" id="pr-b">Guardar cambios</button></div></div>`;
    document.getElementById('pr-b').onclick = e => busy(e.currentTarget, async () => {
      const rows = [...main.querySelectorAll('tr[data-p]')];
      const bajos = [];
      for (const tr of rows) {
        const id = Number(tr.dataset.p), p = S.productos.find(x => x.id === id);
        const upd = { precio: num(tr.querySelector('.pp').value), precio_domicilio: tr.querySelector('.pd').value === '' ? null : num(tr.querySelector('.pd').value),
          litros_producto: num(tr.querySelector('.lp').value), litros_consumo: num(tr.querySelector('.lc').value), costo_extra: num(tr.querySelector('.ce').value), activo: tr.querySelector('.ac').checked };
        if (upd.precio < costoProducto({ ...p, ...upd })) bajos.push(p.nombre);
      }
      if (bajos.length && !(await confirmar(`Ojo: <b>${bajos.map(esc).join(', ')}</b> quedaría abajo del costo. ¿Guardar de todos modos?`, 'Guardar'))) return;
      for (const tr of rows) {
        const { error } = await sb.from('productos').update({ precio: num(tr.querySelector('.pp').value), precio_domicilio: tr.querySelector('.pd').value === '' ? null : num(tr.querySelector('.pd').value),
          litros_producto: num(tr.querySelector('.lp').value), litros_consumo: num(tr.querySelector('.lc').value), costo_extra: num(tr.querySelector('.ce').value), activo: tr.querySelector('.ac').checked }).eq('id', Number(tr.dataset.p));
        if (error) throw error;
      }
      toast('Precios guardados', 'ok'); VISTAS_DUENO.productos(main);
    });
    document.getElementById('pr-nuevo').onclick = () => nuevoProducto(() => VISTAS_DUENO.productos(main));
    main.querySelectorAll('.pr-del').forEach(b => b.onclick = e => busy(e.currentTarget, async () => {
      const p = S.productos.find(x => x.id === Number(b.dataset.id));
      if (!(await confirmar(`¿Eliminar <b>${esc(p.nombre)}</b>? Esto no se puede deshacer.`, 'Eliminar'))) return;
      const { error } = await sb.from('productos').delete().eq('id', p.id);
      if (error) {
        if (error.code === '23503') throw new Error('Este producto ya tiene ventas o pedidos registrados. No se puede eliminar: desmarca "Activo" para ocultarlo.');
        throw error;
      }
      toast('Producto eliminado', 'ok'); await cargarCatalogos(); VISTAS_DUENO.productos(main);
    }));
  },

  /* ---------- CLIENTES ---------- */
  async clientes(main) {
    const { data, error } = await sb.from('clientes').select('*').order('nombre');
    if (error) throw error;
    main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Clientes</h2><span class="sp"></span><button class="btn sm" id="c-nuevo">Nuevo cliente</button></div>
      <div class="tw"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Teléfono</th><th class="n">Precio especial</th><th>RFC</th><th>Constancia</th><th></th></tr></thead><tbody>
      ${data.map(c => `<tr><td><b>${esc(c.nombre)}</b>${c.activo ? '' : ' <span class="tag">Inactivo</span>'}<br><span class="mut small">${esc(c.domicilio || '')}</span></td><td>${esc(c.tipo)}</td><td>${esc(c.telefono || '')}</td>
        <td class="n">${c.precio_especial ? money(c.precio_especial) : '—'}</td><td>${esc(c.rfc || '')}</td><td>${c.constancia_path ? `<button class="btn sm sec" data-cons="${esc(c.constancia_path)}">Ver</button>` : '—'}</td>
        <td class="row" style="flex-wrap:nowrap"><button class="btn sm ghost" data-ed="${c.id}">Editar</button>${c.rfc ? `<button class="btn sm sec" data-fis="${c.id}">Datos fiscales</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aún no hay clientes</td></tr>'}
      </tbody></table></div></div>`;
    const reload = async () => { await cargarCatalogos(); VISTAS_DUENO.clientes(main); };
    document.getElementById('c-nuevo').onclick = () => editarCliente(null, reload);
    main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editarCliente(data.find(c => c.id == b.dataset.ed), reload));
    main.querySelectorAll('[data-cons]').forEach(b => b.onclick = () => verFoto(b.dataset.cons, 'fiscal'));
    main.querySelectorAll('[data-fis]').forEach(b => b.onclick = () => datosFiscales(data.find(c => c.id == b.dataset.fis)));
  },

  /* ---------- CONTADOR ---------- */
  async contador(main) {
    const hoy = fechaMX();
    S.mesCont = S.mesCont || hoy.slice(0, 7);
    const desde = S.mesCont + '-01', hasta = addDays(addDays(desde, 32).slice(0, 8) + '01', -1);
    main.innerHTML = `<div class="card row"><h2 style="margin:0">Reporte para el contador</h2><span class="sp"></span>
      <label style="margin:0">Mes</label><input type="month" id="ct-mes" value="${S.mesCont}" style="width:auto;padding:8px">
      <button class="btn" id="ct-xls">Descargar Excel</button></div>
      <div class="card"><div class="row"><div><h2 style="margin:0">Subir factura del SAT</h2>
        <span class="mut small">Elige el archivo <b>XML</b> de la factura. La app encuentra la empresa por su RFC y las notas que cubre.</span></div><span class="sp"></span>
        <label class="btn sec" style="margin:0">Subir XML<input type="file" id="ct-xml" accept=".xml,text/xml,application/xml" multiple hidden></label></div></div>
      <div id="ct-body" class="empty">Cargando…</div>`;
    document.getElementById('ct-mes').onchange = e => { S.mesCont = e.target.value; VISTAS_DUENO.contador(main); };
    document.getElementById('ct-xml').onchange = async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        try { await facturaXML(await f.text(), f.name); } catch (err) { toast(`${f.name}: ${errMsg(err)}`, 'bad'); }
      }
      VISTAS_DUENO.contador(main);
    };
    const det = await fetchAll(() => sb.from('venta_detalle').select('cantidad,importe,iva_tasa,producto_id,ventas!inner(id,fecha,forma_pago,cliente_id,cancelada,facturada,folio_factura,canal)')
      .gte('ventas.fecha', inicioMX(desde)).lt('ventas.fecha', inicioMX(addDays(hasta, 1))).eq('ventas.cancelada', false));
    const { data: gastos } = await sb.from('gastos').select('*').gte('fecha', inicioMX(desde)).lt('fecha', inicioMX(addDays(hasta, 1))).order('fecha');
    const base = (imp, t) => num(imp) / (1 + num(t));
    const porTasa = {}, pg = {}, porCli = {};
    for (const d of det) {
      const v = d.ventas, t = num(d.iva_tasa), dia = fechaMX(new Date(v.fecha));
      porTasa[t] = (porTasa[t] || 0) + num(d.importe);
      const esPG = !v.cliente_id || !v.facturada;
      if (!v.cliente_id) { pg[dia] = pg[dia] || { dia, t0: 0, t16: 0 }; pg[dia][t ? 't16' : 't0'] += num(d.importe); }
      if (v.cliente_id) {
        const c = porCli[v.cliente_id] = porCli[v.cliente_id] || { id: v.cliente_id, total: 0, pendiente: 0, credito: 0, folios: new Set(), ventas: new Set() };
        c.total += num(d.importe); if (!v.facturada) { c.pendiente += num(d.importe); c.ventas.add(v.id); } else if (v.folio_factura) c.folios.add(v.folio_factura);
        if (v.forma_pago === 'credito') c.credito += num(d.importe);
      }
    }
    const cliRows = Object.values(porCli).map(c => ({ ...c, cli: S.clientes.find(x => x.id === c.id) || {} }));
    const pgRows = Object.values(pg).sort((a, b) => a.dia.localeCompare(b.dia));
    document.getElementById('ct-body').outerHTML = `
    <div class="grid g2">
      <div class="card"><h2>Ventas del mes por tasa de IVA</h2><table><thead><tr><th>Tasa</th><th class="n">Total cobrado</th><th class="n">Base</th><th class="n">IVA</th></tr></thead><tbody>
        ${Object.entries(porTasa).map(([t, imp]) => `<tr><td>${pct(t)}</td><td class="n">${money(imp)}</td><td class="n">${money(base(imp, t))}</td><td class="n">${money(imp - base(imp, t))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin ventas</td></tr>'}
        </tbody></table><p class="mut small">Garrafón de 20 L a tasa 0%. Hielo al 16%. Confirma las tasas con tu contador.</p></div>
      <div class="card"><h2>Público en general (factura global)</h2><div class="tw"><table><thead><tr><th>Día</th><th class="n">Tasa 0%</th><th class="n">Tasa 16%</th></tr></thead><tbody>
        ${pgRows.map(r => `<tr><td>${r.dia}</td><td class="n">${money(r.t0)}</td><td class="n">${money(r.t16)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sin ventas</td></tr>'}
        <tr><td><b>Total</b></td><td class="n"><b>${money(pgRows.reduce((s, r) => s + r.t0, 0))}</b></td><td class="n"><b>${money(pgRows.reduce((s, r) => s + r.t16, 0))}</b></td></tr></tbody></table></div></div>
    </div>
    <div class="card"><h2>Clientes con datos fiscales</h2><div class="tw"><table><thead><tr><th>Cliente</th><th>RFC</th><th class="n">Total del mes</th><th class="n">A crédito</th><th class="n">Pendiente de facturar</th><th>Folios</th><th></th></tr></thead><tbody>
      ${cliRows.map(c => `<tr><td><b>${esc(c.cli.nombre || '#' + c.id)}</b><br><span class="mut small">${esc(c.cli.razon_social || '')}</span></td><td>${esc(c.cli.rfc || 'Sin RFC')}</td><td class="n">${money(c.total)}</td><td class="n">${money(c.credito)}</td>
        <td class="n">${c.pendiente ? `<span class="tag warn">${money(c.pendiente)}</span>` : '<span class="tag ok">Facturado</span>'}</td><td>${[...c.folios].map(esc).join(', ')}</td>
        <td class="row" style="flex-wrap:nowrap">${c.cli.rfc ? `<button class="btn sm sec" data-fis="${c.id}">Datos</button>` : ''}${c.pendiente ? `<button class="btn sm" data-fac="${c.id}">Marcar facturado</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin ventas a clientes registrados</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h2>Gastos del mes</h2><div class="tw"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Factura</th><th class="n">Monto</th></tr></thead><tbody>
      ${(gastos || []).map(g => `<tr><td>${fmtFecha(g.fecha)}</td><td>${esc(g.descripcion)}${g.proveedor ? '<br><span class="mut small">' + esc(g.proveedor) + '</span>' : ''}</td><td>${esc(g.categoria)}</td><td>${g.con_factura ? '<span class="tag ok">Sí</span>' : '<span class="tag">No</span>'}</td><td class="n">${money(g.monto)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin gastos</td></tr>'}
      </tbody></table></div></div>`;
    main.querySelectorAll('[data-fis]').forEach(b => b.onclick = () => datosFiscales(S.clientes.find(c => c.id == b.dataset.fis)));
    main.querySelectorAll('[data-fac]').forEach(b => b.onclick = () => {
      const c = cliRows.find(x => x.id == b.dataset.fac);
      modal(`<h2>Marcar como facturado</h2><p>${esc(c.cli.nombre)} · ${money(c.pendiente)} pendientes en ${c.ventas.size} ventas.</p>
        <div class="field"><label>Folio de la factura</label><input type="text" id="mf-f"></div>
        <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="mf-b">Guardar</button></div>`,
        (box, close) => box.querySelector('#mf-b').onclick = e => busy(e.currentTarget, async () => {
          if (!val('mf-f')) throw new Error('Escribe el folio');
          const { error } = await sb.from('ventas').update({ facturada: true, folio_factura: val('mf-f') }).in('id', [...c.ventas]);
          if (error) throw error; close(); toast('Marcado como facturado', 'ok'); VISTAS_DUENO.contador(main);
        }));
    });
    document.getElementById('ct-xls').onclick = () => {
      const wb = XLSX.utils.book_new();
      const add = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Nota: 'Sin datos' }]), name);
      add(Object.entries(porTasa).map(([t, imp]) => ({ 'Tasa IVA': pct(t), 'Total cobrado': +imp.toFixed(2), 'Base': +base(imp, t).toFixed(2), 'IVA': +(imp - base(imp, t)).toFixed(2) })), 'Resumen IVA');
      add(pgRows.map(r => ({ 'Día': r.dia, 'Tasa 0%': +r.t0.toFixed(2), 'Tasa 16% (con IVA)': +r.t16.toFixed(2), 'Base 16%': +(r.t16 / 1.16).toFixed(2), 'IVA 16%': +(r.t16 - r.t16 / 1.16).toFixed(2) })), 'Publico en general');
      add(cliRows.map(c => ({ Cliente: c.cli.nombre, 'Razón social': c.cli.razon_social, RFC: c.cli.rfc, 'Régimen': c.cli.regimen_fiscal, 'CP fiscal': c.cli.cp_fiscal, 'Uso CFDI': c.cli.uso_cfdi, Correo: c.cli.correo_factura,
        'Total del mes': +c.total.toFixed(2), 'A crédito': +c.credito.toFixed(2), 'Pendiente de facturar': +c.pendiente.toFixed(2), Folios: [...c.folios].join(', ') })), 'Clientes');
      add((gastos || []).map(g => ({ Fecha: fechaMX(new Date(g.fecha)), Concepto: g.descripcion, Proveedor: g.proveedor, 'Categoría': g.categoria, Factura: g.con_factura ? 'Sí' : 'No', Monto: num(g.monto) })), 'Gastos');
      add(det.map(d => ({ Fecha: fechaMX(new Date(d.ventas.fecha)), Venta: d.ventas.id, Producto: S.productos.find(p => p.id === d.producto_id)?.nombre, Cantidad: num(d.cantidad), Importe: num(d.importe), 'Tasa IVA': num(d.iva_tasa),
        'Forma de pago': d.ventas.forma_pago, Cliente: S.clientes.find(c => c.id === d.ventas.cliente_id)?.nombre || 'Público en general', Facturada: d.ventas.facturada ? 'Sí' : 'No', Folio: d.ventas.folio_factura || '' })), 'Detalle de ventas');
      XLSX.writeFile(wb, `Reporte_Contador_AguaInmaculada_${S.mesCont}.xlsx`);
    };
  },

  /* ---------- GASTOS FIJOS ---------- */
  async fijos(main) {
    const { data, error } = await sb.from('gastos_fijos').select('*').order('categoria').order('concepto');
    if (error) throw error;
    const cats = ['operacion', 'personal', 'reparto', 'deuda', 'franquicia', 'otro'];
    main.innerHTML = `<div class="card"><h2>Gastos fijos mensuales</h2><p class="mut small">Se usan para calcular la utilidad real en el Resumen. Agrega aquí también los pagos de deudas (Cajas Populares, Trini).</p>
      <div class="tw"><table><thead><tr><th>Concepto</th><th>Categoría</th><th>Día de pago</th><th class="n">Monto mensual</th><th>Activo</th></tr></thead><tbody id="gf-b">
      ${data.map(f => `<tr data-id="${f.id}"><td><input type="text" class="c" value="${esc(f.concepto)}" style="padding:7px"></td><td><select class="k" style="padding:7px">${cats.map(c => `<option ${c === f.categoria ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
        <td><input type="text" class="d" value="${esc(f.dia_pago || '')}" style="padding:7px"></td><td class="n"><input type="number" class="m" value="${f.monto_mensual}" style="width:120px;padding:7px"></td><td><input type="checkbox" class="a" ${f.activo ? 'checked' : ''} style="width:22px;height:22px"></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn sec" id="gf-add">Agregar renglón</button><span class="sp"></span><b>Total activo: ${money(data.filter(f => f.activo).reduce((s, f) => s + num(f.monto_mensual), 0))}</b><button class="btn" id="gf-s">Guardar</button></div></div>`;
    document.getElementById('gf-add').onclick = () => document.getElementById('gf-b').insertAdjacentHTML('beforeend', `<tr data-id=""><td><input type="text" class="c" style="padding:7px" placeholder="Concepto"></td><td><select class="k" style="padding:7px">${cats.map(c => `<option>${c}</option>`).join('')}</select></td><td><input type="text" class="d" style="padding:7px"></td><td class="n"><input type="number" class="m" style="width:120px;padding:7px"></td><td><input type="checkbox" class="a" checked style="width:22px;height:22px"></td></tr>`);
    document.getElementById('gf-s').onclick = e => busy(e.currentTarget, async () => {
      for (const tr of main.querySelectorAll('#gf-b tr')) {
        const row = { concepto: tr.querySelector('.c').value.trim(), categoria: tr.querySelector('.k').value, dia_pago: tr.querySelector('.d').value.trim() || null, monto_mensual: num(tr.querySelector('.m').value), activo: tr.querySelector('.a').checked };
        if (!row.concepto) continue;
        const q = tr.dataset.id ? sb.from('gastos_fijos').update(row).eq('id', Number(tr.dataset.id)) : sb.from('gastos_fijos').insert(row);
        const { error } = await q; if (error) throw error;
      }
      toast('Guardado', 'ok'); VISTAS_DUENO.fijos(main);
    });
  },

  /* ---------- MANTENIMIENTO ---------- */
  async mant(main) {
    const { data, error } = await sb.from('mantenimientos').select('*').order('actividad');
    if (error) throw error;
    const hoy = fechaMX();
    main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Mantenimiento programado</h2><span class="sp"></span><button class="btn sm" id="m-add">Agregar</button></div>
      <div class="tw"><table><thead><tr><th>Actividad</th><th class="n">Cada (días)</th><th>Último</th><th>Próximo</th><th></th></tr></thead><tbody>
      ${data.map(m => { const prox = m.ultima_fecha ? addDays(m.ultima_fecha, m.cada_dias) : null; const st = !prox ? '<span class="tag warn">Sin fecha</span>' : prox <= hoy ? '<span class="tag bad">Vencido</span>' : prox <= addDays(hoy, 15) ? '<span class="tag warn">Próximo</span>' : '<span class="tag ok">Al día</span>';
        return `<tr><td><b>${esc(m.actividad)}</b></td><td class="n">${m.cada_dias}</td><td>${m.ultima_fecha || '—'}</td><td>${prox || '—'} ${st}</td>
        <td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-hecho="${m.id}">Hecho hoy</button><button class="btn sm ghost" data-fecha="${m.id}">Poner fecha</button></td></tr>`; }).join('')}
      </tbody></table></div><p class="mut small">Pon la fecha del último cambio de cada pieza para que la app te avise cuando toque.</p></div>`;
    const reload = () => VISTAS_DUENO.mant(main);
    main.querySelectorAll('[data-hecho]').forEach(b => b.onclick = () => busy(b, async () => {
      const m = data.find(x => x.id == b.dataset.hecho);
      const { error } = await sb.from('mantenimientos').update({ ultima_fecha: hoy }).eq('id', m.id); if (error) throw error;
      await sb.from('bitacora').insert({ tipo: 'mantenimiento', actividad: m.actividad, usuario_id: S.session.user.id });
      toast('Registrado', 'ok'); reload();
    }));
    main.querySelectorAll('[data-fecha]').forEach(b => b.onclick = () => modal(`<h2>Fecha del último servicio</h2><div class="field"><input type="date" id="mf-d" value="${hoy}"></div>
      <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="mf-b">Guardar</button></div>`,
      (box, close) => box.querySelector('#mf-b').onclick = e => busy(e.currentTarget, async () => {
        const { error } = await sb.from('mantenimientos').update({ ultima_fecha: val('mf-d') }).eq('id', Number(b.dataset.fecha)); if (error) throw error; close(); reload();
      })));
    document.getElementById('m-add').onclick = () => modal(`<h2>Nuevo mantenimiento</h2><div class="field"><label>Actividad</label><input type="text" id="ma-a"></div>
      <div class="field"><label>Cada cuántos días</label><input type="number" id="ma-d"></div>
      <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="ma-b">Guardar</button></div>`,
      (box, close) => box.querySelector('#ma-b').onclick = e => busy(e.currentTarget, async () => {
        if (!val('ma-a') || !nval('ma-d')) throw new Error('Completa los datos');
        const { error } = await sb.from('mantenimientos').insert({ actividad: val('ma-a'), cada_dias: nval('ma-d') }); if (error) throw error; close(); reload();
      }));
  },

  /* ---------- BITÁCORA (DUEÑO) ---------- */
  async bitacoraD(main) {
    const { data, error } = await sb.from('bitacora').select('*').order('fecha', { ascending: false }).limit(200);
    if (error) throw error;
    main.innerHTML = `<div class="card"><h2>Bitácora</h2><div class="tw"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Registro</th><th>Persona</th><th></th></tr></thead><tbody>
      ${data.map(b => `<tr><td>${fmtFecha(b.fecha)}</td><td><span class="tag inf">${esc(b.tipo)}</span></td><td><b>${esc(b.actividad)}</b>${b.cantidad ? ' · ' + fmtN(b.cantidad) : ''}${b.notas ? '<br><span class="mut small">' + esc(b.notas) + '</span>' : ''}</td><td>${esc(S.perfiles.find(p => p.id === b.usuario_id)?.nombre || '')}</td><td>${b.foto ? `<button class="btn sm sec" data-foto="${esc(b.foto)}">Foto</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin registros</td></tr>'}
      </tbody></table></div></div>`;
    main.querySelectorAll('[data-foto]').forEach(b => b.onclick = () => verFoto(b.dataset.foto));
  },

  /* ---------- USUARIOS ---------- */
  async usuarios(main) {
    const { data, error } = await sb.from('perfiles').select('*').order('nombre');
    if (error) throw error;
    main.innerHTML = `<div class="card"><h2>Usuarios</h2>
      <div class="alert inf">Para crear un usuario nuevo: en Supabase entra a <b>Authentication → Users → Add user → Create new user</b>. Usa como correo <b>nombre@${CFG.DOMINIO_USUARIOS}</b> (ej. yara@${CFG.DOMINIO_USUARIOS}), una contraseña, y marca <b>Auto Confirm User</b>. Después actívalo aquí y asígnale su puesto. Para entrar a la app solo escribe <b>yara</b> y su contraseña.</div>
      <div class="tw"><table><thead><tr><th>Nombre</th><th>Puesto</th><th>Activo</th><th></th></tr></thead><tbody>
      ${data.map(p => `<tr data-id="${p.id}"><td><input type="text" class="n" value="${esc(p.nombre)}" style="padding:7px"></td>
        <td><select class="r" style="padding:7px" ${p.id === S.session.user.id ? 'disabled' : ''}>${[['dueno', 'Dueño'], ['ventanilla', 'Ventanilla'], ['repartidor', 'Repartidor']].map(([k, t]) => `<option value="${k}" ${k === p.rol ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input type="checkbox" class="a" ${p.activo ? 'checked' : ''} ${p.id === S.session.user.id ? 'disabled' : ''} style="width:22px;height:22px"></td>
        <td>${p.id === S.session.user.id ? '<span class="tag inf">Tú</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><a class="btn ghost" href="https://supabase.com/dashboard/project/wyvvfujnobbsbzttoqsy/auth/users" target="_blank" rel="noopener">Abrir usuarios en Supabase</a><span class="sp"></span><button class="btn" id="u-s">Guardar</button></div></div>`;
    document.getElementById('u-s').onclick = e => busy(e.currentTarget, async () => {
      for (const tr of main.querySelectorAll('tr[data-id]')) {
        const upd = { nombre: tr.querySelector('.n').value.trim() };
        if (tr.dataset.id !== S.session.user.id) { upd.rol = tr.querySelector('.r').value; upd.activo = tr.querySelector('.a').checked; }
        const { error } = await sb.from('perfiles').update(upd).eq('id', tr.dataset.id); if (error) throw error;
      }
      await cargarCatalogos(); toast('Usuarios guardados', 'ok'); VISTAS_DUENO.usuarios(main);
    });
  },

  /* ---------- AJUSTES ---------- */
  async ajustes(main) {
    await cargarCatalogos();
    const rows = Object.values(S.config).sort((a, b) => a.clave.localeCompare(b.clave));
    main.innerHTML = `<div class="card" style="max-width:720px"><h2>Ajustes</h2>
      ${rows.map(c => `<div class="field"><label>${esc(c.descripcion || c.clave)}</label>${c.clave === 'medidor_unidad'
        ? `<select data-k="${c.clave}" data-t="1"><option ${c.texto === 'litros' ? 'selected' : ''}>litros</option><option ${c.texto === 'm3' ? 'selected' : ''}>m3</option></select>`
        : c.clave === 'datos_transferencia'
        ? `<textarea data-k="${c.clave}" data-t="1" rows="3" placeholder="Banco: …&#10;CLABE: …&#10;A nombre de: …">${esc(c.texto || '')}</textarea><span class="mut small">Lo ve el cliente en la página de pedidos cuando elige transferencia.</span>`
        : c.clave === 'tiempo_entrega'
        ? `<input type="text" data-k="${c.clave}" data-t="1" value="${esc(c.texto || '')}"><span class="mut small">Lo ve el cliente al hacer su pedido en línea, junto con su lugar en la fila.</span>`
        : `<input type="number" data-k="${c.clave}" value="${c.valor ?? ''}">`}</div>`).join('')}
      <button class="btn" id="aj-s">Guardar</button></div>`;
    document.getElementById('aj-s').onclick = e => busy(e.currentTarget, async () => {
      for (const el of main.querySelectorAll('[data-k]')) {
        const upd = el.dataset.t ? { texto: el.value } : { valor: el.value === '' ? null : Number(el.value) };
        const { error } = await sb.from('config').update(upd).eq('clave', el.dataset.k); if (error) throw error;
      }
      await cargarCatalogos(); toast('Ajustes guardados', 'ok');
    });
  }
};

/* ---------------- formularios del dueño ---------------- */
function nuevoProducto(onSave) {
  const arts = S.articulos.filter(a => a.tipo !== 'equipo' && a.activo);
  const colores = ['#1BA6C9', '#E85A9B', '#2E7D5B', '#5C6BC0', '#F2994A', '#8E6CC8', '#0B6E8A'];
  modal(`<h2>Nuevo producto</h2>
    <div class="field"><label>Nombre</label><input type="text" id="np-n" placeholder="ej. Botella 1 litro"></div>
    <div class="grid g2">
      <div class="field"><label>Precio en planta</label><input type="number" id="np-p" inputmode="decimal"></div>
      <div class="field"><label>Precio a domicilio</label><input type="number" id="np-pd" inputmode="decimal"></div>
      <div class="field"><label>Litros que marca el medidor</label><input type="number" id="np-lp" value="0"></div>
      <div class="field"><label>Litros de pipa (con rechazo)</label><input type="number" id="np-lc" value="0"></div>
      <div class="field"><label>IVA</label><select id="np-iva"><option value="0">Tasa 0% (agua en garrafón)</option><option value="0.16">16% (hielo, envases chicos, otros)</option></select></div>
      <div class="field"><label>Costo extra por pieza</label><input type="number" id="np-ce" value="0"></div>
    </div>
    <label class="chk"><input type="checkbox" id="np-g"> Cuenta como garrafón (para la meta y el conteo)</label>
    <div class="field"><label>Color del botón</label><div class="row">${colores.map((c, i) => `<label style="margin:0;cursor:pointer"><input type="radio" name="np-col" value="${c}" ${i === 0 ? 'checked' : ''} style="display:none"><span style="display:inline-block;width:38px;height:38px;border-radius:10px;background:${c};border:3px solid #fff;box-shadow:0 0 0 2px var(--line)"></span></label>`).join('')}</div></div>
    <div class="field"><label>Qué descuenta del inventario al venderse (por pieza)</label>
      ${arts.map(a => `<div class="row" style="margin-bottom:6px"><span class="sp">${esc(a.nombre)}</span><input type="number" class="np-ins" data-a="${a.id}" placeholder="0" style="width:90px;padding:7px"></div>`).join('')}
      <span class="mut small">Ejemplo: un garrafón lleva 1 tapa, 1 liner y 1 sello. Deja en blanco lo que no usa.</span></div>
    <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="np-b">Guardar producto</button></div>`,
    (box, close) => {
      box.querySelectorAll('input[name=np-col]').forEach(r => r.onchange = () => box.querySelectorAll('input[name=np-col] + span').forEach(sp => sp.style.boxShadow = sp.previousElementSibling.checked ? '0 0 0 3px var(--txt)' : '0 0 0 2px var(--line)'));
      box.querySelector('#np-b').onclick = e => busy(e.currentTarget, async () => {
        if (!val('np-n')) throw new Error('Escribe el nombre');
        const precio = nval('np-p'); if (precio === null || precio <= 0) throw new Error('Escribe el precio');
        const ins = [...box.querySelectorAll('.np-ins')].filter(i => num(i.value) > 0).map(i => ({ articulo_id: Number(i.dataset.a), cantidad: num(i.value) }));
        const row = { nombre: val('np-n'), precio, precio_domicilio: nval('np-pd'), litros_producto: nval('np-lp') ?? 0, litros_consumo: nval('np-lc') ?? 0,
          iva_tasa: Number(val('np-iva')), costo_extra: nval('np-ce') ?? 0, cuenta_garrafon: chk('np-g'),
          color: box.querySelector('input[name=np-col]:checked').value, orden: Math.max(0, ...S.productos.map(p => p.orden)) + 1, activo: true };
        const costo = ins.reduce((s, x) => s + x.cantidad * num(S.articulos.find(a => a.id === x.articulo_id)?.costo_unitario), 0) + row.litros_consumo * costoLitro() + row.costo_extra;
        if (precio < costo && !(await confirmar(`El precio queda abajo del costo estimado (${money(costo)}). ¿Guardar de todos modos?`, 'Guardar'))) return;
        const { data, error } = await sb.from('productos').insert(row).select('id').single();
        if (error) throw error;
        if (ins.length) { const { error: e2 } = await sb.from('producto_insumos').insert(ins.map(x => ({ ...x, producto_id: data.id }))); if (e2) throw e2; }
        close(); toast('Producto agregado', 'ok'); await cargarCatalogos(); onSave();
      });
    });
}
function editarArticulo(a, onSave, tipoDef) {
  const nuevo = !a; a = a || { tipo: tipoDef, unidad: 'pieza', minimo: 0, costo_unitario: 0, activo: true };
  const eq = a.tipo === 'equipo';
  modal(`<h2>${nuevo ? 'Nuevo' : 'Editar'} ${eq ? 'equipo' : 'artículo'}</h2>
    <div class="field"><label>Nombre</label><input type="text" id="ea-n" value="${esc(a.nombre || '')}"></div>
    <div class="grid g2">
      <div class="field"><label>Tipo</label><select id="ea-t">${['insumo', 'garrafon', 'hielo', 'limpieza', 'sanitizacion', 'equipo'].map(t => `<option ${t === a.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Unidad</label><input type="text" id="ea-u" value="${esc(a.unidad || 'pieza')}"></div>
      ${eq ? '' : `<div class="field"><label>Mínimo (alerta)</label><input type="number" id="ea-mi" value="${a.minimo ?? 0}"></div>
      <div class="field"><label>Costo unitario</label><input type="number" id="ea-c" value="${a.costo_unitario ?? 0}"></div>`}
    </div>
    ${eq ? `<div class="grid g2"><div class="field"><label>Marca</label><input type="text" id="ea-ma" value="${esc(a.marca || '')}"></div><div class="field"><label>Modelo</label><input type="text" id="ea-mo" value="${esc(a.modelo || '')}"></div>
      <div class="field"><label>No. de serie</label><input type="text" id="ea-s" value="${esc(a.numero_serie || '')}"></div><div class="field"><label>Fecha de compra</label><input type="date" id="ea-f" value="${a.fecha_compra || ''}"></div>
      <div class="field"><label>Valor de compra</label><input type="number" id="ea-v" value="${a.valor_compra ?? ''}"></div></div>` : ''}
    <div class="field"><label>Notas</label><textarea id="ea-no">${esc(a.notas || '')}</textarea></div>
    <label class="chk"><input type="checkbox" id="ea-a" ${a.activo ? 'checked' : ''}> Activo</label>
    <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="ea-b">Guardar</button></div>`,
    (box, close) => box.querySelector('#ea-b').onclick = e => busy(e.currentTarget, async () => {
      if (!val('ea-n')) throw new Error('Escribe el nombre');
      const row = { nombre: val('ea-n'), tipo: val('ea-t'), unidad: val('ea-u') || 'pieza', notas: val('ea-no') || null, activo: chk('ea-a') };
      if (!eq) { row.minimo = nval('ea-mi') ?? 0; row.costo_unitario = nval('ea-c') ?? 0; }
      else Object.assign(row, { marca: val('ea-ma') || null, modelo: val('ea-mo') || null, numero_serie: val('ea-s') || null, fecha_compra: val('ea-f') || null, valor_compra: nval('ea-v') });
      const { error } = nuevo ? await sb.from('articulos').insert(row) : await sb.from('articulos').update(row).eq('id', a.id);
      if (error) throw error; close(); toast('Guardado', 'ok'); onSave();
    }));
}

const DIAS_SEM = [['lun', 'Lun'], ['mar', 'Mar'], ['mie', 'Mié'], ['jue', 'Jue'], ['vie', 'Vie'], ['sab', 'Sáb'], ['dom', 'Dom']];
const diaHoy = () => ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][new Date(fechaMX() + 'T12:00:00').getDay()];
const txtCredito = c => c.dias_credito === 0 ? 'Contado' : c.dias_credito ? `Crédito ${c.dias_credito} días` : 'Crédito';
function editarCliente(c, onSave) {
  const nuevo = !c; c = c || { tipo: 'restaurante', activo: true };
  const f = (id, lab, v, t = 'text') => `<div class="field"><label>${lab}</label><input type="${t}" id="${id}" value="${esc(v ?? '')}"></div>`;
  modal(`<h2>${nuevo ? 'Nuevo cliente' : 'Editar cliente'}</h2>
    <div class="grid g2">
      ${f('ec-n', 'Nombre comercial', c.nombre)}
      <div class="field"><label>Tipo</label><select id="ec-t">${['restaurante', 'empresa', 'domicilio', 'distribuidor'].map(t => `<option ${t === c.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      ${f('ec-tel', 'Teléfono', c.telefono, 'tel')}
      ${f('ec-pe', 'Precio especial por relleno (autorizado por ti)', c.precio_especial, 'number')}
    </div>
    ${f('ec-dom', 'Domicilio', c.domicilio)}${f('ec-map', 'Liga de Google Maps', c.maps_url)}
    <h3 style="margin-top:8px">Ruta y crédito</h3>
    <div class="grid g2">${f('ec-ct', 'Contacto (para cobrar o avisar)', c.contacto)}${f('ec-qr', 'Quién recibe', c.quien_recibe)}
      <div class="field"><label>Pago</label><select id="ec-dc">${[['', 'Sin definir (queda a crédito)'], ['0', 'Contado (paga al entregar)'], ['7', 'Crédito 7 días'], ['15', 'Crédito 15 días'], ['30', 'Crédito 30 días']].map(([v, t]) => `<option value="${v}" ${String(c.dias_credito ?? '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Forma de pago habitual</label><select id="ec-fp">${[['', '—'], ['efectivo', 'Efectivo'], ['transferencia', 'Transferencia']].map(([v, t]) => `<option value="${v}" ${(c.forma_pago_habitual || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="field"><label>Días de entrega</label><div class="row" style="flex-wrap:wrap;gap:10px">${DIAS_SEM.map(([k, t]) => `<label class="chk" style="margin:0"><input type="checkbox" class="ec-dia" value="${k}" ${(c.dias_entrega || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
    <h3 style="margin-top:8px">Datos fiscales</h3>
    <div class="grid g2">${f('ec-rfc', 'RFC', c.rfc)}${f('ec-rs', 'Razón social', c.razon_social)}${f('ec-rg', 'Régimen fiscal', c.regimen_fiscal)}${f('ec-cp', 'Código postal fiscal', c.cp_fiscal)}${f('ec-uso', 'Uso de CFDI', c.uso_cfdi)}${f('ec-mail', 'Correo para factura', c.correo_factura, 'email')}</div>
    <div class="field"><label>Constancia de situación fiscal (PDF o foto)</label><input type="file" id="ec-cons" accept="application/pdf,image/*">${c.constancia_path ? '<span class="mut small">Ya hay una constancia guardada; subir otra la reemplaza.</span>' : ''}</div>
    ${f('ec-no', 'Notas', c.notas)}
    <label class="chk"><input type="checkbox" id="ec-a" ${c.activo ? 'checked' : ''}> Activo</label>
    <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="ec-b">Guardar</button></div>`,
    (box, close) => box.querySelector('#ec-b').onclick = e => busy(e.currentTarget, async () => {
      if (!val('ec-n')) throw new Error('Escribe el nombre');
      const pe = nval('ec-pe');
      if (pe !== null) { const rel = S.productos.find(p => p.nombre === 'Relleno garrafón'); if (rel && pe < costoProducto(rel) && !(await confirmar(`El precio especial ${money(pe)} queda abajo del costo estimado (${money(costoProducto(rel))}). ¿Guardar?`))) return; }
      const row = { nombre: val('ec-n'), tipo: val('ec-t'), telefono: val('ec-tel') || null, precio_especial: pe, domicilio: val('ec-dom') || null, maps_url: val('ec-map') || null,
        rfc: val('ec-rfc').toUpperCase() || null, razon_social: val('ec-rs') || null, regimen_fiscal: val('ec-rg') || null, cp_fiscal: val('ec-cp') || null, uso_cfdi: val('ec-uso') || null,
        correo_factura: val('ec-mail') || null, notas: val('ec-no') || null, activo: chk('ec-a'),
        contacto: val('ec-ct') || null, quien_recibe: val('ec-qr') || null, dias_credito: val('ec-dc') === '' ? null : Number(val('ec-dc')),
        forma_pago_habitual: val('ec-fp') || null, dias_entrega: (() => { const d = [...box.querySelectorAll('.ec-dia:checked')].map(i => i.value); return d.length ? d : null; })() };
      let id = c.id;
      if (nuevo) { const { data, error } = await sb.from('clientes').insert(row).select('id').single(); if (error) throw error; id = data.id; }
      else { const { error } = await sb.from('clientes').update(row).eq('id', id); if (error) throw error; }
      const file = document.getElementById('ec-cons').files[0];
      if (file) {
        const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
        const path = `clientes/${id}/constancia-${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('fiscal').upload(path, file, { contentType: file.type || 'application/octet-stream' }); if (error) throw error;
        await sb.from('clientes').update({ constancia_path: path }).eq('id', id);
      }
      close(); toast('Cliente guardado', 'ok'); onSave();
    }));
}

function datosFiscales(c) {
  const fila = (lab, v) => v ? `<tr><td class="mut">${lab}</td><td><span class="copy" data-copy="${esc(v)}">${esc(v)}</span></td></tr>` : '';
  modal(`<h2>${esc(c.nombre)}</h2><p class="mut small">Toca un dato para copiarlo y pegarlo en el portal del SAT.</p>
    <table><tbody>${fila('RFC', c.rfc)}${fila('Razón social', c.razon_social)}${fila('Régimen fiscal', c.regimen_fiscal)}${fila('Código postal', c.cp_fiscal)}${fila('Uso de CFDI', c.uso_cfdi)}${fila('Correo', c.correo_factura)}</tbody></table>
    <div class="row" style="margin-top:14px">${c.constancia_path ? '<button class="btn sec" id="df-c">Ver constancia</button>' : ''}<span class="sp"></span><button class="btn ghost" data-close>Cerrar</button></div>`,
    box => {
      box.querySelectorAll('[data-copy]').forEach(s => s.onclick = async () => { try { await navigator.clipboard.writeText(s.dataset.copy); toast('Copiado', 'ok'); } catch { toast('No se pudo copiar; selecciónalo a mano', 'bad'); } });
      const b = box.querySelector('#df-c'); if (b) b.onclick = () => verFoto(c.constancia_path, 'fiscal');
    });
}

async function cerrarTurnoAjeno(t, main) {
  modal(`<h2>Cerrar turno de ${esc(S.perfiles.find(p => p.id === t.usuario_id)?.nombre || '')}</h2>
    <p class="mut">Úsalo solo si la persona se fue sin cerrar.</p>
    <div class="field"><label>Lectura final del medidor</label><input type="number" id="cx-m"></div>
    <div class="field"><label>Garrafones nuevos que quedan</label><input type="number" id="cx-g"></div>
    <div class="field"><label>Efectivo contado</label><input type="number" id="cx-e"></div>
    <div class="field"><label>Notas</label><input type="text" id="cx-n" value="Cerrado por el dueño"></div>
    <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn bad" id="cx-b">Cerrar turno</button></div>`,
    (box, close) => box.querySelector('#cx-b').onclick = e => busy(e.currentTarget, async () => {
      if (nval('cx-e') === null) throw new Error('Escribe el efectivo contado');
      const { error } = await sb.rpc('cerrar_turno', { p_turno_id: t.id, p_medidor_fin: nval('cx-m'), p_garrafones_fin: nval('cx-g'), p_efectivo_contado: nval('cx-e'), p_notas: val('cx-n') });
      if (error) throw error; close(); toast('Turno cerrado', 'ok'); VISTAS_DUENO.turnos(main);
    }));
}

/* =====================================================================
   TICKET DE VENTA E IMPRESIÓN (ESC/POS vía RawBT en Android)
   ===================================================================== */
function impresionActiva() { try { return localStorage.getItem('ai_imprimir') === '1'; } catch { return false; } }
const sinAcentos = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');

async function datosTicket(ventaId) {
  const { data: v, error } = await sb.from('ventas').select('*, venta_detalle(cantidad, precio_unitario, importe, producto_id)').eq('id', ventaId).single();
  if (error) throw error;
  return v;
}
function lineasTicket(v) {
  const W = cfg('ticket_ancho') || 32;
  const L = [];
  const centro = s => { s = sinAcentos(s).slice(0, W); return ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s; };
  const dos = (a, b) => { a = sinAcentos(a); b = sinAcentos(b); const esp = W - b.length; return (a.length > esp - 1 ? a.slice(0, esp - 1) : a).padEnd(esp) + b; };
  const sep = '-'.repeat(W);
  const prod = id => S.productos.find(p => p.id === id)?.nombre || 'Producto';
  const cli = S.clientes.find(c => c.id === v.cliente_id);
  const vendedor = S.perfiles.find(p => p.id === v.usuario_id)?.nombre || (v.usuario_id === S.session.user.id ? S.perfil.nombre : '');
  L.push({ t: centro('Real del Valle'), b: true });
  L.push({ t: sep });
  L.push({ t: dos('Ticket #' + v.id, new Date(v.fecha).toLocaleDateString('es-MX', { timeZone: CFG.ZONA })) });
  L.push({ t: dos('Hora: ' + fmtHora(v.fecha), vendedor ? 'Atendio: ' + vendedor : '') });
  if (cli) L.push({ t: 'Cliente: ' + sinAcentos(cli.nombre).slice(0, W - 9) });
  L.push({ t: sep });
  for (const d of v.venta_detalle) {
    L.push({ t: sinAcentos(prod(d.producto_id)).slice(0, W) });
    L.push({ t: dos(`  ${fmtN(d.cantidad)} x ${money(d.precio_unitario)}`, money(d.importe)) });
  }
  L.push({ t: sep });
  L.push({ t: dos('TOTAL', money(v.total)), b: true, big: true });
  L.push({ t: dos('Pago:', { efectivo: 'Efectivo', transferencia: 'Transferencia', credito: 'Credito' }[v.forma_pago]) });
  if (v.cancelada) L.push({ t: centro('*** VENTA CANCELADA ***'), b: true });
  L.push({ t: sep });
  L.push({ t: centro('Gracias por su compra') });
  L.push({ t: centro('Este ticket no es factura') });
  L.push({ t: sep });
  L.push({ t: centro('PIDE A DOMICILIO'), b: true });
  L.push({ t: centro('Escanea el QR y haz tu pedido aqui') });
  return L;
}
// QR de la página de pedidos, para el final del ticket
const URL_PEDIDOS = () => new URL('pedir.html', location.href).href;
function canvasQR(px) {
  if (typeof qrcode === 'undefined') return null;
  const q = qrcode(0, 'M'); q.addData(URL_PEDIDOS()); q.make();
  const n = q.getModuleCount(), m = 2, esc = Math.max(1, Math.floor(px / (n + m * 2)));
  const w = Math.ceil(((n + m * 2) * esc) / 8) * 8;
  const c = document.createElement('canvas'); c.width = w; c.height = (n + m * 2) * esc;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + m) * esc, (r + m) * esc, esc, esc);
  return c;
}
let _qrRaster = null;
function qrRaster() {
  if (_qrRaster) return _qrRaster;
  const ancho = (cfg('ticket_ancho') || 32) >= 48 ? 576 : 384;
  const c = canvasQR(Math.round(ancho * 0.6)); if (!c) return null;
  const w = c.width, h = c.height, px = c.getContext('2d').getImageData(0, 0, w, h).data, bw = w / 8;
  const out = [0x1B, 0x61, 0x01, 0x1D, 0x76, 0x30, 0x00, bw & 0xFF, bw >> 8, h & 0xFF, h >> 8];
  for (let y = 0; y < h; y++) for (let xb = 0; xb < bw; xb++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) { const i = (y * w + xb * 8 + bit) * 4; if (px[i] < 128) byte |= 0x80 >> bit; }
    out.push(byte);
  }
  out.push(0x0A, 0x1B, 0x61, 0x00);
  return (_qrRaster = out);
}
let _logoRaster = null;
async function logoRaster() {
  if (_logoRaster) return _logoRaster;
  const ancho = (cfg('ticket_ancho') || 32) >= 48 ? 576 : 384; // puntos de la impresora
  const w = Math.round(ancho * 0.8 / 8) * 8;                     // logo al 80% del ancho
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'logo.jpg'; });
  const h = Math.round(img.height * w / img.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, bw = w / 8;
  const out = [0x1B, 0x61, 0x01, 0x1D, 0x76, 0x30, 0x00, bw & 0xFF, bw >> 8, h & 0xFF, h >> 8];
  for (let y = 0; y < h; y++) for (let xb = 0; xb < bw; xb++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const i = (y * w + xb * 8 + bit) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < 170) byte |= 0x80 >> bit;
    }
    out.push(byte);
  }
  out.push(0x0A, 0x1B, 0x61, 0x00);
  return (_logoRaster = out);
}
function escpos(L, abrirCajon, logo, qr) {
  const B = [0x1B, 0x40]; // inicializar
  if (logo) B.push(...logo);
  const txt = s => { for (const ch of s) B.push(ch.charCodeAt(0) & 0x7F); };
  for (const l of L) {
    B.push(0x1B, 0x45, l.b ? 1 : 0);          // negritas
    B.push(0x1D, 0x21, l.big ? 0x01 : 0x00);  // doble alto
    txt(l.t); B.push(0x0A);
  }
  if (qr) B.push(...qr);
  B.push(0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00, 0x0A, 0x0A, 0x0A);
  B.push(0x1D, 0x56, 0x42, 0x00);             // corte de papel (si la impresora lo tiene)
  if (abrirCajon) B.push(0x1B, 0x70, 0x00, 0x19, 0xFA); // abrir cajón (pin 2)
  return new Uint8Array(B);
}
function enviarImpresora(bytes) {
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  const b64 = btoa(bin);
  window.location.href = `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}
async function mostrarTicket(ventaId, recienCobrada) {
  try {
    const v = await datosTicket(ventaId);
    const L = lineasTicket(v);
    const abrir = recienCobrada && v.forma_pago === 'efectivo';
    const logo = await logoRaster().catch(() => null);
    let qr = null; try { qr = qrRaster(); } catch { qr = null; }
    if (recienCobrada && impresionActiva()) { enviarImpresora(escpos(L, abrir, logo, qr)); return; }
    const qrImg = (() => { try { return canvasQR(220)?.toDataURL(); } catch { return null; } })();
    modal(`<h2>Ticket #${v.id}</h2>
      <pre style="background:#fff;border:1px dashed var(--line);border-radius:10px;padding:14px;font:14px/1.45 ui-monospace,Menlo,Consolas,monospace;overflow-x:auto;max-width:360px;margin:0 auto"><img src="logo.jpg" alt="Agua Inmaculada" style="display:block;width:80%;margin:0 auto 6px;filter:grayscale(1) contrast(1.4)">${L.map(l => l.b ? `<b${l.big ? ' style="font-size:16px"' : ''}>${esc(l.t)}</b>` : esc(l.t)).join('\n')}${qrImg ? `<img src="${qrImg}" alt="QR para pedir a domicilio" style="display:block;width:150px;margin:8px auto 0">` : ''}</pre>
      <div class="row" style="margin-top:14px"><button class="btn ghost" data-close>Cerrar</button><span class="sp"></span>
        ${v.firma ? '<button class="btn sec" id="tk-n">Nota firmada</button>' : ''}<button class="btn" id="tk-p">${recienCobrada ? 'Imprimir' : 'Reimprimir'}</button></div>
      <p class="mut small">Para imprimir, la tableta Android necesita la app gratuita RawBT vinculada a la impresora Bluetooth. ${recienCobrada && v.forma_pago === 'efectivo' ? 'Al imprimir se abre el cajón.' : 'La reimpresión no abre el cajón.'}</p>`,
      (box, close) => {
        box.querySelector('#tk-p').onclick = () => { enviarImpresora(escpos(L, abrir, logo, qr)); close(); };
        const bn = box.querySelector('#tk-n'); if (bn) bn.onclick = () => busy(bn, async () => { await mostrarNotaVenta(v.id); close(); });
      });
  } catch (e) { toast(errMsg(e), 'bad'); }
}

/* ---------------- inicio ---------------- */
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { S.session = null; } });
// boot() se llama al final de reparto.js
